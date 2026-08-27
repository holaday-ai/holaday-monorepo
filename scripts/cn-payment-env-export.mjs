#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const environmentFile = process.argv[2] ?? '';
if (!environmentFile.startsWith('/')) {
  process.stderr.write('CN payment env export failed: absolute env path required\n');
  process.exit(2);
}

let parsed;
try {
  parsed = parseEnv(readFileSync(environmentFile, 'utf8'));
} catch {
  process.stderr.write('CN payment env export failed: invalid env file\n');
  process.exit(1);
}

for (const [key, value] of Object.entries(parsed).sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes('\0')) {
    process.stderr.write('CN payment env export failed: invalid env entry\n');
    process.exit(1);
  }
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  process.stdout.write(`${key}="$(printf '%s' '${encoded}' | base64 --decode; printf x)"\n`);
  process.stdout.write(`${key}="\${${key}%x}"\n`);
  process.stdout.write(`export ${key}\n`);
}
process.stdout.write('HOLADAY_ENV_LOAD_COMPLETE=1\n');
