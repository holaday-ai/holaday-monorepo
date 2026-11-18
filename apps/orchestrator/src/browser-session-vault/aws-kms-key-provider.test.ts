import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  DecryptCommandInput,
  DecryptCommandOutput,
  DescribeKeyCommandInput,
  DescribeKeyCommandOutput,
  EncryptCommandInput,
  EncryptCommandOutput,
} from '@aws-sdk/client-kms';
import { describe, expect, it, vi } from 'vitest';
import { AwsKmsKeyProvider } from './aws-kms-key-provider.js';
import { type EncryptionContext, seal, unseal } from './crypto.js';

const arn = 'arn:aws:kms:ap-southeast-1:123456789012:key/12345678-1234-1234-1234-123456789012';
const oldArn = 'arn:aws:kms:ap-southeast-1:123456789012:key/12345678-1234-1234-1234-123456789013';
const context: EncryptionContext = {
  userId: 'private-owner',
  origin: 'https://github.com',
  grantId: 'private-grant',
  purpose: 'profile',
  version: 7,
  access: 'cloud-home-v1',
};

// A local authenticated wrapping service, not a real AWS acceptance claim.
// It actually rejects a changed KMS context instead of returning a fixed DEK.
function fixture() {
  const masters = new Map([
    [arn, randomBytes(32)],
    [oldArn, randomBytes(32)],
  ]);
  const operations = {
    encrypt: vi.fn(
      async (input: EncryptCommandInput, _signal: AbortSignal): Promise<EncryptCommandOutput> => {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', masters.get(input.KeyId!)!, nonce);
        cipher.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
        const data = Buffer.concat([cipher.update(input.Plaintext!), cipher.final()]);
        return {
          $metadata: {},
          KeyId: input.KeyId!,
          EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' as const,
          CiphertextBlob: Buffer.from(
            JSON.stringify({
              nonce: nonce.toString('base64'),
              tag: cipher.getAuthTag().toString('base64'),
              data: data.toString('base64'),
            }),
          ),
        };
      },
    ),
    decrypt: vi.fn(
      async (input: DecryptCommandInput, _signal: AbortSignal): Promise<DecryptCommandOutput> => {
        const blob = JSON.parse(Buffer.from(input.CiphertextBlob!).toString());
        const cipher = createDecipheriv(
          'aes-256-gcm',
          masters.get(input.KeyId!)!,
          Buffer.from(blob.nonce, 'base64'),
        );
        cipher.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
        cipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
        return {
          $metadata: {},
          KeyId: input.KeyId!,
          EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' as const,
          Plaintext: Buffer.concat([
            cipher.update(Buffer.from(blob.data, 'base64')),
            cipher.final(),
          ]),
        };
      },
    ),
    describe: vi.fn(
      async (
        input: DescribeKeyCommandInput,
        _signal: AbortSignal,
      ): Promise<DescribeKeyCommandOutput> => ({
        $metadata: {},
        KeyMetadata: {
          Arn: input.KeyId!,
          KeyId: input.KeyId!.split('/').at(-1)!,
          Enabled: true,
          KeyState: 'Enabled' as const,
          KeySpec: 'SYMMETRIC_DEFAULT' as const,
          KeyUsage: 'ENCRYPT_DECRYPT' as const,
          EncryptionAlgorithms: ['SYMMETRIC_DEFAULT' as const],
        },
      }),
    ),
    close: vi.fn(),
  };
  const make = (keyArn = arn, decryptKeyArns: string[] = []) =>
    new AwsKmsKeyProvider({
      region: 'ap-southeast-1',
      keyArn,
      profile: 'holaday-browser-vault',
      decryptKeyArns,
      operations,
    });
  return { operations, make };
}

