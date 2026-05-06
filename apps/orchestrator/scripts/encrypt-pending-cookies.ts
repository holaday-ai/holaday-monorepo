/**
 * Spec B — one-shot backfill: encrypt the existing plaintext rows in
 * `pending_cookies` so every row has the four envelope-encryption
 * columns populated alongside `cookies_json`. After this runs (and
 * the soak window closes) the follow-up migration drops `cookies_json`.
 *
 * Run on Vultr:
 *   cd /opt/holaday-monorepo/apps/orchestrator
 *   pnpm exec tsx scripts/encrypt-pending-cookies.ts
 *
 * Idempotent: rows that already have an `encrypted_blob` are skipped.
 * Rows whose `cookies_json` is null AND `encrypted_blob` is null are
 * deleted (impossible state under the new code; legacy cleanup).
 *
 * Requires COOKIE_MASTER_KEY in env. Throws fast if missing — running
 * the backfill against the wrong key would corrupt every row.
 */

import 'dotenv/config';
import { isNull, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { pendingCookies } from '../src/db/schema/pending-cookies.js';
import { encryptCookieJson } from '../src/cookies/cookie-crypto.js';

async function main(): Promise<void> {
  if (!process.env.COOKIE_MASTER_KEY) {
    throw new Error(
      'COOKIE_MASTER_KEY not set. Generate with `openssl rand -base64 32` and add to .env before running this backfill.',
    );
  }

  const rows = await db
    .select({
      id: pendingCookies.id,
      cookiesJson: pendingCookies.cookiesJson,
      encryptedBlob: pendingCookies.encryptedBlob,
    })
    .from(pendingCookies)
    .where(isNull(pendingCookies.encryptedBlob));

  if (rows.length === 0) {
    console.log('no rows to backfill — every pending_cookies row already encrypted.');
    return;
  }

  let encrypted = 0;
  let dropped = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.encryptedBlob) {
      skipped += 1;
      continue;
    }
    if (!row.cookiesJson) {
      await db.delete(pendingCookies).where(sql`id = ${row.id}`);
      dropped += 1;
      continue;
    }
    const enc = encryptCookieJson(row.cookiesJson);
    await db
      .update(pendingCookies)
      .set({
        encryptedBlob: enc.encryptedBlob,
        encryptionIv: enc.encryptionIv,
        encryptionTag: enc.encryptionTag,
        encryptedKey: enc.encryptedKey,
      })
      .where(sql`id = ${row.id}`);
    encrypted += 1;
  }
  console.log(`backfill done: encrypted=${encrypted}, dropped=${dropped}, skipped=${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
