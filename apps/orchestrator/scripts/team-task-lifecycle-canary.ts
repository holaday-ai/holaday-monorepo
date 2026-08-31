import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../src/config/env.js';
import { db, pool } from '../src/db/client.js';
import {
  resolveLifecycleCanaryCliConfiguration,
  runLifecycleCanaryCli,
} from '../src/team-work-items/team-task-lifecycle-canary-cli.js';
import { createTeamTaskLifecycleProductionCanary } from '../src/team-work-items/team-task-lifecycle-production-canary.js';

const execFileAsync = promisify(execFile);

async function currentRevision(): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  return stdout.trim();
}

async function main(): Promise<void> {
  try {
    const configuration = resolveLifecycleCanaryCliConfiguration(
      process.argv.slice(2),
      process.env,
      process.getuid?.(),
    );
    const passed = await runLifecycleCanaryCli({
      configuration,
      environment: env,
      adapter: createTeamTaskLifecycleProductionCanary({ db, pool }),
      currentRevision,
      writeLine: (value) => console.log(value),
    });
    if (!passed) process.exitCode = 1;
  } catch {
    console.error('TEAM_TASK_LIFECYCLE_CANARY status=error');
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
