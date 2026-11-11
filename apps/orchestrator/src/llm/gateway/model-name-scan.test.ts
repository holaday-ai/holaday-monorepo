import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * REBUILD-2: business code asks the gateway for a role; model names live only in config
 * (config/env.ts, gateway/role-models.ts via the catalog), the catalog and the price tables.
 * This scan covers every file migrated to the gateway plus the adapter consumers they feed.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIGRATED_BUSINESS_FILES = [
  // Call sites that now resolve through the gateway.
  'trpc/routers/tasks.ts',
  'trpc/routers/tasks-core-create.ts',
  'trpc/routers/tasks-core-reply.ts',
  'trpc/routers/video-editing.ts',
  'agent/supercar/plan-provider.ts',
  'agent/supercar/plan-runner.ts',
  'agent/suggestions-provider.ts',
  'agent/core-task-plan.ts',
  'agent/core-task-suggestions.ts',
  'agent/a-share/ashare-model-callers.ts',
  'agent/video/media-model-services.ts',
  'playbook/evolution/executor-hooks.ts',
  'playbook/evolution/evolution-runtime.ts',
  // Consumers of the adapters those call sites hand out.
  'agent/browser-tools/unified-browser-loop.ts',
  'agent/browser-tools/browser-brain-roles.ts',
  'execution/llm-verifier.ts',
  'agent/scrape-field-judge.ts',
  'agent/generate-runner.ts',
  'agent/scrape-runner.ts',
  'agent/video/video-script.ts',
  'playbook/replay/model-assist.ts',
  'playbook/evolution/generalize.ts',
  // The gateway itself (role-models.ts reads names from the catalog, never literals).
  'llm/gateway/model-gateway.ts',
  'llm/gateway/model-roles.ts',
  'llm/gateway/normalize.ts',
  'llm/gateway/role-models.ts',
  'llm/gateway/settings.ts',
];

/**
 * Literals that are not chat-model choices, each with its reason. Anything else is a finding.
 */
const ALLOWED: Record<string, readonly string[]> = {
  // Media TTS voice for the video lane config (not a chat role; out of scope).
  // Legacy model-selector quota label compared against its Opus route (dormant path).
  'trpc/routers/tasks.ts': ['qwen3-tts-flash', 'claude-opus-4-7'],
};

/** A quoted Qwen / GPT / Claude model id such as 'qwen3.8-flash', "gpt-4o", `claude-…`. */
const MODEL_LITERAL = /(['"`])((?:qwen|gpt|claude)[-.0-9][^'"`\s]*)\1/gi;

function codeLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .map((line) => line.replace(/\s\/\/\s.*$/, ''));
}

describe('model-name literals in migrated business code', () => {
  it.each(MIGRATED_BUSINESS_FILES)('%s names no model', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8');
    const found = codeLines(source).flatMap((line) =>
      [...line.matchAll(MODEL_LITERAL)].map((match) => match[2] ?? ''),
    );
    const unexpected = found.filter((literal) => !(ALLOWED[file] ?? []).includes(literal));
    expect(unexpected).toEqual([]);
    // A stale allow-list entry would hide a future literal with the same name.
    for (const allowed of ALLOWED[file] ?? []) expect(found).toContain(allowed);
  });

  it('detects a literal (the scan itself works)', () => {
    const lines = codeLines(["const m = 'qwen3.8-flash';", "// 'gpt-4o' in a comment"].join('\n'));
    expect(lines.flatMap((line) => [...line.matchAll(MODEL_LITERAL)].map((m) => m[2]))).toEqual([
      'qwen3.8-flash',
    ]);
  });
});
