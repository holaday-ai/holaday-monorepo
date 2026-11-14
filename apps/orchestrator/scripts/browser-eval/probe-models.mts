/**
 * Batch 11.0 — which free-tier models can drive the browser eval?
 *
 *   pnpm exec tsx --env-file=<env> scripts/browser-eval/probe-models.ts \
 *     --models qwen3.7-plus,qwen3.6-plus --out results/model-probe.csv
 *
 * One request per model (≤8 output tokens) carrying an image AND a tool
 * definition over the Anthropic-compatible Messages route: a 200 means the
 * model accepts vision input and function calling. Prints only model, HTTP
 * status and provider error code — never keys or headers.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { env as appEnv } from '../../src/config/env.js';
import { resolveQwenRoute } from '../../src/llm/qwen-route.js';

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const models = (value('--models') ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const out = value('--out');
const region = value('--region') === 'cn' ? 'cn' : 'intl';
const image = readFileSync(
  new URL('../../../extension/public/icons/icon-48.png', import.meta.url),
).toString('base64');

interface ProbeRow {
  model: string;
  status: number | 'timeout' | 'network';
  code: string;
  toolCall: boolean;
  ms: number;
}

async function probe(model: string): Promise<ProbeRow> {
  const route = resolveQwenRoute(appEnv, region, 'standard', 'messages');
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${route.baseURL}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': route.apiKey,
        ...(route.workspaceId ? { 'x-dashscope-workspace': route.workspaceId } : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        thinking: { type: 'disabled' },
        tools: [
          {
            name: 'report_color',
            description: 'Report the main color of the image.',
            input_schema: {
              type: 'object',
              properties: { color: { type: 'string' } },
              required: ['color'],
            },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
              { type: 'text', text: 'Call report_color.' },
            ],
          },
        ],
      }),
    });
    const text = await res.text();
    let code = '';
    let toolCall = false;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const error = (json.error ?? {}) as Record<string, unknown>;
      const raw = error.code ?? json.code ?? error.type;
      code = typeof raw === 'string' ? raw.slice(0, 80) : '';
      toolCall =
        Array.isArray(json.content) &&
        json.content.some((block) => (block as { type?: string }).type === 'tool_use');
    } catch {
      /* non-JSON body: status alone */
    }
    return { model, status: res.status, code, toolCall, ms: Date.now() - started };
  } catch {
    return {
      model,
      status: controller.signal.aborted ? 'timeout' : 'network',
      code: '',
      toolCall: false,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

const rows: ProbeRow[] = [];
for (const model of models) {
  const row = await probe(model);
  rows.push(row);
  console.log(
    `${row.model}\tstatus=${row.status}\tcode=${row.code || '-'}\ttool_use=${row.toolCall}\t${row.ms}ms`,
  );
}
if (out) {
  writeFileSync(
    out,
    `model,status,code,toolUse,ms\n${rows.map((r) => `${r.model},${r.status},${r.code},${r.toolCall},${r.ms}`).join('\n')}\n`,
  );
}
