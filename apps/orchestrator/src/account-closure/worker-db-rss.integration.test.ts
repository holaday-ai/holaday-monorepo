import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RSS_RECORD = /ACCOUNT_CLOSURE_RSS=(\{[^\n]+\})/;

describe.sequential('account closure database-backed worker RSS release gate', () => {
  it('runs the real registry against the 205-object synthetic account in a child below 512MB', async () => {
    const result = await runReleaseGateChild();
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/(?:uncaught|unhandled|error:)/i);
    const match = RSS_RECORD.exec(result.stdout);
    expect(match?.[1]).toBeDefined();
    const record = JSON.parse(match?.[1] ?? '{}') as {
      completed: boolean;
      fileCount: number;
      handlerCount: number;
      objectCount: number;
      peakRss: number;
    };
    expect(record).toMatchObject({
      completed: true,
      handlerCount: 13,
      fileCount: 205,
      objectCount: 206,
    });
    expect(record.peakRss).toBeGreaterThan(0);
    expect(record.peakRss).toBeLessThan(512 * 1024 * 1024);
    process.stdout.write(`ACCOUNT_CLOSURE_RSS_VERIFIED=${JSON.stringify(record)}\n`);
  }, 120_000);
});

function runReleaseGateChild(): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const orchestratorRoot = fileURLToPath(new URL('../../', import.meta.url));
    const vitestEntry = fileURLToPath(
      new URL('../../node_modules/vitest/vitest.mjs', import.meta.url),
    );
    const child = spawn(
      process.execPath,
      [
        vitestEntry,
        'run',
        '--config',
        'vitest.integration.config.ts',
        'src/account-closure/release-gates.integration.test.ts',
      ],
      {
        cwd: orchestratorRoot,
        env: { ...process.env, ACCOUNT_CLOSURE_RSS_CHILD: '1' },
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
