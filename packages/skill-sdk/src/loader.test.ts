import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillLoadError, loadSkill, loadSkillsDir } from './loader.js';

const VALID_FRONTMATTER = `---
slug: demo-skill
name: Demo
version: 0.0.1
description: a tiny demo skill
entryUrls:
  - https://example.com/
---

# body text
`;

describe('skill-sdk loader', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'holaday-skill-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a single SKILL.md with valid frontmatter', async () => {
    const path = join(dir, 'SKILL.md');
    await writeFile(path, VALID_FRONTMATTER);
    const loaded = await loadSkill(path);
    expect(loaded.manifest.slug).toBe('demo-skill');
    expect(loaded.manifest.version).toBe('0.0.1');
    expect(loaded.body).toBe('# body text');
  });

  it('rejects non-kebab-case slug', async () => {
    const bad = VALID_FRONTMATTER.replace('demo-skill', 'Demo_Skill');
    const path = join(dir, 'SKILL.md');
    await writeFile(path, bad);
    await expect(loadSkill(path)).rejects.toBeInstanceOf(SkillLoadError);
  });

  it('loadSkillsDir walks subdirectories and enforces slug uniqueness', async () => {
    await mkdir(join(dir, 'a'));
    await mkdir(join(dir, 'b'));
    await writeFile(join(dir, 'a', 'SKILL.md'), VALID_FRONTMATTER);
    await writeFile(
      join(dir, 'b', 'SKILL.md'),
      VALID_FRONTMATTER.replace('demo-skill', 'demo-skill-2'),
    );

    const out = await loadSkillsDir(dir);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.manifest.slug).sort()).toEqual(['demo-skill', 'demo-skill-2']);
  });

  it('loadSkillsDir throws on duplicate slug across files', async () => {
    await mkdir(join(dir, 'a'));
    await mkdir(join(dir, 'b'));
    await writeFile(join(dir, 'a', 'SKILL.md'), VALID_FRONTMATTER);
    await writeFile(join(dir, 'b', 'SKILL.md'), VALID_FRONTMATTER);
    await expect(loadSkillsDir(dir)).rejects.toBeInstanceOf(SkillLoadError);
  });
});
