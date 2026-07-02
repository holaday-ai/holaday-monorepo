import { db, pool } from '../src/db/client.js';
import { runPartnerDailyJobs } from '../src/partner/schedulers.js';

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function optionalInteger(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^-?\d+$/.test(value)) {
    throw new RangeError(`${fieldName} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${fieldName} must be an integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  try {
    const summary = await runPartnerDailyJobs({
      db,
      day: flagValue('day') ?? process.env.PARTNER_DAILY_DAY,
      fxBps: optionalInteger(flagValue('fx-bps'), 'fxBps'),
      allocationBudgetCreditCents: optionalInteger(
        flagValue('allocation-budget-credit-cents') ??
          process.env.PARTNER_DAILY_ALLOCATION_BUDGET_CREDIT_CENTS,
        'allocationBudgetCreditCents',
      ),
    });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`[partner:daily] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
