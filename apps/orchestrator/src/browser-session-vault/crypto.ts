import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptionContext {
  userId: string;
  origin: string;
  grantId: string;
  purpose: 'session' | 'profile';
  version: number;
}
export interface WrappedKey {
  keyVersion: string;
  wrappedKey: string;
}
/** Implementations must authenticate the full context at the KMS boundary. */
export interface KeyProvider {
  readonly kind: 'test' | 'kms';
  wrap(key: Buffer, context: EncryptionContext): Promise<WrappedKey>;
  unwrap(key: WrappedKey, context: EncryptionContext): Promise<Buffer>;
}
export interface Envelope extends WrappedKey {
  ciphertext: string;
  nonce: string;
  tag: string;
}
const aad = (c: EncryptionContext) =>
  Buffer.from(JSON.stringify([c.userId, c.origin, c.grantId, c.purpose, c.version]));
function encrypt(key: Buffer, value: Buffer, context: EncryptionContext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(context));
  return {
    ciphertext: Buffer.concat([cipher.update(value), cipher.final()]).toString('base64'),
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
function decrypt(
  key: Buffer,
  blob: Pick<Envelope, 'ciphertext' | 'nonce' | 'tag'>,
  context: EncryptionContext,
) {
  const nonce = Buffer.from(blob.nonce, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  if (key.length !== 32 || nonce.length !== 12 || tag.length !== 16)
    throw new Error('vault_crypto_failed');
  const cipher = createDecipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(context));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.from(blob.ciphertext, 'base64')), cipher.final()]);
}
export async function seal(
  keys: KeyProvider,
  context: EncryptionContext,
  value: unknown,
): Promise<Envelope> {
  const dek = randomBytes(32);
  try {
    return {
      ...encrypt(dek, Buffer.from(JSON.stringify(value)), context),
      ...(await keys.wrap(dek, context)),
    };
  } catch {
    throw new Error('vault_crypto_failed');
  } finally {
    dek.fill(0);
  }
}
export async function unseal(
  keys: KeyProvider,
  context: EncryptionContext,
  blob: Envelope,
): Promise<unknown> {
  let dek: Buffer | undefined;
  try {
    dek = await keys.unwrap(blob, context);
    return JSON.parse(decrypt(dek, blob, context).toString('utf8'));
  } catch {
    throw new Error('vault_crypto_failed');
  } finally {
    dek?.fill(0);
  }
}
/** Rotate only the wrapping provider/key version; the authenticated data stays encrypted. */
export async function rewrapEnvelope(
  previous: KeyProvider,
  next: KeyProvider,
  context: EncryptionContext,
  blob: Envelope,
): Promise<Envelope> {
  let dek: Buffer | undefined;
  let verified: Buffer | undefined;
  try {
    dek = await previous.unwrap(blob, context);
    verified = decrypt(dek, blob, context);
    return { ...blob, ...(await next.wrap(dek, context)) };
  } catch {
    throw new Error('vault_crypto_failed');
  } finally {
    dek?.fill(0);
    verified?.fill(0);
  }
}
/** Ephemeral, process-local test fixture. Never loads/writes a key file or env key. */
export class TestKeyProvider implements KeyProvider {
  readonly kind = 'test' as const;
  private readonly master: Buffer;
  constructor() {
    if (process.env.NODE_ENV !== 'test') throw new Error('test_key_provider_forbidden');
    this.master = randomBytes(32);
  }
  async wrap(key: Buffer, context: EncryptionContext): Promise<WrappedKey> {
    return {
      keyVersion: 'ephemeral-test-v1',
      wrappedKey: Buffer.from(JSON.stringify(encrypt(this.master, key, context))).toString(
        'base64',
      ),
    };
  }
  async unwrap(key: WrappedKey, context: EncryptionContext): Promise<Buffer> {
    if (key.keyVersion !== 'ephemeral-test-v1') throw new Error('vault_crypto_failed');
    return decrypt(
      this.master,
      JSON.parse(Buffer.from(key.wrappedKey, 'base64').toString('utf8')),
      context,
    );
  }
}
/** Vendor-neutral adapter seam. No cloud account, SDK, credential or fallback is configured here. */
export class CloudKmsKeyProvider implements KeyProvider {
  readonly kind = 'kms' as const;
  constructor(
    private readonly adapter: {
      wrap(key: Buffer, context: EncryptionContext): Promise<WrappedKey>;
      unwrap(key: WrappedKey, context: EncryptionContext): Promise<Buffer>;
    },
  ) {}
  wrap(key: Buffer, context: EncryptionContext) {
    return this.adapter.wrap(key, context);
  }
  unwrap(key: WrappedKey, context: EncryptionContext) {
    return this.adapter.unwrap(key, context);
  }
}
export function assertVaultConfiguration(options: {
  importEnabled: boolean;
  profileEnabled: boolean;
  keys?: KeyProvider;
}) {
  if (!options.importEnabled && !options.profileEnabled) return;
  if (!options.keys) throw new Error('vault_key_provider_required');
  if (options.keys.kind === 'test' && process.env.NODE_ENV !== 'test')
    throw new Error('test_key_provider_forbidden');
}
