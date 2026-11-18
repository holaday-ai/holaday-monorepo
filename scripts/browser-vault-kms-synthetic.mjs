import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const kind = 'holaday-kms-acceptance-receipt-v1';
const payloadKind = 'holaday-vault-synthetic-payload-v1';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contextFor = (grantId) => ({
  userId: 'synthetic-acceptance-owner',
  origin: 'https://example.com',
  grantId,
  purpose: 'profile',
  version: 1,
  access: 'cloud-home-v1',
});
const exactKeys = (value, names) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');
async function readReceipt(receiptPath, configuration, sourceCommit, pid) {
  let file;
  let receipt;
  try {
    file = await open(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > 32768 ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid()
    )
      throw Error();
    const body = Buffer.alloc(32769);
    let bytes = 0;
    while (bytes < body.length) {
      const { bytesRead } = await file.read(body, bytes, body.length - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
    if (bytes > 32768) throw Error();
    receipt = JSON.parse(body.subarray(0, bytes).toString('utf8'));
    if (
      !exactKeys(receipt, [
        'kind',
        'sourceCommit',
        'keyArn',
        'sealedByPid',
        'context',
        'payloadSHA256',
        'envelope',
      ]) ||
      receipt.kind !== kind ||
      receipt.sourceCommit !== sourceCommit ||
      receipt.keyArn !== configuration.keyArn ||
      !Number.isSafeInteger(receipt.sealedByPid) ||
      receipt.sealedByPid < 1 ||
      !/^[a-f0-9]{64}$/.test(receipt.payloadSHA256) ||
      !exactKeys(receipt.context, Object.keys(contextFor(''))) ||
      !/^[a-f0-9-]{36}$/.test(receipt.context.grantId) ||
      JSON.stringify(receipt.context) !== JSON.stringify(contextFor(receipt.context.grantId)) ||
      !exactKeys(receipt.envelope, ['keyVersion', 'wrappedKey', 'ciphertext', 'nonce', 'tag']) ||
      Object.values(receipt.envelope).some(
        (v) => typeof v !== 'string' || !v.length || v.length > 16384,
      )
    )
      throw Error();
  } catch {
    throw Error('vault_synthetic_receipt');
  } finally {
    await file?.close();
  }
  if (receipt.sealedByPid === pid) throw Error('vault_synthetic_cross_process_required');
  return receipt;
}

async function defaultDependencies() {
  const { AwsKmsKeyProvider } = await import(
    '../apps/orchestrator/dist/browser-session-vault/aws-kms-key-provider.js'
  );
  const { seal, unseal } = await import(
    '../apps/orchestrator/dist/browser-session-vault/crypto.js'
  );
  return { createKeys: (configuration) => new AwsKmsKeyProvider(configuration), seal, unseal };
}

/** Synthetic contents only. Separate seal/open CLI processes witness restart recovery.
 * Rejections deliberately do not claim a specific AWS error or another IAM principal.
 * No login state, credential value or arbitrary input payload is accepted. */
export async function runSyntheticKmsStep(options, suppliedDependencies) {
  const { step, configuration, sourceCommit, receiptPath } = options;
  if (
    !['describe', 'seal', 'open'].includes(step) ||
    !/^[a-f0-9]{40}$/.test(sourceCommit ?? '') ||
    !configuration ||
    configuration.decryptKeyArns?.length ||
    (step !== 'describe' && typeof receiptPath !== 'string')
  )
    throw Error('vault_synthetic_configuration');
  const pid = suppliedDependencies?.pid?.() ?? process.pid;
  let receipt;
  let file;
  if (step === 'open') receipt = await readReceipt(receiptPath, configuration, sourceCommit, pid);
  if (step === 'seal') {
    try {
      file = await open(
        receiptPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch {
      throw Error('vault_synthetic_receipt');
    }
  }
  let keys;
  try {
    const dependencies = suppliedDependencies ?? (await defaultDependencies());
    keys = await dependencies.createKeys(configuration);
    if (keys.kind !== 'kms') throw Error('vault_key_provider_required');
    await keys.assertReady();
    const common = {
      kind: 'holaday-kms-synthetic-result-v1',
      step,
      sourceCommit,
      keyArn: configuration.keyArn,
      pid,
      describeOperationUpperBound: 1,
      iamNegativePrincipalTested: false,
    };
    if (step === 'describe') return { ...common, ready: true, cryptoOperationUpperBound: 0 };
    if (step === 'seal') {
      const context = contextFor(randomUUID());
      const payload = { kind: payloadKind, nonce: randomBytes(16).toString('hex') };
      const envelope = await dependencies.seal(keys, context, payload);
      const sealed = {
        kind,
        sourceCommit,
        keyArn: configuration.keyArn,
        sealedByPid: pid,
        context,
        payloadSHA256: digest(payload),
        envelope,
      };
      await file.writeFile(`${JSON.stringify(sealed)}\n`);
      await file.sync();
      return { ...common, cryptoOperationUpperBound: 1, receiptSHA256: digest(sealed) };
    }
    const verifyPositive = async () => {
      const value = await dependencies.unseal(keys, receipt.context, receipt.envelope);
      if (
        !exactKeys(value, ['kind', 'nonce']) ||
        value.kind !== payloadKind ||
        !/^[a-f0-9]{32}$/.test(value.nonce) ||
        digest(value) !== receipt.payloadSHA256
      )
        throw Error('vault_synthetic_payload');
    };
    await verifyPositive();
    const rejections = [];
    const rejected = async (name, context, envelope) => {
      try {
        await dependencies.unseal(keys, context, envelope);
      } catch {
        rejections.push(name);
        return;
      }
      throw Error('vault_synthetic_rejection_missing');
    };
    for (const [name, change] of [
      ['owner', { userId: 'other-synthetic-owner' }],
      ['origin', { origin: 'https://other.example.com' }],
      ['grant', { grantId: randomUUID() }],
      ['purpose', { purpose: 'session' }],
      ['version', { version: 2 }],
      ['access', { access: undefined }],
    ])
      await rejected(name, { ...receipt.context, ...change }, receipt.envelope);
    await rejected('key-version', receipt.context, {
      ...receipt.envelope,
      keyVersion: 'invalid-synthetic-key-version',
    });
    const tag = Buffer.from(receipt.envelope.tag, 'base64');
    tag[0] ^= 1;
    await rejected('tampered-envelope', receipt.context, {
      ...receipt.envelope,
      tag: tag.toString('base64'),
    });
    await verifyPositive();
    return {
      ...common,
      cryptoOperationUpperBound: 10,
      crossProcess: true,
      sealedByPid: receipt.sealedByPid,
      rejections,
      rejectionMeaning: 'rejected by provider/envelope; no specific AWS cause inferred',
      receiptSHA256: digest(receipt),
    };
  } finally {
    try {
      await file?.close();
    } finally {
      keys?.close();
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [step, receiptPath, confirmation, ...extra] = process.argv.slice(2);
    if (confirmation !== '--allow-synthetic-kms' || extra.length)
      throw Error('vault_synthetic_explicit_execution_required');
    if (process.version !== 'v22.23.3') throw Error('vault_synthetic_node_version');
    const result = await runSyntheticKmsStep({
      step,
      receiptPath,
      sourceCommit: process.env.BROWSER_VAULT_ACCEPTANCE_SOURCE_COMMIT,
      configuration: {
        region: process.env.BROWSER_VAULT_KMS_REGION,
        keyArn: process.env.BROWSER_VAULT_KMS_KEY_ARN,
        profile: process.env.BROWSER_VAULT_AWS_PROFILE,
      },
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      error instanceof Error && /^vault_[a-z_]+$/.test(error.message)
        ? error.message
        : 'vault_synthetic_failed',
    );
    process.exitCode = 1;
  }
}
