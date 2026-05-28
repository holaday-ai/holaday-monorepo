import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

function openingButtonTags(source: string): string[] {
  const tags: string[] = [];
  const pattern = /<button\b[\s\S]*?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    tags.push(match[0]);
  }
  return tags;
}

describe('control tooltip affordances', () => {
  it('keeps labelled buttons hover-discoverable', () => {
    const missingTitles = tsxFiles(join(process.cwd(), 'src'))
      .flatMap((file) =>
        openingButtonTags(readFileSync(file, 'utf8'))
          .map((tag, index) => ({ file, tag, index }))
          .filter(({ tag }) => tag.includes('aria-label') && !tag.includes('title=')),
      )
      .map(({ file, index }) => `${file}:${index + 1}`);

    expect(missingTitles).toEqual([]);
  });
});
