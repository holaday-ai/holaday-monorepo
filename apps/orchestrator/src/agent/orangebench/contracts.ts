import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ORANGEBENCH_TOOLS = [
  'orangebench_create_project',
  'orangebench_storyboard',
  'orangebench_character_cards',
  'orangebench_generate_episode',
  'orangebench_multilingual_version',
] as const;
export type OrangeBenchTool = (typeof ORANGEBENCH_TOOLS)[number];
export const CAPABILITY: Record<OrangeBenchTool, string> = {
  orangebench_create_project: 'projects',
  orangebench_storyboard: 'storyboards',
  orangebench_character_cards: 'characters',
  orangebench_generate_episode: 'episodes',
  orangebench_multilingual_version: 'versions',
};
export function isOrangeBenchTool(value: string): value is OrangeBenchTool {
  return (ORANGEBENCH_TOOLS as readonly string[]).includes(value);
}
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const uuid = z.string().uuid();
const integer = z.number().int().safe().min(0).max(9_000_000_000_000_000);
const idem = z
  .string()
  .regex(/^[\x21-\x7e]{1,128}$/)
  .optional();
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        !Array.from(v).some((c) => {
          const n = c.charCodeAt(0);
          return n <= 8 || n === 11 || n === 12 || (n >= 14 && n <= 31);
        }),
    );
const target = { project_id: id };
export function argumentsFor(name: OrangeBenchTool, input: unknown): Record<string, unknown> {
  const envelope = z
    .object({ request: z.record(z.unknown()) })
    .strict()
    .parse(input);
  const raw = envelope.request;
  if (name === 'orangebench_create_project')
    return z
      .object({
        name: text(128),
        script: text(20000),
        style: text(128).optional(),
        aspect_ratio: z.enum(['16:9', '9:16', '1:1']).optional(),
        idempotency_key: idem,
      })
      .strict()
      .parse(raw);
  const character: z.ZodRawShape =
    name === 'orangebench_character_cards' ? { character_id: id } : {};
  if (raw.mode === 'execute')
    return z
      .object({
        ...target,
        ...character,
        mode: z.literal('execute'),
        quote_id: uuid,
        confirm: z.literal(true),
        max_credits_micro_usd: integer,
        idempotency_key: idem,
      })
      .strict()
      .parse(raw);
  if (raw.mode === 'cancel')
    return z
      .object({ ...target, ...character, mode: z.literal('cancel'), task_id: uuid })
      .strict()
      .parse(raw);
  const common = {
    ...target,
    ...character,
    mode: z.literal('quote').optional(),
    project_revision: z.number().int().safe().min(1),
  };
  if (name === 'orangebench_storyboard')
    return z
      .object({
        ...common,
        text: text(20000).nullable().optional(),
        replace_existing: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
  if (name === 'orangebench_generate_episode')
    return z
      .object({
        ...common,
        shot_ids: z.array(id).min(1).max(100).nullable().optional(),
        resolution: z.enum(['720p', '1080p']).optional(),
        subtitles: z.enum(['sidecar', 'burned', 'none']).optional(),
      })
      .strict()
      .parse(raw);
  if (name === 'orangebench_multilingual_version')
    return z
      .object({
        ...common,
        episode_task_id: uuid,
        languages: z
          .array(z.enum(['en', 'es', 'id']))
          .min(1)
          .max(3)
          .refine((a) => new Set(a).size === a.length),
      })
      .strict()
      .parse(raw);
  return z.object(common).strict().parse(raw);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export const ConnectionSchema = z
  .object({
    account_id: uuid,
    key_id: uuid,
    region: z.enum(['cn', 'global']),
    scopes: z.array(z.string()).max(5),
    execution_available: z.boolean().optional(),
  })
  .passthrough();
export type ConnectionIdentity = z.infer<typeof ConnectionSchema>;
export const QuoteSchema = z
  .object({
    id: uuid,
    project_id: id,
    project_revision: z.number().int().safe().positive(),
    capability: z.string(),
    region: z.enum(['cn', 'global']),
    credits_micro_usd: integer,
    expires_at: z.string().datetime({ offset: true }),
    execution_available: z.boolean(),
    effects: z
      .array(
        z.enum([
          'replace_entities_and_shots',
          'human_review_required',
          'generate_all_shots',
          'voiceover',
          'export',
          'translation',
          'subtitles',
          'per_language_export',
        ]),
      )
      .max(12)
      .default([]),
  })
  .passthrough();
export type Quote = z.infer<typeof QuoteSchema>;
export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export interface OrangeBenchRPC {
  listTools(): Promise<{ tools: ToolDescriptor[] }>;
  readResource(args: { uri: string }): Promise<{ contents: unknown[] }>;
  callTool(
    args: { name: string; arguments: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}
export interface ConfirmationView {
  binding: string;
  taskId: string;
  accountId: string;
  keyId: string;
  projectId: string;
  characterId?: string;
  capability: string;
  quoteId: string;
  projectRevision: number;
  region: string;
  maximumCreditsMicroUsd: number;
  formattedLimit: string;
  expiresAt: string;
  effects: readonly string[];
}
export type ApprovalDecision =
  | { decision: 'approve'; binding: string; maximumCreditsMicroUsd: number }
  | { decision: 'reject'; binding: string };
export interface HostContext {
  taskId: string;
  onApproval?: (view: ConfirmationView) => Promise<ApprovalDecision>;
  isCancelled?: () => boolean | Promise<boolean>;
  signal?: AbortSignal;
}
export type DispatchResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; confirmation?: ConfirmationView };
export class ClientError extends Error {}
const SAFE_ERRORS = [
  'unauthorized',
  'scope_required',
  'request_unknown',
  'execution_unavailable',
  'quote_expired',
  'quote_changed',
  'quote_already_used',
  'insufficient_credits',
  'generation_access_restricted',
  'project_busy',
  'not_found',
];
export function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return (
    SAFE_ERRORS.find((code) => text === code || new RegExp(`\\b${code}\\b`).test(text)) ??
    'orangebench_unavailable'
  );
}
export function unpack(value: unknown): Record<string, unknown> {
  const result = z
    .object({
      structuredContent: z.record(z.unknown()).optional(),
      isError: z.boolean().optional(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
        .optional(),
    })
    .passthrough()
    .parse(value);
  if (result.isError)
    throw new ClientError(
      safeError(new Error((result.content ?? []).map((p) => p.text ?? '').join(' '))),
    );
  if (
    !result.structuredContent ||
    Buffer.byteLength(JSON.stringify(result.structuredContent)) > 2 * 1024 * 1024
  )
    throw new ClientError('invalid_response');
  return result.structuredContent;
}
