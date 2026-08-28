import { createHash } from 'node:crypto';
import type {
  CheckVideoEditQuoteResult,
  ConsumeVideoEditQuoteResult,
  VideoEditActionQuoteRecord,
} from './project-repository.js';
import type { VideoEditOperation } from './types.js';

export const VIDEO_EDIT_REGENERATION_COST_UNITS = 12;
export const VIDEO_EDIT_QUOTE_TTL_MS = 10 * 60 * 1_000;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`)
    .join(',')}}`;
}

export function hashVideoEditOperationPlan(input: {
  projectId: string;
  baseVersionId: string;
  operations: VideoEditOperation[];
}): string {
  return createHash('sha256').update(canonicalize(input)).digest('hex');
}

export interface VideoEditQuoteRepository {
  createQuote(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    operationHash: string;
    operations: VideoEditOperation[];
    costUnits: number;
    expiresAt: Date;
  }): Promise<VideoEditActionQuoteRecord>;
  checkQuote(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    quoteId: string;
    operationHash: string;
    now?: Date;
  }): Promise<CheckVideoEditQuoteResult>;
  consumeQuote(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    quoteId: string;
    operationHash: string;
    now?: Date;
  }): Promise<ConsumeVideoEditQuoteResult>;
}

export interface VideoEditBillingPort {
  consume(costUnits: number): Promise<{ ok: true } | { ok: false; reason: 'insufficient_balance' }>;
  refund(costUnits: number): Promise<void>;
}

export type ConsumeAndExecuteResult =
  | { status: 'started'; taskId: string }
  | { status: 'insufficient_balance' | 'downstream_failed' }
  | Exclude<CheckVideoEditQuoteResult, { status: 'valid' }>;

function quoteCost(operations: VideoEditOperation[]): number {
  return (
    operations.filter((operation) => operation.kind === 'regenerate_scene').length *
    VIDEO_EDIT_REGENERATION_COST_UNITS
  );
}

export class VideoEditQuoteService {
  constructor(private readonly repository: VideoEditQuoteRepository) {}

  async createQuote(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    operations: VideoEditOperation[];
    now?: Date;
  }): Promise<
    | { status: 'free' }
    | {
        status: 'quoted';
        quote: { id: string; costUnits: number; expiresAt: Date };
      }
  > {
    const costUnits = quoteCost(input.operations);
    if (costUnits === 0) return { status: 'free' };
    const now = input.now ?? new Date();
    const operationHash = hashVideoEditOperationPlan(input);
    const quote = await this.repository.createQuote({
      userId: input.userId,
      projectId: input.projectId,
      baseVersionId: input.baseVersionId,
      operationHash,
      operations: input.operations,
      costUnits,
      expiresAt: new Date(now.getTime() + VIDEO_EDIT_QUOTE_TTL_MS),
    });
    return {
      status: 'quoted',
      quote: {
        id: quote.externalId,
        costUnits: quote.costUnits,
        expiresAt: quote.expiresAt,
      },
    };
  }

  async consumeAndExecute(
    input: {
      userId: number;
      projectId: string;
      baseVersionId: string;
      quoteId: string;
      operations: VideoEditOperation[];
      now?: Date;
    },
    dependencies: {
      billing: VideoEditBillingPort;
      execute(input: {
        quoteId: string;
        costUnits: number;
        operations: VideoEditOperation[];
      }): Promise<{ taskId: string }>;
    },
  ): Promise<ConsumeAndExecuteResult> {
    const operationHash = hashVideoEditOperationPlan(input);
    const quoteInput = {
      userId: input.userId,
      projectId: input.projectId,
      baseVersionId: input.baseVersionId,
      quoteId: input.quoteId,
      operationHash,
      ...(input.now ? { now: input.now } : {}),
    };
    const checked = await this.repository.checkQuote(quoteInput);
    if (checked.status !== 'valid') return checked;

    const charged = await dependencies.billing.consume(checked.quote.costUnits);
    if (!charged.ok) return { status: charged.reason };

    const consumed = await this.repository.consumeQuote(quoteInput);
    if (consumed.status !== 'consumed') {
      await this.refundOnce(dependencies.billing, checked.quote.costUnits);
      return consumed;
    }

    try {
      const execution = await dependencies.execute({
        quoteId: consumed.quote.externalId,
        costUnits: consumed.quote.costUnits,
        operations: consumed.quote.operationJson,
      });
      return { status: 'started', taskId: execution.taskId };
    } catch {
      await this.refundOnce(dependencies.billing, consumed.quote.costUnits);
      return { status: 'downstream_failed' };
    }
  }

  private async refundOnce(billing: VideoEditBillingPort, costUnits: number): Promise<void> {
    try {
      await billing.refund(costUnits);
    } catch {
      // Refund implementations are idempotent and independently observable.
      // The quote remains consumed so a retry cannot start a second generation.
    }
  }
}
