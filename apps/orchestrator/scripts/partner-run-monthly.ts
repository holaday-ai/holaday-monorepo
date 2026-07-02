import { db, pool } from '../src/db/client.js';
import { runPartnerMonthlyRelease } from '../src/partner/schedulers.js';

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
    const summary = await runPartnerMonthlyRelease({
      db,
      releaseMonth: flagValue('release-month') ?? process.env.PARTNER_RELEASE_MONTH,
      budgetCreditCents: optionalInteger(
        flagValue('budget-credit-cents') ?? process.env.PARTNER_MONTHLY_RELEASE_BUDGET_CREDIT_CENTS,
        'budgetCreditCents',
      ),
    });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`[partner:monthly] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
