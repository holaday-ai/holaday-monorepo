import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function buildMaintenanceMigrationManifest(root) {
  const app = path.join(root, 'apps/orchestrator');
  const directory = path.join(app, 'drizzle');
  const files = fs
    .readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  if (files.length === 0 || new Set(files.map((name) => name.slice(0, 4))).size !== files.length)
    throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
  function hashFile(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.size > 16 * 1024 * 1024)
        throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
      const bytes = fs.readFileSync(fd);
      const after = fs.fstatSync(fd);
      if (
        before.ino !== after.ino ||
        before.size !== bytes.length ||
        before.mtimeMs !== after.mtimeMs
      )
        throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
      return digest(bytes);
    } finally {
      fs.closeSync(fd);
    }
  }
  try {
    const manifest = {
      replaysNumberedSql: true,
      runnerSha256: hashFile(path.join(app, 'scripts/apply-numbered-migrations.ts')),
      migrations: files.map((name) => ({ name, sha256: hashFile(path.join(directory, name)) })),
    };
    return { manifest, sha256: digest(JSON.stringify(manifest)) };
  } catch {
    throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
  }
}
