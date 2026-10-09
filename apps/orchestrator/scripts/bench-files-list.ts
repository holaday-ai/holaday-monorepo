/**
 * Local server-side benchmark for files.list (SMALL-FIXES-1). Creates a
 * throw-away user and N library rows in the configured DATABASE_URL (a local
 * dev / test database — never production), serves the real HTTP app on
 * 127.0.0.1, calls files.list over HTTP and reports client latency and the
 * Server-Timing phases, then deletes everything it created.
 *
 *   JWT_SECRET=… DATABASE_URL=mysql://…local… REDIS_URL=… \
 *     pnpm exec tsx scripts/bench-files-list.ts --files 60 --legacy 3 --runs 40
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import { signAccessToken } from '../src/auth/jwt.js';
import { db, pool } from '../src/db/client.js';
import { taskFiles } from '../src/db/schema/task-files.js';
import { users } from '../src/db/schema/users.js';
import { createHttpApp } from '../src/http.js';

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}
const files = arg('files', 60);
const legacy = arg('legacy', 3);
const runs = arg('runs', 40);
if (/@(?!127\.0\.0\.1|localhost)/.test(process.env.DATABASE_URL ?? ''))
  throw new Error('bench-files-list only runs against a local database');

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
};

const externalId = newExternalId('user');
await db.insert(users).values({
  externalId,
  email: `${externalId}@bench.invalid`,
  passwordHash: '',
  plan: 'pro',
  modelDataRegion: 'cn',
});
const [user] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.externalId, externalId));
if (!user) throw new Error('bench user missing');
const server = createServer(createHttpApp({ planner: {} as never }));
try {
  for (let i = 0; i < files; i += 1) {
    const fileId = newExternalId('file');
    await db.insert(taskFiles).values({
      externalId: fileId,
      userId: user.id,
      kind: 'input',
      filename: `bench-${i}.png`,
      mimetype: 'image/png',
      sizeBytes: 1024,
      // A few legacy absolute disk paths (missing) exercise the availability check.
      storagePath:
        i < legacy
          ? `/tmp/holaday-files/${externalId}/input/${fileId}/bench-${i}.png`
          : `${externalId}/input/${fileId}/bench-${i}.png`,
      status: 'active',
    });
  }
  const token = await signAccessToken({ sub: externalId, plan: 'pro' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const url = `${base}/trpc/files.list?input=${encodeURIComponent(JSON.stringify({ type: 'all', limit: 50 }))}`;
  const client: number[] = [];
  const phases: Record<string, number[]> = {};
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    await response.arrayBuffer();
    client.push(performance.now() - started);
    if (response.status !== 200) throw new Error(`files.list HTTP ${response.status}`);
    for (const entry of (response.headers.get('server-timing') ?? '').split(',')) {
      const match = /([a-z_-]+);dur=([0-9.]+)/.exec(entry.trim());
      if (!match?.[1] || !match[2]) continue;
      const values = phases[match[1]] ?? [];
      values.push(Number(match[2]));
      phases[match[1]] = values;
    }
  }
  const row = (name: string, values: number[]) =>
    `${name.padEnd(8)} P50=${pct(values, 50).toFixed(1)}ms P95=${pct(values, 95).toFixed(1)}ms max=${Math.max(...values).toFixed(1)}ms`;
  console.log(
    `files=${files} legacy=${legacy} runs=${runs} (first call includes the cold availability cache)`,
  );
  console.log(row('client', client));
  for (const [name, values] of Object.entries(phases)) console.log(row(name, values));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.delete(taskFiles).where(eq(taskFiles.userId, user.id));
  await db.delete(users).where(eq(users.id, user.id));
  await pool.end();
  process.exit(0);
}
