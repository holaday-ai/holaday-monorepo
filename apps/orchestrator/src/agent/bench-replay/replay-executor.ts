/**
 * REBUILD-3: serves a fixture's recorded tool results to the browser loop instead of a browser.
 *
 * A call is matched to a recorded one, in order: the same tool and input (volatile fields such as
 * `expect` ignored); for a read (snapshot, get_page_text, …) the next recorded read of that tool,
 * else the latest one already served. Anything else — a page the run never opened, a click it
 * never made — gets a clear "not in fixture" error result, never a guess.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UnifiedToolResult } from '../browser-tools/playwright-unified-executor.js';
import type { BenchFixture, FixtureStep } from './fixture.js';

export const NOT_IN_FIXTURE = 'not_in_fixture';

const VOLATILE_KEYS = new Set(['expect', 'observationRevision', 'cursor', 'reason']);
const READ_TOOLS = new Set([
  'snapshot',
  'read_page',
  'get_page_text',
  'sections',
  'links',
  'tables',
  'screenshot',
  'list_tabs',
]);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key, v]) => !VOLATILE_KEYS.has(key) && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

const keyOf = (tool: string, input: Record<string, unknown>) => `${tool}:${stable(input)}`;
const sameUrl = (a: unknown, b: unknown) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.replace(/#.*$/, '').replace(/\/$/, '') === b.replace(/#.*$/, '').replace(/\/$/, '');

export interface ReplayExecutor {
  execute(action: { tool: string } & Record<string, unknown>): Promise<UnifiedToolResult>;
  webSearch(query: string): Promise<Array<{ title: string; url: string }>>;
  readPage(url: string): Promise<{ url: string; title: string; markdown: string }>;
  currentUrl(): string;
  /** Recorded step indexes served, in order. */
  readonly served: number[];
  /** Calls the fixture had nothing for. */
  readonly misses: string[];
}

export function createReplayExecutor(
  fixture: BenchFixture,
  options: { dir?: string } = {},
): ReplayExecutor {
  const used = new Set<number>();
  const served: number[] = [];
  const misses: string[] = [];
  let cursor = -1;
  let url = 'about:blank';
  const lastOf = new Map<string, FixtureStep>();

  const pick = (tool: string, input: Record<string, unknown>): FixtureStep | undefined => {
    const key = keyOf(tool, input);
    const steps = fixture.steps;
    const exact =
      steps.find((s) => !used.has(s.index) && s.index > cursor && keyOf(s.tool, s.input) === key) ??
      steps.find((s) => !used.has(s.index) && keyOf(s.tool, s.input) === key);
    if (exact) return exact;
    if (tool === 'navigate' || tool === 'read_url')
      return steps.find((s) => s.tool === tool && sameUrl(s.input.url, input.url));
    if (READ_TOOLS.has(tool))
      return (
        steps.find((s) => s.tool === tool && !used.has(s.index) && s.index > cursor) ??
        lastOf.get(tool)
      );
    return undefined;
  };

  const serve = (step: FixtureStep): UnifiedToolResult => {
    used.add(step.index);
    served.push(step.index);
    cursor = Math.max(cursor, step.index);
    lastOf.set(step.tool, step);
    const { image, ...rest } = step.result;
    if (typeof rest.url === 'string' && rest.ok) url = rest.url;
    else if (step.tool === 'navigate' && rest.ok && typeof step.input.url === 'string')
      url = step.input.url;
    let picture: UnifiedToolResult['image'];
    if (image && options.dir) {
      try {
        picture = {
          mediaType: 'image/jpeg',
          data: readFileSync(join(options.dir, image)).toString('base64'),
        };
      } catch {
        /* A missing screenshot file serves the step without its image. */
      }
    }
    return { ...(rest as unknown as UnifiedToolResult), ...(picture ? { image: picture } : {}) };
  };

  const miss = (tool: string, input: Record<string, unknown>): UnifiedToolResult => {
    const said = `${tool} ${JSON.stringify(input).slice(0, 200)}`;
    misses.push(said);
    return {
      ok: false,
      errorCode: NOT_IN_FIXTURE,
      errorMessage: `not in fixture: ${said}`,
      text: `not in fixture: ${said}。回放只提供录制时读到的页面和做过的动作；请用已经读到的内容作答（finish），读不到的写进缺项。`,
    };
  };

  return {
    served,
    misses,
    currentUrl: () => url,
    async execute(action) {
      const { tool, ...input } = action;
      const step = pick(tool, input);
      return step ? serve(step) : miss(tool, input);
    },
    async webSearch(query) {
      const step = pick('web_search', { query });
      if (!step) {
        miss('web_search', { query });
        return [];
      }
      serve(step);
      try {
        return JSON.parse(step.result.text) as Array<{ title: string; url: string }>;
      } catch {
        return [];
      }
    },
    async readPage(target) {
      const step = pick('read_url', { url: target });
      if (!step?.result.ok) {
        miss('read_url', { url: target });
        throw new Error(`not in fixture: read_url ${target}`);
      }
      serve(step);
      return JSON.parse(step.result.text) as { url: string; title: string; markdown: string };
    },
  };
}
