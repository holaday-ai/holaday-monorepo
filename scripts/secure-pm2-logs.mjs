#!/usr/bin/env node

import { chmodSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

async function main() {
  const names = process.argv.slice(2);
  if (
    names.length === 0 ||
    new Set(names).size !== names.length ||
    names.some((name) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
  ) {
    throw new Error('invalid process names');
  }
  const pm2Home = process.env.PM2_HOME;
  if (!pm2Home || !isAbsolute(pm2Home)) throw new Error('invalid PM2 home');
  const logsRoot = realpathSync(resolve(pm2Home, 'logs'));

  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error('PM2 input too large');
  }
  const rows = JSON.parse(input);
  if (!Array.isArray(rows)) throw new Error('invalid PM2 input');

  const logFiles = [];
  for (const name of names) {
    const matches = rows.filter(
      (row) => row?.name === name && row?.pm2_env?.status === 'online' && Number(row?.pid) > 0,
    );
    if (matches.length !== 1) throw new Error('process count mismatch');
    for (const [field, marker] of [
      ['pm_out_log_path', `${name}-out`],
      ['pm_err_log_path', `${name}-error`],
    ]) {
      const configuredPath = matches[0].pm2_env?.[field];
      if (typeof configuredPath !== 'string' || !isAbsolute(configuredPath)) {
        throw new Error('invalid log path');
      }
      const realPath = realpathSync(configuredPath);
      const withinLogs = relative(logsRoot, realPath);
      const filename = basename(realPath);
      if (
        withinLogs === '' ||
        withinLogs.startsWith('..') ||
        isAbsolute(withinLogs) ||
        !filename.startsWith(marker) ||
        !filename.endsWith('.log')
      ) {
        throw new Error('unsafe log path');
      }
      logFiles.push(realPath);
    }
  }

  for (const path of logFiles) chmodSync(path, 0o600);
  if (logFiles.some((path) => (statSync(path).mode & 0o777) !== 0o600)) {
    throw new Error('log permission mismatch');
  }
  process.stdout.write(`PM2_LOG_PERMISSIONS apps=${names.length} mode=0600\n`);
}

main().catch(() => {
  process.stderr.write('PM2_LOG_PERMISSIONS status=error\n');
  process.exitCode = 1;
});
