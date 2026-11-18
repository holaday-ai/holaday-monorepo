import {
  DecryptCommand,
  type DecryptCommandInput,
  type DecryptCommandOutput,
  DescribeKeyCommand,
  type DescribeKeyCommandInput,
  type DescribeKeyCommandOutput,
  EncryptCommand,
  type EncryptCommandInput,
  type EncryptCommandOutput,
  KMSClient,
} from '@aws-sdk/client-kms';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import {
  type EncryptionContext,
  type KeyProvider,
  type WrappedKey,
  encryptionContextDigest,
} from './crypto.js';

export interface KmsOperations {
  encrypt(input: EncryptCommandInput, signal: AbortSignal): Promise<EncryptCommandOutput>;
  decrypt(input: DecryptCommandInput, signal: AbortSignal): Promise<DecryptCommandOutput>;
  describe(input: DescribeKeyCommandInput, signal: AbortSignal): Promise<DescribeKeyCommandOutput>;
  close(): void;
}
export interface AwsKmsConfiguration {
  region: string;
  keyArn: string;
  profile: string;
  decryptKeyArns?: readonly string[];
}
const versionPrefix = 'aws-kms-v1:';
const algorithm = 'SYMMETRIC_DEFAULT' as const;
const fail = () => new Error('vault_crypto_failed');
function keyPartition(arn: string, region: string): string {
  const match =
    /^arn:(aws|aws-cn|aws-us-gov):kms:([a-z0-9-]+):\d{12}:key\/(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|mrk-[a-f0-9]{32})$/.exec(
      arn,
    );
  if (
    !match ||
    match[2] !== region ||
    (match[1] === 'aws-cn') !== region.startsWith('cn-') ||
    (match[1] === 'aws-us-gov') !== region.startsWith('us-gov-')
  )
    throw new Error('vault_kms_configuration');
  return match[1]!;
}
export function validateAwsKmsConfiguration(options: AwsKmsConfiguration): void {
  if (
    typeof options.region !== 'string' ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(options.region) ||
    typeof options.profile !== 'string' ||
    !/^[A-Za-z0-9_.@-]{1,128}$/.test(options.profile) ||
    typeof options.keyArn !== 'string' ||
    (options.decryptKeyArns !== undefined &&
      (!Array.isArray(options.decryptKeyArns) || options.decryptKeyArns.length > 4))
  )
    throw new Error('vault_kms_configuration');
  const partition = keyPartition(options.keyArn, options.region);
  for (const arn of options.decryptKeyArns ?? [])
    if (typeof arn !== 'string' || keyPartition(arn, options.region) !== partition)
      throw new Error('vault_kms_configuration');
}
function authenticatedContext(context: EncryptionContext) {
  if (
    !context ||
    ![context.userId, context.origin, context.grantId].every(
      (v) => typeof v === 'string' && v.length > 0 && v.length <= 2048,
    ) ||
    !['session', 'profile'].includes(context.purpose) ||
    !Number.isSafeInteger(context.version) ||
    context.version < 1 ||
    (context.access !== undefined && context.access !== 'cloud-home-v1')
  )
    throw fail();
  return { application: 'holaday-browser-vault', aadSha256: encryptionContextDigest(context) };
}

