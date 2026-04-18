import { createHash } from 'node:crypto';
import { newExternalId } from '@holaday/shared-types';
import { type LoadedSkill, loadSkillsDir } from '@holaday/skill-sdk';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { skills } from '../db/schema/skills.js';

/**
 * Walks `skillsDir`, parses every SKILL.md, and upserts a row per
 * (slug, version). Manifest body (the Markdown prompt) is stored as
 * `manifest` JSON alongside the frontmatter for quick retrieval by
 * the commander without another filesystem hop.
 *
 * `gitCommit` is a content hash of the SKILL.md bytes — proper git SHA
 * goes in when W2 wires `holaday-skills` as a separate repo.
 */
export async function syncSkills(
  db: DB,
  skillsDir: string,
): Promise<{ inserted: number; updated: number; skills: LoadedSkill[] }> {
  const loaded = await loadSkillsDir(skillsDir);

  let inserted = 0;
  let updated = 0;

  for (const s of loaded) {
    const existing = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.externalId, stableExternalId(s)))
      .limit(1);

    const manifestJson = {
      ...s.manifest,
      body: s.body,
    };

    if (existing.length === 0) {
      await db.insert(skills).values({
        externalId: stableExternalId(s),
        slug: s.manifest.slug,
        name: s.manifest.name,
        version: s.manifest.version,
        ...(s.manifest.occupationTag ? { occupationTag: s.manifest.occupationTag } : {}),
        description: s.manifest.description,
        manifest: manifestJson,
        gitCommit: contentHash(s.body),
        status: 'active',
      });
      inserted += 1;
    } else {
      await db
        .update(skills)
        .set({
          name: s.manifest.name,
          description: s.manifest.description,
          manifest: manifestJson,
          gitCommit: contentHash(s.body),
          status: 'active',
        })
        .where(eq(skills.externalId, stableExternalId(s)));
      updated += 1;
    }
  }

  return { inserted, updated, skills: loaded };
}

/**
 * Skill external_id must be stable across restarts so upserts find the same
 * row. We derive it from (slug, version) rather than mint a new NanoID
 * every sync.
 */
function stableExternalId(s: LoadedSkill): string {
  const digest = createHash('sha256')
    .update(`${s.manifest.slug}@${s.manifest.version}`)
    .digest('hex')
    .slice(0, 21);
  return `skl_${digest}`;
}

// Exposed so tests can generate a predictable id.
export const _forTests = { stableExternalId };

function contentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 40);
}

export { newExternalId }; // re-exported for symmetry with other registries
