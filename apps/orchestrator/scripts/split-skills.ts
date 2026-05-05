/**
 * P1.2 — one-shot migration: split users.selected_roles values into
 * the new selected_skills column.
 *
 * Until commit 1712ccd both /skills and /settings/roles wrote to
 * users.selected_roles, which collapsed two unrelated concerns into
 * one column and let a Basic user with 8 skill toggles see "已选
 * 13 / 5" on the role page. The schema migration `0017` adds
 * selected_skills; this script partitions every existing
 * selected_roles value into:
 *
 *   - selected_roles  ← only ids found in ROLE_CATALOGUE
 *   - selected_skills ← only ids found in SKILL_META
 *   - dropped        ← ids that match neither (legacy / typos)
 *
 * Overlap (an id present in both catalogues — e.g. 'content-creator')
 * lands in both columns since it's the same enabled-thing
 * conceptually. The user can untoggle either side later.
 *
 * Run on Vultr:
 *   cd /opt/holaday-monorepo/apps/orchestrator
 *   pnpm exec tsx scripts/split-skills.ts
 *
 * Idempotent: running twice produces the same row state. No-ops
 * users whose selected_roles is null/empty.
 */

import { ROLE_CATALOGUE } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import { SKILL_META } from '../src/agent/skills/skill-meta.js';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema/users.js';

const ROLE_IDS = new Set(ROLE_CATALOGUE.map((r) => r.id));
const SKILL_IDS = new Set(SKILL_META.map((s) => s.id));

interface Partition {
  roles: string[];
  skills: string[];
  dropped: string[];
}

function partitionIds(ids: readonly string[]): Partition {
  const roles: string[] = [];
  const skills: string[] = [];
  const dropped: string[] = [];
  for (const id of ids) {
    const isRole = ROLE_IDS.has(id);
    const isSkill = SKILL_IDS.has(id);
    if (isRole) roles.push(id);
    if (isSkill) skills.push(id);
    if (!isRole && !isSkill) dropped.push(id);
  }
  return {
    roles: Array.from(new Set(roles)),
    skills: Array.from(new Set(skills)),
    dropped: Array.from(new Set(dropped)),
  };
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: users.id,
      externalId: users.externalId,
      selectedRoles: users.selectedRoles,
      selectedSkills: users.selectedSkills,
    })
    .from(users);

  let updated = 0;
  let unchanged = 0;
  let droppedAccrossAll = 0;

  for (const row of rows) {
    const current = Array.isArray(row.selectedRoles) ? row.selectedRoles : [];
    if (current.length === 0) {
      unchanged += 1;
      continue;
    }
    const parts = partitionIds(current);
    droppedAccrossAll += parts.dropped.length;

    // Merge with whatever the user has already accumulated in the new
    // skills column (idempotency on re-runs + don't blow away later
    // toggles).
    const existingSkills = Array.isArray(row.selectedSkills) ? row.selectedSkills : [];
    const mergedSkills = Array.from(new Set([...existingSkills, ...parts.skills]));

    const rolesUnchanged =
      current.length === parts.roles.length && current.every((id) => parts.roles.includes(id));
    const skillsUnchanged =
      mergedSkills.length === existingSkills.length &&
      mergedSkills.every((id) => existingSkills.includes(id));
    if (rolesUnchanged && skillsUnchanged) {
      unchanged += 1;
      continue;
    }

    await db
      .update(users)
      .set({
        selectedRoles: parts.roles.length === 0 ? null : parts.roles,
        selectedSkills: mergedSkills.length === 0 ? null : mergedSkills,
      })
      .where(eq(users.id, row.id));
    updated += 1;
    // eslint-disable-next-line no-console
    console.info(
      `[split-skills] ${row.externalId}: roles=${parts.roles.length} skills=${mergedSkills.length}` +
        (parts.dropped.length > 0 ? ` dropped=${parts.dropped.join(',')}` : ''),
    );
  }

  // eslint-disable-next-line no-console
  console.info(
    `[split-skills] done. updated=${updated} unchanged=${unchanged} dropped-ids-total=${droppedAccrossAll}`,
  );
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[split-skills] failed:', err);
  process.exit(1);
});