describe('AWS KMS session key provider', () => {
  it('wraps only a 32-byte data key and sends a digest of the full private context', async () => {
    const { operations, make } = fixture();
    const provider = make();
    const envelope = await seal(provider, context, { cookie: 'private-cookie' });
    expect(await unseal(provider, context, envelope)).toEqual({ cookie: 'private-cookie' });
    const [input, signal] = operations.encrypt.mock.calls[0]!;
    expect(input.KeyId).toBe(arn);
    expect(input.EncryptionAlgorithm).toBe('SYMMETRIC_DEFAULT');
    expect(input.Plaintext?.length).toBe(32);
    expect(input.EncryptionContext).toEqual({
      application: 'holaday-browser-vault',
      aadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(input.EncryptionContext)).not.toMatch(
      /private-owner|private-grant|github|private-cookie/,
    );
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { userId: 'other-owner' },
    { origin: 'https://example.com' },
    { grantId: 'other-grant' },
    { purpose: 'session' as const },
    { version: 8 },
    { access: undefined },
  ])('refuses changed authenticated context %j', async (change) => {
    const { make } = fixture();
    const provider = make();
    const envelope = await seal(provider, context, { cookie: 'fixture' });
    await expect(unseal(provider, { ...context, ...change }, envelope)).rejects.toThrow(
      'vault_crypto_failed',
    );
  });

  it('validates every active/decrypt-only key before allowing startup', async () => {
    const { make, operations } = fixture();
    await make(arn, [oldArn]).assertReady();
    expect(operations.describe.mock.calls.map(([x]) => x.KeyId)).toEqual([arn, oldArn]);
    expect(operations.encrypt).not.toHaveBeenCalled();
    operations.describe.mockResolvedValueOnce({
      $metadata: {},
      KeyMetadata: {
        Arn: arn,
        KeyId: arn.split('/').at(-1)!,
        Enabled: false,
        KeyState: 'Disabled',
        KeySpec: 'SYMMETRIC_DEFAULT',
        KeyUsage: 'ENCRYPT_DECRYPT',
        EncryptionAlgorithms: ['SYMMETRIC_DEFAULT'],
      },
    });
    await expect(make().assertReady()).rejects.toThrow('vault_kms_unavailable');
  });

  it('supports declared old keys for decrypt only and refuses undeclared versions before I/O', async () => {
    const { make, operations } = fixture();
    const envelope = await seal(make(oldArn), context, { cookie: 'fixture' });
    expect(await unseal(make(arn, [oldArn]), context, envelope)).toEqual({ cookie: 'fixture' });
    operations.decrypt.mockClear();
    await expect(unseal(make(), context, envelope)).rejects.toThrow('vault_crypto_failed');
    expect(operations.decrypt).not.toHaveBeenCalled();
    await seal(make(arn, [oldArn]), context, {});
    expect(operations.encrypt.mock.calls.at(-1)?.[0].KeyId).toBe(arn);
  });

  it('rejects aliases, cross-region ARNs and invalid profiles without making requests', () => {
    const { operations } = fixture();
    for (const change of [
      { keyArn: 'alias/browser-vault' },
      { region: 'us-east-1' },
      { profile: '' },
    ])
      expect(
        () =>
          new AwsKmsKeyProvider({
            region: 'ap-southeast-1',
            keyArn: arn,
            profile: 'fixture',
            operations,
            ...change,
          }),
      ).toThrow('vault_kms_configuration');
    expect(operations.describe).not.toHaveBeenCalled();
  });

  it('checks wrap receipts and sanitizes provider failures', async () => {
    const { make, operations } = fixture();
    operations.encrypt.mockResolvedValueOnce({
      $metadata: {},
      KeyId: oldArn,
      EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
      CiphertextBlob: Buffer.from('fixture'),
    });
    await expect(make().wrap(Buffer.alloc(32), context)).rejects.toThrow('vault_crypto_failed');
    operations.encrypt.mockRejectedValueOnce(new Error('credential-and-response-must-not-leak'));
    await expect(make().wrap(Buffer.alloc(32), context)).rejects.toThrow(/^vault_crypto_failed$/);
  });

  it.each([undefined, null, 17])(
    'rejects a non-string profile %j before client creation',
    (profile) => {
      const { operations } = fixture();
      expect(() =>
        Reflect.construct(AwsKmsKeyProvider, [
          { region: 'ap-southeast-1', keyArn: arn, profile, operations },
        ]),
      ).toThrow('vault_kms_configuration');
      expect(operations.describe).not.toHaveBeenCalled();
    },
  );

  it('clears provider plaintext even when its unwrap receipt is invalid', async () => {
    const { make, operations } = fixture();
    const provider = make();
    const envelope = await seal(provider, context, {});
    const plaintext = Buffer.alloc(31, 7);
    operations.decrypt.mockResolvedValueOnce({
      $metadata: {},
      KeyId: arn,
      EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
      Plaintext: plaintext,
    });
    await expect(provider.unwrap(envelope, context)).rejects.toThrow('vault_crypto_failed');
    expect(plaintext.every((x) => x === 0)).toBe(true);
  });

  it('rejects malformed ciphertext before contacting the service', async () => {
    const { make, operations } = fixture();
    await expect(
      make().unwrap({ keyVersion: `aws-kms-v1:${arn}`, wrappedKey: 'not base64!' }, context),
    ).rejects.toThrow('vault_crypto_failed');
    expect(operations.decrypt).not.toHaveBeenCalled();
  });

  it('closing aborts in-flight work and rejects late calls', async () => {
    const { make, operations } = fixture();
    const provider = make();
    operations.encrypt.mockImplementationOnce(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const pending = provider.wrap(Buffer.alloc(32), context);
    provider.close();
    await expect(pending).rejects.toThrow('vault_crypto_failed');
    provider.close();
    expect(operations.close).toHaveBeenCalledTimes(1);
    await expect(provider.wrap(Buffer.alloc(32), context)).rejects.toThrow('vault_crypto_failed');
    expect(operations.encrypt).toHaveBeenCalledTimes(1);
  });

  it('bounds an uncooperative unwrap and clears its late plaintext', async () => {
    const { make, operations } = fixture();
    const provider = make();
    const envelope = await seal(provider, context, {});
    let release!: (value: DecryptCommandOutput) => void;
    operations.decrypt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let settled = false;
    const pending = provider.unwrap(envelope, context).catch(() => {
      settled = true;
    });
    const latePlaintext = Buffer.alloc(32, 9);
    provider.close();
    try {
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 200 });
    } finally {
      release({
        $metadata: {},
        KeyId: arn,
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
        Plaintext: latePlaintext,
      });
    }
    await pending;
    await vi.waitFor(() => expect(latePlaintext.every((x) => x === 0)).toBe(true));
  });

  it('does not turn an uncertain transport close into later successful cleanup', () => {
    const { make, operations } = fixture();
    const provider = make();
    operations.close.mockImplementationOnce(() => {
      throw new Error('private-close-diagnostic');
    });
    expect(() => provider.close()).toThrow('vault_kms_close_failed');
    expect(() => provider.close()).toThrow('vault_kms_close_failed');
    expect(operations.close).toHaveBeenCalledOnce();
  });
});
