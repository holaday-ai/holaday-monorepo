import { type ChildProcess, fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  type IsolatedMysqlProbe,
  openIsolatedMysqlProbe,
} from '../testing/isolated-mysql-probe.js';

const enabled =
  process.env.HOLADAY_SQL_PERSISTENCE_PROBE === '1' &&
  process.env.HOLADAY_PROCESS_RECOVERY_PROBE === '1';
interface Ready {
  type: 'ready';
  pid: number;
  httpPort: number;
  wsPort: number;
  node: string;
  rehydrated: { taskCount: number; userCount: number };
}
interface Running {
  child: ChildProcess;
  ready: Ready;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
let probe: IsolatedMysqlProbe;
let root: string;
let artifacts: string;
const children: Running[] = [];
const sockets: WebSocket[] = [];
const evidence: Record<string, unknown> = {
  modelAPICalls: 0,
  accounts: 'synthetic isolated SQL rows',
  startupPath: 'real HTTP/WS modules with legacy rehydration, not controlled maintenance boot',
};
async function stop(running: Running) {
  if (running.child.exitCode === null && running.child.signalCode === null)
    running.child.kill('SIGKILL');
  return running.exited;
}
async function start(ports?: Ready): Promise<Running> {
  const child = fork(
    fileURLToPath(new URL('../testing/ws-recovery-child.ts', import.meta.url)),
    [],
    {
      execPath: process.execPath,
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        HOLADAY_SQL_PROBE_OWNER: probe.ownershipToken,
        HOLADAY_FILES_ROOT: join(root, 'files'),
        STORAGE_PROVIDER: 'local',
        HOLADAY_QA_HTTP_PORT: String(ports?.httpPort ?? 0),
        HOLADAY_QA_WS_PORT: String(ports?.wsPort ?? 0),
        LOG_LEVEL: 'error',
      },
    },
  );
  const log = createWriteStream(join(artifacts, `child-${children.length + 1}.log`));
  child.stdout?.on('data', (chunk) => log.write(chunk));
  child.stderr?.on('data', (chunk) => log.write(chunk));
  child.once('close', () => log.end());
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const running = { child, exited, ready: undefined as unknown as Ready };
  children.push(running);
  running.ready = await new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Recovery child readiness timed out; inspect child log')),
      30_000,
    );
    child.on('message', (message) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'ready') {
        clearTimeout(timer);
        resolve(message as Ready);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Recovery child exited before ready (${code})`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return running;
}
async function connect(backend: Ready, token: string) {
  const frames: Array<Record<string, unknown>> = [];
  const socket = new WebSocket(`ws://127.0.0.1:${backend.wsPort}`, ['holaday.v1', `jwt.${token}`]);
  sockets.push(socket);
  socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'client.hello', token, extensionVersion: 'web-workbench' }));
  return { socket, frames, closed };
}
describe.runIf(enabled)(
  'real backend process crash with isolated MySQL and default WS authentication',
  () => {
    beforeAll(async () => {
      if (!process.version.startsWith('v22.'))
        throw new Error('Process recovery acceptance requires the Node22 runtime');
      root = await mkdtemp(join(tmpdir(), 'ba-process-recovery-'));
      artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(root, 'artifacts');
      await mkdir(artifacts, { recursive: true });
      vi.stubEnv('DATABASE_URL', process.env.HOLADAY_SQL_TEST_URL!);
      vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379/0');
      vi.stubEnv('JWT_SECRET', randomBytes(48).toString('hex'));
      vi.stubEnv('NODE_ENV', 'test');
      probe = await openIsolatedMysqlProbe({
        allTableStructures: true,
        artifactPath: join(artifacts, 'mysql-evidence.json'),
      });
    });
    afterAll(async () => {
      try {
        for (const socket of sockets) socket.terminate();
        for (const child of children) await stop(child);
        await probe?.close();
        if (artifacts)
          await writeFile(
            join(artifacts, 'process-evidence.json'),
            JSON.stringify(evidence, null, 2),
          );
      } finally {
        vi.unstubAllEnvs();
        if (root) await rm(root, { recursive: true, force: true });
      }
    });
    it('uses a new PID to restore owned state and files, refuses absent SQL users and never redispatches the interrupted unified task', async () => {
      const { newExternalId } = await import('@holaday/shared-types');
      const { users } = await import('../db/schema/users.js');
      const { tasks } = await import('../db/schema/tasks.js');
      const { TaskRepository } = await import('../agent/task-repository.js');
      const { signAccessToken } = await import('../auth/jwt.js');
      const { FileService } = await import('../files/file-service.js');
      const { LocalStorageProvider } = await import('../files/storage-provider.js');
      const owner = newExternalId('user');
      const other = newExternalId('user');
      await probe.db.insert(users).values([
        {
          id: 7,
          externalId: owner,
          email: 'process-owner@example.test',
          passwordHash: 'synthetic-only',
        },
        {
          id: 8,
          externalId: other,
          email: 'process-other@example.test',
          passwordHash: 'synthetic-only',
        },
      ]);
      const token = await signAccessToken({ sub: owner, plan: 'free' });
      const first = await start();
      expect(first.ready.rehydrated.taskCount).toBe(0);
      const before = await connect(first.ready, token);
      await vi.waitFor(() =>
        expect(before.frames.some((frame) => frame.type === 'server.welcome')).toBe(true),
      );
      const repo = new TaskRepository(probe.db);
      const completed = newExternalId('task');
      const unknown = newExternalId('task');
      const awaiting = newExternalId('task');
      const textTask = newExternalId('task');
      for (const taskId of [completed, unknown, awaiting])
        await repo.insertTask(
          { taskId, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
          {
            userId: 7,
            intent: `Process recovery ${taskId}`,
            sourceContext: { browserSource: 'local-chrome' },
          },
        );
      await probe.db
        .update(tasks)
        .set({
          createdAt: new Date(Date.now() - 180_000),
          result: { summary: 'Verified progress before interruption' },
        })
        .where(eq(tasks.externalId, unknown));
      await probe.db
        .update(tasks)
        .set({
          status: 'awaiting_user',
          awaitingQuestion: '请核对导出范围后继续。',
          awaitingKind: 'clarification',
        })
        .where(eq(tasks.externalId, awaiting));
      await repo.insertTask(
        { taskId: textTask, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
        { userId: 7, intent: 'Text-only unfinished task without browser authority' },
      );
      const [task] = await probe.db.select().from(tasks).where(eq(tasks.externalId, completed));
      const logger = pino({ level: 'silent' });
      const files = new FileService(
        probe.db,
        logger,
        new LocalStorageProvider(join(root, 'files'), logger),
      );
      const payloads = [
        { filename: 'report.csv', buffer: Buffer.from('channel,amount\nweb,10.00\n') },
        { filename: 'analysis.csv', buffer: Buffer.from('metric,value\nsum,10.00\nrows,1\n') },
      ];
      const stored = [];
      for (const payload of payloads)
        stored.push(
          await files.storeOutput({
            ...payload,
            userIdInternal: 7,
            userExternalId: owner,
            taskIdInternal: task!.id,
            mimetype: 'text/csv',
          }),
        );
      const summary = '进程退出前已保存的原报表和分析结果。';
      expect(
        await repo.persistVisionOutcome(completed, { status: 'completed', summary, tickCount: 1 }),
      ).toEqual({ persisted: true });
      const crash = await stop(first);
      expect(crash.signal).toBe('SIGKILL');
      expect(await before.closed).toBe(1006);
      const second = await start(first.ready);
      expect(second.ready.pid).not.toBe(first.ready.pid);
      expect(second.ready.node).toBe(process.version);
      const [postSweep] = await probe.db.select().from(tasks).where(eq(tasks.externalId, unknown));
      evidence.unknownPostStartupSweep = postSweep?.status;
      expect(postSweep?.status).toBe('awaiting_user');
      expect(second.ready.rehydrated.taskCount).toBe(3);
      const absent = await connect(
        second.ready,
        await signAccessToken({ sub: newExternalId('user'), plan: 'free' }),
      );
      expect(await absent.closed).toBe(4401);
      expect(absent.frames.some((frame) => frame.type === 'server.welcome')).toBe(false);
      const otherToken = await signAccessToken({ sub: other, plan: 'free' });
      const unrelated = await connect(second.ready, otherToken);
      await vi.waitFor(() =>
        expect(unrelated.frames.some((frame) => frame.type === 'server.welcome')).toBe(true),
      );
      const origin = `http://127.0.0.1:${second.ready.httpPort}`;
      const denied = await fetch(`${origin}/api/files/${stored[0]!.externalId}/download`, {
        headers: { authorization: `Bearer ${otherToken}` },
      });
      expect(denied.status).toBe(404);
      const restored = await connect(second.ready, token);
      await vi.waitFor(() => {
        expect(restored.frames).toContainEqual(
          expect.objectContaining({
            type: 'server.supercar.awaiting_user',
            taskId: unknown,
            awaitingKind: 'browser_action',
            question: expect.stringContaining('结果尚未核实'),
          }),
        );
        expect(restored.frames).toContainEqual(
          expect.objectContaining({
            type: 'server.supercar.awaiting_user',
            taskId: awaiting,
            question: '请核对导出范围后继续。',
          }),
        );
      });
      expect(restored.frames.some((frame) => frame.type === 'server.task.dispatch')).toBe(false);
      expect(restored.frames).toContainEqual(
        expect.objectContaining({
          type: 'server.task.terminal',
          taskId: textTask,
          status: 'failed',
        }),
      );
      expect(
        unrelated.frames.some((frame) =>
          [completed, unknown, awaiting].includes(String(frame.taskId)),
        ),
      ).toBe(false);
      const detailResponse = await fetch(
        `${origin}/api/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId: completed }))}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(detailResponse.status).toBe(200);
      const detail = await detailResponse.json();
      expect(JSON.stringify(detail)).toContain(summary);
      const downloads = [];
      for (let index = 0; index < stored.length; index++) {
        const response = await fetch(`${origin}/api/files/${stored[index]!.externalId}/download`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        const buffer = Buffer.from(await response.arrayBuffer());
        expect(buffer).toEqual(payloads[index]!.buffer);
        downloads.push({
          filename: stored[index]!.filename,
          bytes: buffer.length,
          sha256: createHash('sha256').update(buffer).digest('hex'),
        });
      }
      expect(await repo.isCurrentCompletedOutcome(completed, summary)).toBe(true);
      const [stopped] = await probe.db.select().from(tasks).where(eq(tasks.externalId, unknown));
      expect(stopped).toMatchObject({ status: 'awaiting_user', awaitingKind: 'browser_action' });
      expect(stopped?.awaitingQuestion).toContain('不会自动重复');
      expect(stopped?.errorCode).toBe('BROWSER_RESULT_UNCONFIRMED');
      const replyResponse = await fetch(`${origin}/api/trpc/tasks.reply`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: unknown, message: '继续' }),
      });
      expect(replyResponse.status).toBe(200);
      expect(JSON.stringify(await replyResponse.json())).toContain('stillAwaiting');

      expect(stopped?.result).toMatchObject({ summary: 'Verified progress before interruption' });
      for (const taskExternalId of [unknown, completed])
        expect(
          await repo.persistAwaitingUser({
            taskExternalId,
            restartRecovery: true,
            awaitingKind: 'browser_action',
            question: 'stale recovery prompt',
          }),
        ).toEqual({ persisted: false });
      const [stillWaiting] = await probe.db
        .select()
        .from(tasks)
        .where(eq(tasks.externalId, unknown));
      expect(stillWaiting?.awaitingQuestion).toContain('结果尚未核实');

      Object.assign(evidence, {
        node: process.version,
        childPids: children.map((child) => child.ready.pid),
        crash,
        oldSocketCloseCode: 1006,
        actualDefaultAuthentication: true,
        actualLegacyStartupSqlSweep: true,
        unrelatedTextTaskKeepsLegacyFailure: true,
        absentSignedUserDenied: true,
        crossOwnerDownloadDenied: true,
        ownedAwaitingPromptRestored: true,
        unknownUnifiedTaskWaitsWithoutReplay: true,
        completedHistoryReadback: true,
        downloads,
        websocketFrameTypes: restored.frames.map((frame) => frame.type),
      });
    }, 120_000);
  },
);
