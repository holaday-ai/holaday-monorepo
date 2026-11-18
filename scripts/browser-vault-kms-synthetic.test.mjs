import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runSyntheticKmsStep } from './browser-vault-kms-synthetic.mjs';

const arn = 'arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012';
const configuration = { region: 'us-east-2', keyArn: arn, profile: 'synthetic-only' };
const sourceCommit = '2'.repeat(40);
test('CLI requires explicit synthetic execution before resolving credentials', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/browser-vault-kms-synthetic.mjs', 'describe', '-'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /vault_synthetic_explicit_execution_required/);
});
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vault-synthetic-'));
  const receiptPath = path.join(directory, 'receipt.json');
  const master = randomBytes(32);
  const events = [];
  let pid = 101;
  const dependencies = {
    pid: () => pid,
    createKeys() {
      events.push('create');
      return {
        kind: 'kms',
        async assertReady() {
          events.push('ready');
        },
        close() {
          events.push('close');
        },
      };
    },
    async seal(_keys, context, value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', master, nonce);
      cipher.setAAD(Buffer.from(JSON.stringify(context)));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return {
        keyVersion: 'fixture-v1',
        wrappedKey: 'fixture-only',
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      };
    },
    async unseal(_keys, context, blob) {
      if (blob.keyVersion !== 'fixture-v1') throw Error('fixture_wrong_version');
      const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(blob.nonce, 'base64'));
      decipher.setAAD(Buffer.from(JSON.stringify(context)));
      decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(blob.ciphertext, 'base64')),
          decipher.final(),
        ]).toString(),
      );
    },
  };
  const options = { configuration, sourceCommit, receiptPath };
  try {
    await run({
      directory,
      options,
      dependencies,
      events,
      setPid(value) {
        pid = value;
      },
    });
  } finally {
    master.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
}

test('synthetic receipt stays private and supports a later process witness', () =>
  fixture(async (f) => {
    const seal = await runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies);
    assert.equal(seal.cryptoOperationUpperBound, 1);
    assert.equal((await stat(f.options.receiptPath)).mode & 0o777, 0o600);
    const text = await readFile(f.options.receiptPath, 'utf8');
    assert.ok(!text.includes('holaday-vault-synthetic-payload-v1'));
    f.setPid(202);
    const open = await runSyntheticKmsStep({ ...f.options, step: 'open' }, f.dependencies);
    assert.equal(open.crossProcess, true);
    assert.equal(open.rejections.length, 8);
    assert.equal(open.cryptoOperationUpperBound, 10);
    assert.equal(open.iamNegativePrincipalTested, false);
    assert.deepEqual(f.events, ['create', 'ready', 'close', 'create', 'ready', 'close']);
  }));

test('refuses overwrite and symlink before resolving any cloud identity', () =>
  fixture(async (f) => {
    await writeFile(f.options.receiptPath, 'owned', { mode: 0o600 });
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies),
      /vault_synthetic_receipt/,
    );
    await rm(f.options.receiptPath);
    await symlink(path.join(f.directory, 'elsewhere'), f.options.receiptPath);
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies),
      /vault_synthetic_receipt/,
    );
    assert.deepEqual(f.events, []);
  }));

test('same-process opening does not claim restart acceptance or contact KMS', () =>
  fixture(async (f) => {
    await runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies);
    f.events.length = 0;
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'open' }, f.dependencies),
      /vault_synthetic_cross_process_required/,
    );
    assert.deepEqual(f.events, []);
  }));

test('refuses shared or non-private receipt files before cloud access', () =>
  fixture(async (f) => {
    await runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies);
    f.setPid(202);
    f.events.length = 0;
    const alias = path.join(f.directory, 'alias.json');
    await link(f.options.receiptPath, alias);
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'open' }, f.dependencies),
      /vault_synthetic_receipt/,
    );
    await rm(alias);
    await chmod(f.options.receiptPath, 0o644);
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'open' }, f.dependencies),
      /vault_synthetic_receipt/,
    );
    assert.deepEqual(f.events, []);
  }));

test('rejects wrong candidate or key and oversized receipts before cloud access', () =>
  fixture(async (f) => {
    await runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies);
    f.setPid(202);
    f.events.length = 0;
    for (const change of [
      { sourceCommit: '3'.repeat(40) },
      { configuration: { ...configuration, keyArn: arn.replace(/2$/, '3') } },
    ])
      await assert.rejects(
        runSyntheticKmsStep({ ...f.options, step: 'open', ...change }, f.dependencies),
        /vault_synthetic_receipt/,
      );
    await writeFile(f.options.receiptPath, 'x'.repeat(32769));
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'open' }, f.dependencies),
      /vault_synthetic_receipt/,
    );
    assert.deepEqual(f.events, []);
  }));

test('detects a provider accepting wrong context rather than reporting false success', () =>
  fixture(async (f) => {
    await runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies);
    f.setPid(202);
    let original;
    const real = f.dependencies.unseal;
    f.dependencies.unseal = async (...args) => {
      if (!original) original = await real(...args);
      return original;
    };
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'open' }, f.dependencies),
      /vault_synthetic_rejection_missing/,
    );
    assert.equal(f.events.at(-1), 'close');
  }));

test('always closes a created provider when readiness or encryption fails', () =>
  fixture(async (f) => {
    f.dependencies.seal = async () => {
      throw Error('fixture_crypto_error');
    };
    await assert.rejects(
      runSyntheticKmsStep({ ...f.options, step: 'seal' }, f.dependencies),
      /fixture_crypto_error/,
    );
    assert.deepEqual(f.events, ['create', 'ready', 'close']);
    assert.equal((await stat(f.options.receiptPath)).size, 0);
  }));