/** Only a fresh 32-byte DEK is sent remotely; cookies remain in local AEAD ciphertext. */
export class AwsKmsKeyProvider implements KeyProvider {
  readonly kind = 'kms' as const;
  private readonly keyArn: string;
  private readonly allowedKeys: ReadonlySet<string>;
  private readonly operations: KmsOperations;
  private readonly stopping = new AbortController();
  private closeError: Error | undefined;
  constructor(options: AwsKmsConfiguration & { operations?: KmsOperations }) {
    validateAwsKmsConfiguration(options);
    const partition = keyPartition(options.keyArn, options.region);
    const keys = [options.keyArn, ...(options.decryptKeyArns ?? [])];
    this.keyArn = options.keyArn;
    this.allowedKeys = new Set(keys);
    if (options.operations) this.operations = options.operations;
    else {
      const client = new KMSClient({
        region: options.region,
        // A named service profile avoids accidentally using a developer/R2 identity.
        credentials: fromIni({ profile: options.profile }),
        // Explicit endpoint prevents global overrides from receiving credentials.
        endpoint: `https://kms.${options.region}.${partition === 'aws-cn' ? 'amazonaws.com.cn' : 'amazonaws.com'}`,
        useFipsEndpoint: false,
        useDualstackEndpoint: false,
        maxAttempts: 1,
      });
      this.operations = {
        encrypt: (input, signal) => client.send(new EncryptCommand(input), { abortSignal: signal }),
        decrypt: (input, signal) => client.send(new DecryptCommand(input), { abortSignal: signal }),
        describe: (input, signal) =>
          client.send(new DescribeKeyCommand(input), { abortSignal: signal }),
        close: () => client.destroy(),
      };
    }
  }
  private signal() {
    this.stopping.signal.throwIfAborted();
    return AbortSignal.any([this.stopping.signal, AbortSignal.timeout(5000)]);
  }
  private invoke<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        reject(error);
      };
      const abort = () => rejectOnce(fail());
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      let pending: Promise<T>;
      try {
        pending = operation(signal);
      } catch (error) {
        rejectOnce(error);
        return;
      }
      Promise.resolve(pending).then((value) => {
        if (settled || signal.aborted) {
          // SDK credential/transport work can settle after the caller stopped.
          if (
            value &&
            typeof value === 'object' &&
            'Plaintext' in value &&
            value.Plaintext instanceof Uint8Array
          )
            value.Plaintext.fill(0);
          if (!settled) abort();
          return;
        }
        settled = true;
        signal.removeEventListener('abort', abort);
        resolve(value);
      }, rejectOnce);
    });
  }
  async assertReady(): Promise<void> {
    try {
      const signal = this.signal();
      for (const KeyId of this.allowedKeys) {
        const response = await this.invoke(
          (signal) => this.operations.describe({ KeyId }, signal),
          signal,
        );
        signal.throwIfAborted();
        const key = response.KeyMetadata;
        if (
          key?.Arn !== KeyId ||
          key.Enabled !== true ||
          key.KeyState !== 'Enabled' ||
          key.KeySpec !== algorithm ||
          key.KeyUsage !== 'ENCRYPT_DECRYPT' ||
          !key.EncryptionAlgorithms?.includes(algorithm)
        )
          throw fail();
      }
    } catch {
      throw new Error('vault_kms_unavailable');
    }
  }
  async wrap(key: Buffer, context: EncryptionContext): Promise<WrappedKey> {
    let plaintext: Buffer | undefined;
    try {
      if (!Buffer.isBuffer(key) || key.length !== 32) throw fail();
      const EncryptionContext = authenticatedContext(context);
      const signal = this.signal();
      plaintext = Buffer.from(key);
      const response = await this.invoke(
        (requestSignal) =>
          this.operations.encrypt(
            {
              KeyId: this.keyArn,
              Plaintext: plaintext,
              EncryptionAlgorithm: algorithm,
              EncryptionContext,
            },
            requestSignal,
          ),
        signal,
      );
      signal.throwIfAborted();
      const blob = response.CiphertextBlob;
      if (
        response.KeyId !== this.keyArn ||
        response.EncryptionAlgorithm !== algorithm ||
        !(blob instanceof Uint8Array) ||
        blob.length === 0 ||
        blob.length > 6144
      )
        throw fail();
      return {
        keyVersion: `${versionPrefix}${this.keyArn}`,
        wrappedKey: Buffer.from(blob).toString('base64'),
      };
    } catch {
      throw fail();
    } finally {
      plaintext?.fill(0);
    }
  }
  async unwrap(key: WrappedKey, context: EncryptionContext): Promise<Buffer> {
    let response: DecryptCommandOutput | undefined;
    try {
      const KeyId =
        typeof key.keyVersion === 'string' && key.keyVersion.startsWith(versionPrefix)
          ? key.keyVersion.slice(versionPrefix.length)
          : '';
      if (
        !this.allowedKeys.has(KeyId) ||
        typeof key.wrappedKey !== 'string' ||
        key.wrappedKey.length > 8192 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(key.wrappedKey)
      )
        throw fail();
      const CiphertextBlob = Buffer.from(key.wrappedKey, 'base64');
      if (
        !CiphertextBlob.length ||
        CiphertextBlob.length > 6144 ||
        CiphertextBlob.toString('base64') !== key.wrappedKey
      )
        throw fail();
      const signal = this.signal();
      response = await this.invoke(
        (requestSignal) =>
          this.operations.decrypt(
            {
              KeyId,
              CiphertextBlob,
              EncryptionAlgorithm: algorithm,
              EncryptionContext: authenticatedContext(context),
            },
            requestSignal,
          ),
        signal,
      );
      signal.throwIfAborted();
      if (
        response.KeyId !== KeyId ||
        response.EncryptionAlgorithm !== algorithm ||
        !(response.Plaintext instanceof Uint8Array) ||
        response.Plaintext.length !== 32
      )
        throw fail();
      return Buffer.from(response.Plaintext);
    } catch {
      throw fail();
    } finally {
      if (response?.Plaintext instanceof Uint8Array) response.Plaintext.fill(0);
    }
  }
  close(): void {
    if (this.closeError) throw this.closeError;
    if (this.stopping.signal.aborted) return;
    this.stopping.abort();
    try {
      this.operations.close();
    } catch {
      this.closeError = new Error('vault_kms_close_failed');
      throw this.closeError;
    }
  }
}
