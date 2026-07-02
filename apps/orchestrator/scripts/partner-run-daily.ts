import { db, pool } from '../src/db/client.js';
import { parsePartnerDailyCliArgs, runPartnerDailyJobs } from '../src/partner/schedulers.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function closePool(): Promise<unknown | undefined> {
  try {
    await pool.end();
    return undefined;
  } catch (err) {
    return err;
  }
}

async function main(): Promise<void> {
  let primaryError: unknown;

  try {
    const summary = await runPartnerDailyJobs({
      db,
      ...parsePartnerDailyCliArgs(process.argv.slice(2), process.env),
    });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (err) {
    primaryError = err;
  }

  const closeError = await closePool();
  if (primaryError !== undefined) {
    console.error(`[partner:daily] ${errorMessage(primaryError)}`);
    if (closeError !== undefined) {
      console.error(`[partner:daily] secondary pool close failed: ${errorMessage(closeError)}`);
    }
    process.exitCode = 1;
    return;
  }

  if (closeError !== undefined) {
    console.error(`[partner:daily] pool close failed: ${errorMessage(closeError)}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[partner:daily] ${errorMessage(err)}`);
  process.exitCode = 1;
});
