/**
 * REBUILD-3: records a real browser run as a replay fixture (fixture.ts).
 *
 * Enabled only by `BENCH_RECORD_DIR` (benchmark machines). The runner wraps its executor, web
 * search and page reader; every call and the result the loop received are written as they
 * happen, so a run that dies still leaves its steps. Recording never fails or slows a task: any
 * write error is logged and dropped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../config/logger.js';
import type { UnifiedToolResult } from '../browser-tools/playwright-unified-executor.js';
import {
  type BenchFixture,
  FIXTURE_FILE,
  FIXTURE_VERSION,
  type FixtureStep,
  type RecordedResult,
  fixtureId,
} from './fixture.js';

export interface BenchRecorder {
  readonly dir: string;
  wrapExecute<A extends { tool: string }>(
    execute: (action: A) => Promise<UnifiedToolResult>,
  ): (action: A) => Promise<UnifiedToolResult>;
  wrapWebSearch<H>(search: (query: string) => Promise<H[]>): (query: string) => Promise<H[]>;
  wrapReadPage<P>(read: (url: string) => Promise<P>): (url: string) => Promise<P>;
  finish(end: { url: string; title: string; outcome?: BenchFixture['outcome'] }): void;
}

export interface BenchRecorderOptions {
  root: string;
  id: string;
  intent: string;
  userIntent?: string;
  observationV2?: boolean;
  now?: () => number;
}

export function createBenchRecorder(options: BenchRecorderOptions): BenchRecorder {
  const now = options.now ?? Date.now;
  const started = now();
  const dir = join(options.root, fixtureId(options.id));
  const fixture: BenchFixture = {
    version: FIXTURE_VERSION,
    id: fixtureId(options.id),
    intent: options.intent,
    ...(options.userIntent ? { userIntent: options.userIntent } : {}),
    ...(options.observationV2 !== undefined ? { observationV2: options.observationV2 } : {}),
    recordedAt: new Date(started).toISOString(),
    steps: [],
  };
  let broken = false;
  const write = (file: string, data: string | Buffer) => {
    if (broken) return false;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), data);
      return true;
    } catch (error) {
      broken = true;
      logger.warn({ err: error, dir }, 'bench recorder: write failed, recording stopped');
      return false;
    }
  };
  const save = () => write(FIXTURE_FILE, `${JSON.stringify(fixture, null, 2)}\n`);
  const push = (tool: string, input: Record<string, unknown>, result: RecordedResult) => {
    const step: FixtureStep = {
      index: fixture.steps.length,
      tool,
      input,
      result,
      atMs: now() - started,
    };
    fixture.steps.push(step);
    save();
  };
  save();
  return {
    dir,
    wrapExecute(execute) {
      return async (action) => {
        const result = await execute(action);
        try {
          const { image, ...rest } = result;
          let file: string | undefined;
          if (image?.data) {
            file = `step-${fixture.steps.length}.jpg`;
            if (!write(file, Buffer.from(image.data, 'base64'))) file = undefined;
          }
          const { tool, ...input } = action as { tool: string } & Record<string, unknown>;
          push(tool, input, { ...(rest as RecordedResult), ...(file ? { image: file } : {}) });
        } catch (error) {
          logger.warn({ err: error }, 'bench recorder: step not recorded');
        }
        return result;
      };
    },
    wrapWebSearch(search) {
      return async (query) => {
        const hits = await search(query);
        push('web_search', { query }, { ok: true, text: JSON.stringify(hits) });
        return hits;
      };
    },
    wrapReadPage(read) {
      return async (url) => {
        try {
          const page = await read(url);
          push('read_url', { url }, { ok: true, text: JSON.stringify(page) });
          return page;
        } catch (error) {
          push(
            'read_url',
            { url },
            { ok: false, text: String((error as Error)?.message ?? error) },
          );
          throw error;
        }
      };
    },
    finish(end) {
      fixture.final = { url: end.url, title: end.title };
      if (end.outcome) fixture.outcome = end.outcome;
      save();
    },
  };
}

/** A recorder when `BENCH_RECORD_DIR` is set (one fixture per task id), else null. */
export function benchRecorderFromEnv(
  options: Omit<BenchRecorderOptions, 'root'>,
  environment: NodeJS.ProcessEnv = process.env,
): BenchRecorder | null {
  const root = environment.BENCH_RECORD_DIR?.trim();
  return root ? createBenchRecorder({ ...options, root }) : null;
}
