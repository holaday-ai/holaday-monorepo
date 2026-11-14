import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * REBUILD-2: business code asks the gateway for a role; model names live only in config
 * (config/env.ts, gateway/role-models.ts via the catalog), the catalog and the price tables.
 *
 * Review #1: the scan covers the whole of `src` (every non-test .ts file). A literal outside the
 * config files is a finding unless it is listed in NOT_MIGRATED (with its reason; the same list
 * is the 「未迁移清单」 in gateway/README.md) or NOT_A_MODEL. Migrated files may never appear in
 * either list.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Model names are configuration here. */
const CONFIG_FILES = new Set([
  'config/env.ts',
  'llm/model-catalog.ts',
  'llm/model-price-catalog.ts',
  // Legacy per-model price table for cost recording (prices, not a model choice).
  'agent/llm-call-recorder.ts',
]);

/** Literals that look like model ids but are not. */
const NOT_A_MODEL: Record<string, readonly string[]> = {
  'llm/core-model-observation.ts': ['qwen.core.call'], // log event name
  'agent/video/qwen-only-video-runtime.ts': ['qwen-av-sync-pending'], // status code
  'agent/search-fallback/search-provider.ts': ['qwen-cn'], // provider id (search-api:qwen-cn)
};

type NotMigratedReason = 'dormant' | 'media' | 'search-vehicle' | 'non-qwen';
/**
 * Model literals still in business code, by file. Keep in sync with the README list.
 *   dormant        – Claude / OpenAI paths that never run on the Qwen-only production runtime
 *   media          – image / video / TTS / voice / lip-sync models (not chat roles)
 *   search-vehicle – a model used only to trigger provider web search; its text is discarded
 *   non-qwen       – a chat call on a non-Qwen provider the gateway's Qwen table cannot serve
 */
const NOT_MIGRATED: Record<string, { reason: NotMigratedReason; literals: readonly string[] }> = {
  'agent/search-fallback/search-provider.ts': {
    reason: 'search-vehicle',
    literals: ['qwen-flash'],
  },
  'trpc/routers/tasks.ts': {
    reason: 'media', // TTS / Wan i2v / clone-mode enum; plus the dormant Opus quota label
    literals: ['qwen3-tts-flash', 'wan2.2-i2v-flash', 'wan-std', 'wan-pro', 'claude-opus-4-7'],
  },
  'agent/video/video-av-sync-verifier.ts': { reason: 'non-qwen', literals: ['gemini-3.6-flash'] },
  'agent/video/fal-lipsync-client.ts': { reason: 'media', literals: ['fal-ai/latentsync'] },
  'agent/video/gemini-tts-client.ts': {
    reason: 'media',
    literals: ['gemini-2.5-flash-preview-tts'],
  },
  'agent/video/qwen-voice-clone-client.ts': {
    reason: 'media',
    literals: ['qwen-voice-enrollment', 'qwen3-tts-vc-2026-01-22'],
  },
  'agent/video/veo-client.ts': { reason: 'media', literals: ['veo-3.0-fast-generate-001'] },
  'agent/video/video-confirm.ts': {
    reason: 'media',
    literals: ['fal-ai/sync-lipsync/v2', 'fal-ai/sync-lipsync/v3', 'wan-pro', 'wan-std'],
  },
  'agent/video/video-lane-simple.ts': {
    reason: 'media',
    literals: [
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'veo-3.1-fast-generate-preview',
      'veo-3.1-generate-preview',
      'veo-3.1-lite-generate-preview',
    ],
  },
  'agent/video/video-pet-i2v.ts': { reason: 'media', literals: ['wan2.7-i2v'] },
  'agent/video/wan-animate-mix-client.ts': {
    reason: 'media',
    literals: ['wan-pro', 'wan-std', 'wan2.2-animate-mix'],
  },
  'agent/video/wanxiang-client.ts': {
    reason: 'media',
    literals: ['wan2.2-t2i-flash', 'wan2.7-i2v', 'wan2.7-t2v', 'wan2.7-t2v-2026-06-12'],
  },
  'agent/image/model-router.ts': {
    reason: 'media',
    literals: ['gemini-3-pro-image', 'gemini-3.1-flash-image'],
  },
  // Legacy Anthropic client fallbacks (the adapter path through the gateway is what runs).
  'agent/video/video-quality-verifier.ts': { reason: 'dormant', literals: ['claude-sonnet-4-6'] },
  'agent/image/image-subject-verifier.ts': { reason: 'dormant', literals: ['claude-sonnet-4-6'] },
  'agent/supercar/ota-user-browser-runner.ts': {
    reason: 'dormant',
    literals: ['claude-sonnet-4-6'],
  },
  'agent/visual-verifier.ts': { reason: 'dormant', literals: ['claude-sonnet-4-6'] },
  'agent/vision-loop/commander.ts': { reason: 'dormant', literals: ['claude-sonnet-4-6'] },
  'agent/planners/anthropic.ts': { reason: 'dormant', literals: ['claude-opus-4-7'] },
  'agent/model-selector.ts': {
    reason: 'dormant',
    literals: ['claude-opus-4-7', 'claude-sonnet-4-6'],
  },
  'agent/supercar/prompt-layers.ts': {
    reason: 'dormant',
    literals: ['claude-haiku-4-5', 'claude-sonnet-4-6'],
  },
  'agent/supercar/agent-loop.ts': {
    reason: 'dormant',
    literals: ['claude-haiku-4-5', 'claude-opus-4-7', 'claude-sonnet-4-6'],
  },
  'response-layer/openai-verifier-fallback.ts': { reason: 'dormant', literals: ['gpt-4o-mini'] },
};

