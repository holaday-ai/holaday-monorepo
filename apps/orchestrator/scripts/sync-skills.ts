#!/usr/bin/env tsx
/**
 * One-shot script to register built-in skills into the DB.
 * Usage (from repo root): pnpm --filter @holaday/orchestrator sync-skills
 * Reads `skills/` at repo root; DATABASE_URL comes from env.
 */
import { resolve } from 'node:path';
import { db, pool } from '../src/db/client.js';
import { syncSkills } from '../src/skills/registry.js';

async function main(): Promise<void> {
  const skillsDir = resolve(process.cwd(), '../../skills');
  const result = await syncSkills(db, skillsDir);
  console.log(
    `inserted=${result.inserted} updated=${result.updated} total=${result.skills.length}`,
  );
  for (const s of result.skills) {
    console.log(`  ${s.manifest.slug}@${s.manifest.version}  ${s.manifest.name}`);
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
