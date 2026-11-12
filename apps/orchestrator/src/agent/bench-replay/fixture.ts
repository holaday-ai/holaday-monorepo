/**
 * REBUILD-3 fixed-sample replay: the recorded tool calls of one benchmark question.
 *
 * Layout: `<root>/<id>/fixture.json` plus `<root>/<id>/step-<n>.jpg` for screenshots. Each step
 * is one tool call the browser loop made and the result it received (page text, snapshot tree
 * text, a screenshot by file name), in order; `final` is the page the run ended on.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_FILE = 'fixture.json';
export const FIXTURE_VERSION = 1;

/** A tool result as the loop received it; the screenshot is a file next to fixture.json. */
export interface RecordedResult {
  ok: boolean;
  text: string;
  url?: string;
  tabId?: string;
  openedTab?: boolean;
  errorCode?: string;
  errorMessage?: string;
  /** File name of the screenshot (`step-3.jpg`). */
  image?: string;
  [key: string]: unknown;
}

export interface FixtureStep {
  index: number;
  /** A browser action (`snapshot`, `navigate`, …), or `web_search` / `read_url`. */
  tool: string;
  input: Record<string, unknown>;
  result: RecordedResult;
  /** Milliseconds since the recording started. */
  atMs: number;
}

export interface BenchFixture {
  version: number;
  id: string;
  /** The intent the loop got (with 【结果要求】 / 【站点提示】). */
  intent: string;
  /** The user's own words. */
  userIntent?: string;
  observationV2?: boolean;
  recordedAt: string;
  steps: FixtureStep[];
  final?: { url: string; title: string };
  /** What the recorded run delivered (for comparison only). */
  outcome?: { status: string; summary?: string };
}

export function readFixture(dir: string): BenchFixture {
  const fixture = JSON.parse(readFileSync(join(dir, FIXTURE_FILE), 'utf8')) as BenchFixture;
  if (fixture.version !== FIXTURE_VERSION || !Array.isArray(fixture.steps))
    throw new Error(`unsupported fixture in ${dir}`);
  return fixture;
}

/** The fixture directories under `root`, sorted by id. */
export function listFixtureDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, FIXTURE_FILE)))
    .map((entry) => join(root, entry.name))
    .sort();
}

/** A directory-safe fixture id. */
export function fixtureId(raw: string): string {
  return raw.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'unnamed';
}
