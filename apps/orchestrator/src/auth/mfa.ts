import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TOTP_STEP_MS = 30_000;
const MFA_AAD = Buffer.from('holaday:mfa-secret:v1', 'utf8');
const MFA_KEY_BYTES = 32;
let cachedMfaKey: Buffer | null = null;

function mfaKey(): Buffer {
  if (cachedMfaKey) return cachedMfaKey;
  const raw = process.env.MFA_MASTER_KEY?.trim();
  if (!raw) {
    throw new Error('MFA_MASTER_KEY is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== MFA_KEY_BYTES) {
    throw new Error(`MFA_MASTER_KEY must decode to ${MFA_KEY_BYTES} bytes`);
  }
  cachedMfaKey = key;
  return key;
}

export function _resetMfaKeyCacheForTests(): void {
  cachedMfaKey = null;
}

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid Base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, timestampMs: number, digits = 6): string {
  const counter = BigInt(Math.floor(timestampMs / TOTP_STEP_MS));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function verifyTotp(
  secret: string,
  code: string,
  timestampMs = Date.now(),
  window = 1,
): { valid: false } | { valid: true; step: number } {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return { valid: false };
  const candidate = Buffer.from(normalized, 'utf8');
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateTime = timestampMs + offset * TOTP_STEP_MS;
    const expected = Buffer.from(totpAt(secret, candidateTime), 'utf8');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { valid: true, step: Math.floor(candidateTime / TOTP_STEP_MS) };
    }
  }
  return { valid: false };
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mfaKey(), iv);
  cipher.setAAD(MFA_AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptMfaSecret(envelope: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw, extra] = envelope.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw || extra) {
    throw new Error('invalid MFA secret envelope');
  }
  const iv = Buffer.from(ivRaw, 'base64url');
  const tag = Buffer.from(tagRaw, 'base64url');
  const ciphertext = Buffer.from(ciphertextRaw, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('invalid MFA secret envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', mfaKey(), iv);
  decipher.setAAD(MFA_AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < 10) {
    const bytes = randomBytes(10);
    let raw = '';
    for (const byte of bytes) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHmac('sha256', mfaKey())
    .update('holaday:mfa-recovery:v1\0')
    .update(normalizeRecoveryCode(code))
    .digest('hex');
}
