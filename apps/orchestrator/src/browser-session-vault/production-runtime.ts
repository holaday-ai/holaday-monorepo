import { isIP } from 'node:net';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import {
  type AwsKmsConfiguration,
  AwsKmsKeyProvider,
  validateAwsKmsConfiguration,
} from './aws-kms-key-provider.js';
import type { KeyProvider } from './crypto.js';
import { type VaultRuntime, createVaultRuntime } from './runtime.js';
import type { TrustedSiteProbe } from './worker.js';

export interface ProductionVaultOptions {
  importEnabled: boolean;
  profileEnabled: boolean;
  cloudHomeEnabled?: boolean;
  provider?: string;
  region?: string;
  keyArn?: string;
  profile?: string;
  decryptKeyArnsCsv?: string;
  probesJson?: string;
  db?: DB;
}
type ProductionKeys = KeyProvider & { assertReady(): Promise<void>; close(): void };
interface Dependencies {
  createKeys?(configuration: AwsKmsConfiguration): ProductionKeys;
  createRuntime?: typeof createVaultRuntime;
}
const hasControlCharacters = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const selector = z
  .string()
  .min(1)
  .max(512)
  .refine((v) => v.trim().length > 0 && !hasControlCharacters(v));
const probeConfiguration = z
  .object({
    origin: z.string().max(2048),
    path: z.string().min(1).max(2048),
    selector,
    subject: z
      .object({
        selector,
        attribute: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
          .optional(),
        adapter: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
      })
      .strict(),
  })
  .strict();

/** Server configuration only. No page/client data is accepted as a probe definition. */
export function parseTrustedSiteProbes(
  value: string | undefined,
): ReadonlyMap<string, TrustedSiteProbe> {
  if (typeof value !== 'string' || !value.length || value.length > 32768)
    throw new Error('vault_trusted_sites_required');
  try {
    const entries = z.array(probeConfiguration).min(1).max(16).parse(JSON.parse(value));
    const probes = new Map<string, TrustedSiteProbe>();
    for (const entry of entries) {
      const origin = new URL(entry.origin);
      const path = new URL(entry.path, entry.origin);
      const host = origin.hostname.replace(/^\[|\]$/g, '');
      if (
        origin.protocol !== 'https:' ||
        origin.origin !== entry.origin ||
        origin.username ||
        origin.password ||
        isIP(host) ||
        !host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal)$/.test(host) ||
        !entry.path.startsWith('/') ||
        entry.path.startsWith('//') ||
        /[?#\\]/.test(entry.path) ||
        hasControlCharacters(entry.path) ||
        path.origin !== entry.origin ||
        path.pathname !== entry.path ||
        probes.has(entry.origin)
      )
        throw new Error('invalid_probe');
      probes.set(
        entry.origin,
        Object.freeze({
          path: entry.path,
          selector: entry.selector,
          subject: Object.freeze({ ...entry.subject }),
        }),
      );
    }
    return probes;
  } catch {
    throw new Error('vault_trusted_site_configuration');
  }
}

/** Fail before listeners open; default-off paths do not resolve AWS credentials. */
export async function createProductionVaultRuntime(
  options: ProductionVaultOptions,
  dependencies: Dependencies = {},
): Promise<(VaultRuntime & { close(): void }) | undefined> {
  if (!options.importEnabled && !options.profileEnabled && !options.cloudHomeEnabled)
    return undefined;
  if (options.provider !== 'aws-kms') throw new Error('vault_key_provider_required');
  const probes = parseTrustedSiteProbes(options.probesJson);
  const configuration = {
    region: options.region ?? '',
    keyArn: options.keyArn ?? '',
    profile: options.profile ?? '',
    decryptKeyArns: options.decryptKeyArnsCsv
      ?.split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
  validateAwsKmsConfiguration(configuration);
  const keys = dependencies.createKeys?.(configuration) ?? new AwsKmsKeyProvider(configuration);
  try {
    if (keys.kind !== 'kms') throw new Error('vault_key_provider_required');
    await keys.assertReady();
    const runtime = (dependencies.createRuntime ?? createVaultRuntime)({
      importEnabled: options.importEnabled,
      profileEnabled: options.profileEnabled,
      cloudHomeEnabled: options.cloudHomeEnabled,
      db: options.db,
      keys,
      probes,
    });
    if (!runtime) throw new Error('vault_startup_failed');
    let closed = false;
    let closeError: Error | undefined;
    return Object.assign(runtime, {
      close() {
        if (closeError) throw closeError;
        if (closed) return;
        try {
          keys.close();
          closed = true;
        } catch {
          closeError = new Error('vault_kms_close_failed');
          throw closeError;
        }
      },
    });
  } catch (error) {
    try {
      keys.close();
    } catch {
      throw new Error('vault_startup_cleanup_failed');
    }
    const message =
      error instanceof Error && /^vault_[a-z_]+$/.test(error.message)
        ? error.message
        : 'vault_startup_failed';
    throw new Error(message);
  }
}