/** Files migrated to the gateway (and the adapter consumers they feed): never on a list. */
const MIGRATED_BUSINESS_FILES = [
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
  'agent/browser-tools/unified-browser-loop.ts',
  'agent/browser-tools/browser-brain-roles.ts',
  'execution/llm-verifier.ts',
  'agent/scrape-field-judge.ts',
  'agent/generate-runner.ts',
  'agent/scrape-runner.ts',
  'agent/video/video-script.ts',
  'playbook/replay/model-assist.ts',
  'playbook/evolution/generalize.ts',
  'llm/gateway/model-gateway.ts',
  'llm/gateway/model-roles.ts',
  'llm/gateway/normalize.ts',
  'llm/gateway/role-models.ts',
  'llm/gateway/settings.ts',
  'llm/gateway/thinking.ts',
];

/** A quoted model id: Qwen / GPT / Claude / Gemini / Wan / Veo, or a fal-ai endpoint. */
const MODEL_LITERAL =
  /(['"`])((?:qwen|gpt|claude|gemini|wan|veo)[-.0-9][^'"`\s]*|fal-ai\/[^'"`\s]*)\1/gi;

function codeLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .map((line) => line.replace(/\s\/\/\s.*$/, ''));
}

function literalsIn(source: string): string[] {
  return [
    ...new Set(
      codeLines(source).flatMap((line) =>
        [...line.matchAll(MODEL_LITERAL)].map((match) => match[2] ?? ''),
      ),
    ),
  ];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts') || /\.test\.ts$|\.d\.ts$/.test(entry.name)) return [];
    return [relative(SRC, path).split(sep).join('/')];
  });
}

const ALL_FILES = sourceFiles(SRC);

describe('model-name literals across src', () => {
  it('scans the whole tree', () => {
    expect(ALL_FILES.length).toBeGreaterThan(500);
    for (const file of MIGRATED_BUSINESS_FILES) expect(ALL_FILES).toContain(file);
  });

  it('finds no model literal outside config and the not-migrated list', () => {
    const findings: Record<string, string[]> = {};
    for (const file of ALL_FILES) {
      if (CONFIG_FILES.has(file)) continue;
      const allowed = new Set([
        ...(NOT_MIGRATED[file]?.literals ?? []),
        ...(NOT_A_MODEL[file] ?? []),
      ]);
      const unexpected = literalsIn(readFileSync(join(SRC, file), 'utf8')).filter(
        (literal) => !allowed.has(literal),
      );
      if (unexpected.length) findings[file] = unexpected;
    }
    expect(findings).toEqual({});
  });

  it.each(Object.keys({ ...NOT_MIGRATED, ...NOT_A_MODEL }))(
    '%s: every listed literal is still there (a stale entry would hide a new one)',
    (file) => {
      const found = literalsIn(readFileSync(join(SRC, file), 'utf8'));
      for (const literal of [...(NOT_MIGRATED[file]?.literals ?? []), ...(NOT_A_MODEL[file] ?? [])])
        expect(found).toContain(literal);
    },
  );

  it('never lists a migrated file', () => {
    for (const file of MIGRATED_BUSINESS_FILES) {
      expect(NOT_MIGRATED[file]).toBeUndefined();
      expect(NOT_A_MODEL[file]).toBeUndefined();
    }
  });

  it('detects a literal (the scan itself works)', () => {
    const source = [
      "const m = 'qwen3.8-flash';",
      "const v = 'fal-ai/veo3.1';",
      "// 'gpt-4o' in a comment",
      'class QwenRouteError {}',
    ].join('\n');
    expect(literalsIn(source)).toEqual(['qwen3.8-flash', 'fal-ai/veo3.1']);
  });
});
