/**
 * REBUILD-3 review #1 (suggested): the fully offline replay mode.
 *
 * Two replay modes over the same fixture (fixture.ts):
 *   - live model (default): recorded pages, the gateway's real `brain` model. Not reproducible and
 *     spends quota; it is what tells whether a prompt / contract change helps the model.
 *   - recorded model: recorded pages AND recorded model replies (`model-replies.json`, written by
 *     a live replay with `--record-models`). No model call at all, same input → same output; it
 *     is the regression check for rule / checker / renderer changes.
 *
 * Recorded replies are served in order. A request that differs from the recorded one (other tool
 * list or tool choice — e.g. a rule change now sends back where it did not) is still served but
 * counted as `diverged`; a turn past the last recorded reply fails with ModelReplyNotInFixture,
 * which the loop reports like any model failure. Both are what a rule-change regression wants to
 * see.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';

export const MODEL_REPLIES_FILE = 'model-replies.json';
export const MODEL_REPLIES_VERSION = 1;

/** What a request looked like, enough to tell a diverged replay (never the full prompt). */
export interface ModelRequestShape {
  tools: string[];
  toolChoice: string | null;
  messages: number;
}

export interface RecordedModelReply {
  index: number;
  request: ModelRequestShape;
  response: NeutralMessagesResponse;
}

export interface ModelReplies {
  version: number;
  recordedAt: string;
  model: string;
  replies: RecordedModelReply[];
}

export function requestShape(request: NeutralMessagesRequest): ModelRequestShape {
  const choice = request.toolChoice;
  return {
    tools: (request.tools ?? []).map((tool) => tool.name),
    toolChoice: !choice ? null : choice.type === 'tool' ? `tool:${choice.name}` : choice.type,
    messages: request.messages.length,
  };
}

/** Wraps a live adapter; every reply is kept in order for `writeModelReplies`. */
export function recordingModel(adapter: MessagesAdapter): {
  adapter: MessagesAdapter;
  replies(): RecordedModelReply[];
} {
  const replies: RecordedModelReply[] = [];
  return {
    adapter: {
      metadata: adapter.metadata,
      async create(request, options) {
        const response = await adapter.create(request, options);
        replies.push({ index: replies.length, request: requestShape(request), response });
        return response;
      },
    },
    replies: () => [...replies],
  };
}

export function writeModelReplies(
  dir: string,
  replies: readonly RecordedModelReply[],
  model: string,
  now: () => Date = () => new Date(),
): void {
  const file: ModelReplies = {
    version: MODEL_REPLIES_VERSION,
    recordedAt: now().toISOString(),
    model,
    replies: [...replies],
  };
  writeFileSync(join(dir, MODEL_REPLIES_FILE), `${JSON.stringify(file, null, 2)}\n`);
}

/** The recorded replies of a fixture, or null when it has none. */
export function readModelReplies(dir: string): ModelReplies | null {
  const path = join(dir, MODEL_REPLIES_FILE);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ModelReplies;
  if (parsed.version !== MODEL_REPLIES_VERSION || !Array.isArray(parsed.replies))
    throw new Error(`unsupported ${MODEL_REPLIES_FILE} in ${dir}`);
  return parsed;
}

export class ModelReplyNotInFixture extends Error {
  constructor(readonly turn: number) {
    super(`model reply ${turn} is not in the fixture`);
    this.name = 'ModelReplyNotInFixture';
  }
}

export interface ReplayingModel {
  adapter: MessagesAdapter;
  /** Replies served so far. */
  served(): number;
  /** Turns whose request shape differs from the recorded one. */
  diverged(): number[];
  /** A turn asked for more replies than were recorded. */
  exhausted(): boolean;
}

/** Serves recorded replies in order: no model call is ever made. */
export function replayingModel(recorded: ModelReplies): ReplayingModel {
  let next = 0;
  let ranOut = false;
  const diverged: number[] = [];
  return {
    adapter: {
      metadata: { provider: 'anthropic', model: `recorded:${recorded.model}` },
      async create(request) {
        const reply = recorded.replies[next];
        if (!reply) {
          ranOut = true;
          throw new ModelReplyNotInFixture(next);
        }
        const shape = requestShape(request);
        if (JSON.stringify(shape) !== JSON.stringify(reply.request)) diverged.push(next);
        next += 1;
        return reply.response;
      },
    },
    served: () => next,
    diverged: () => [...diverged],
    exhausted: () => ranOut,
  };
}
