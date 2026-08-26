import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('account closure worker process release smoke', () => {
  it('runs exactly one independent worker process below the PM2 RSS ceiling and drains SIGTERM', async () => {
    const workerUrl = new URL('./worker.ts', import.meta.url).href;
    const script = `
      import { EventEmitter } from 'node:events';
      import { runAccountClosureWorkerRuntime } from ${JSON.stringify(workerUrl)};
      const signals = new EventEmitter();
      let ticks = 0;
      await runAccountClosureWorkerRuntime({
        signals,
        pollMs: 1000,
        tick: async () => {
          ticks += 1;
          setTimeout(() => signals.emit('SIGTERM'), 5);
          await new Promise((resolve) => setTimeout(resolve, 20));
          return 'progress';
        },
      });
      process.stdout.write(JSON.stringify({ pid: process.pid, rss: process.memoryUsage().rss, ticks }));
    `;
    const result = await runChild(script);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/(?:uncaught|unhandled|error:)/i);
    const record = JSON.parse(result.stdout) as { pid: number; rss: number; ticks: number };
    expect(record.pid).toBeGreaterThan(1);
    expect(record.rss).toBeLessThan(512 * 1024 * 1024);
    expect(record.ticks).toBe(1);
  });
});

function runChild(
  script: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}
