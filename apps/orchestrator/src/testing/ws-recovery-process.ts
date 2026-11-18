import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExtensionToolCallOptions } from '../ws/server.js';
import type { IsolatedMysqlProbe } from './isolated-mysql-probe.js';

export interface RecoveryReady {
  type: 'ready';
  pid: number;
  httpPort: number;
  wsPort: number;
  node: string;
  rehydrated: { taskCount: number; userCount: number };
}
export type RecoveryCommand =
  | { op: 'extensions'; userId: string }
  | { op: 'tool'; userId: string; options: ExtensionToolCallOptions }
  | { op: 'cancel'; userId: string; taskId: string };

/** The parent owns the PID and namespace. This IPC channel is never an HTTP route. */
export function spawnRecoveryBackend(options: {
  probe: IsolatedMysqlProbe;
  logPath: string;
  filesRoot: string;
  ports?: Pick<RecoveryReady, 'httpPort' | 'wsPort'>;
}) {
  const child = fork(fileURLToPath(new URL('./ws-recovery-child.ts', import.meta.url)), [], {
    execPath: process.execPath,
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      HOLADAY_SQL_PROBE_OWNER: options.probe.ownershipToken,
      HOLADAY_FILES_ROOT: options.filesRoot,
      STORAGE_PROVIDER: 'local',
      HOLADAY_QA_HTTP_PORT: String(options.ports?.httpPort ?? 0),
      HOLADAY_QA_WS_PORT: String(options.ports?.wsPort ?? 0),
      LOG_LEVEL: 'error',
    },
  });
  const log = createWriteStream(options.logPath);
  child.stdout?.on('data', (chunk) => log.write(chunk));
  child.stderr?.on('data', (chunk) => log.write(chunk));
  child.once('close', () => log.end());
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => {
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('BACKEND_PROCESS_EXITED'));
      }
      pending.clear();
      resolve({ code, signal });
    }),
  );
  const ready = new Promise<RecoveryReady>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recovery child readiness timed out')), 30_000);
    child.on('message', (message) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'ready') {
        clearTimeout(timer);
        resolve(message as RecoveryReady);
      }
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Recovery child exited before ready'));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  child.on('message', (message) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'reply' ||
      !('id' in message) ||
      typeof message.id !== 'string'
    )
      return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if ('ok' in message && message.ok && 'result' in message) call.resolve(message.result);
    else
      call.reject(
        new Error('error' in message ? String(message.error) : 'RECOVERY_COMMAND_FAILED'),
      );
  });
  return {
    child,
    ready,
    exited,
    request<T>(command: RecoveryCommand): Promise<T> {
      if (!child.connected) return Promise.reject(new Error('BACKEND_PROCESS_EXITED'));
      return new Promise<T>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('RECOVERY_COMMAND_TIMEOUT'));
        }, 65_000);
        pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
        child.send({ type: 'command', id, ...command }, (error) => {
          if (!error) return;
          const call = pending.get(id);
          if (call) {
            pending.delete(id);
            clearTimeout(call.timer);
            call.reject(new Error('BACKEND_PROCESS_EXITED'));
          }
        });
      });
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      return exited;
    },
  };
}
export type RecoveryBackend = ReturnType<typeof spawnRecoveryBackend>;
