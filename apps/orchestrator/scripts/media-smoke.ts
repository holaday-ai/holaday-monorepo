/**
 * Media provider smoke (batch 08 §3). Strict call budget (BOSS, fal ≈ $8):
 *   DashScope: wan2.7-image ×1, Qwen Image poster ×1 (one fallback id only if
 *   the first id does not exist), Wan 2.7 t2v 5s ×1.  fal: nano-banana-2 ×1.
 *   Veo is NOT run.
 * Keys come only from the process env (--env-file); never printed. Output is
 * timing / success / provider error kind & status / sanitized detail.
 */
import { writeFileSync } from 'node:fs';
import { generateDashScopeImages } from '../src/agent/image/dashscope-image-client.js';
import { generateFalImages } from '../src/agent/image/fal-image-client.js';
import { generateBrollVideo } from '../src/agent/video/wanxiang-client.js';

const dashKey = (process.env.DASHSCOPE_INTL_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim();
const dashWorkspace = (
  process.env.DASHSCOPE_INTL_WORKSPACE_ID ||
  process.env.DASHSCOPE_WORKSPACE_ID ||
  ''
).trim();
const falKey = (process.env.FAL_KEY || '').trim();
const secrets = [dashKey, dashWorkspace, falKey].filter((value) => value.length > 0);
const scrub = (text: unknown) => {
  let out = String(text ?? '').slice(0, 300);
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
};

type Row = Record<string, unknown>;
const rows: Row[] = [];
async function attempt(name: string, model: string, fn: () => Promise<Row>): Promise<boolean> {
  const started = Date.now();
  try {
    const extra = await fn();
    rows.push({ name, model, ok: true, ms: Date.now() - started, ...extra });
    return true;
  } catch (error) {
    const e = error as { kind?: string; status?: number; detail?: string; message?: string };
    rows.push({
      name,
      model,
      ok: false,
      ms: Date.now() - started,
      kind: e.kind ?? 'error',
      status: e.status ?? null,
      detail: scrub(e.detail ?? e.message),
    });
    return false;
  } finally {
    process.stdout.write(`${JSON.stringify(rows.at(-1))}\n`);
  }
}
const modelMissing = () => {
  const last = rows.at(-1);
  return (
    !last?.ok &&
    /model|not ?found|InvalidParameter|does not exist|不存在/i.test(String(last?.detail))
  );
};

const dash = { apiKey: dashKey, ...(dashWorkspace ? { workspaceId: dashWorkspace } : {}) };

await attempt('dashscope_wan_image', 'wan2.7-image', async () => {
  const result = await generateDashScopeImages({
    ...dash,
    model: 'wan2.7-image',
    prompt: '一张木质办公桌，桌上整齐摆放收纳盒和绿植，自然光，摄影风格',
  });
  return { images: result.images.length, bytes: result.images[0]?.buffer.length ?? 0 };
});

const poster = (model: string) => async () => {
  const result = await generateDashScopeImages({
    ...dash,
    model,
    prompt: '秋季新品上市海报，大标题「秋季新品上市」，副标题「全场 8 折」，暖色调，简洁排版',
  });
  return { images: result.images.length, bytes: result.images[0]?.buffer.length ?? 0 };
};
if (
  !(await attempt(
    'dashscope_qwen_image_poster',
    'qwen-image-2.0-pro',
    poster('qwen-image-2.0-pro'),
  )) &&
  modelMissing()
)
  await attempt('dashscope_qwen_image_poster', 'qwen-image-2.1-pro', poster('qwen-image-2.1-pro'));

if (falKey) {
  await attempt('fal_nano_banana_2', 'fal-ai/nano-banana-2', async () => {
    const result = await generateFalImages({
      apiKey: falKey,
      model: 'fal-ai/nano-banana-2',
      editModel: 'fal-ai/nano-banana-2/edit',
      prompt: 'A tidy wooden desk with storage boxes and a small plant, soft daylight, photo',
      resolution: '1K',
    });
    return { images: result.images.length, bytes: result.images[0]?.buffer.length ?? 0 };
  });
}

await attempt('dashscope_wan_t2v_5s', 'wan2.7-t2v-2026-06-12', async () => {
  const result = await generateBrollVideo({
    ...dash,
    model: 'wan2.7-t2v-2026-06-12',
    prompt: '清晨阳光照进整洁的办公桌，镜头缓慢推进，收纳盒和绿植',
    resolution: '720P',
    ratio: '16:9',
    durationSeconds: 5,
    maxWaitMs: 600_000,
  });
  return { hasVideoUrl: Boolean(result.videoUrl) };
});

writeFileSync(
  'scripts/browser-eval/results/media-smoke.jsonl',
  `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
);
