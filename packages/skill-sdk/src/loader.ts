import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { type SkillManifest, skillManifestSchema } from './manifest.js';

/**
 * Parse a single SKILL.md — frontmatter is YAML/zod-validated, body is the
 * markdown commander prompt.
 */
export interface LoadedSkill {
  manifest: SkillManifest;
  body: string;
  sourcePath: string;
}

export class SkillLoadError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = 'SkillLoadError';
  }
}

export async function loadSkill(skillMdPath: string): Promise<LoadedSkill> {
  const raw = await readFile(skillMdPath, 'utf8');
  const parsed = matter(raw);
  const frontmatter = parsed.data;
  const check = skillManifestSchema.safeParse(frontmatter);
  if (!check.success) {
    throw new SkillLoadError(skillMdPath, check.error.message);
  }
  return {
    manifest: check.data,
    body: parsed.content.trim(),
    sourcePath: skillMdPath,
  };
}

/**
 * Walk a directory tree and load every `SKILL.md` found. Fails fast on the
 * first invalid manifest so build-time errors surface immediately.
 */
export async function loadSkillsDir(rootDir: string): Promise<LoadedSkill[]> {
  const out: LoadedSkill[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        out.push(await loadSkill(full));
      }
    }
  }

  const info = await stat(rootDir);
  if (!info.isDirectory()) {
    throw new SkillLoadError(rootDir, 'not a directory');
  }
  await walk(rootDir);

  // Enforce slug uniqueness across the tree.
  const seen = new Map<string, string>();
  for (const s of out) {
    const prior = seen.get(s.manifest.slug);
    if (prior) {
      throw new SkillLoadError(
        s.sourcePath,
        `duplicate slug "${s.manifest.slug}" (also at ${prior})`,
      );
    }
    seen.set(s.manifest.slug, s.sourcePath);
  }

  return out;
}
