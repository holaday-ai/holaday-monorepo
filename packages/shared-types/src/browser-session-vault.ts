import { z } from 'zod';
import { exactWebOriginSchema } from './browser-user-contract.js';

export const browserGrantPurposeSchema = z.enum([
  'read',
  'act',
  'session-import',
  'profile-persist',
  'record',
]);
export const browserGrantRequestSchema = z
  .object({
    origin: exactWebOriginSchema,
    purposes: z.array(browserGrantPurposeSchema).min(1).max(5),
    storageKeys: z.array(z.string().min(1).max(128)).max(20).default([]),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();
export const browserSessionCookieSchema = z
  .object({
    name: z.string().min(1).max(256),
    value: z.string().max(4096),
    domain: z.string().min(1).max(253),
    path: z.string().startsWith('/').max(1024),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    hostOnly: z.boolean(),
    sameSite: z.enum(['no_restriction', 'lax', 'strict', 'unspecified']),
    session: z.boolean(),
    expirationDate: z.number().finite().positive().optional(),
    partitionKey: z
      .object({ topLevelSite: exactWebOriginSchema, hasCrossSiteAncestor: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
export const browserSessionStateSchema = z
  .object({
    cookies: z.array(browserSessionCookieSchema).max(500),
    storage: z
      .array(z.object({ name: z.string().min(1).max(128), value: z.string().max(16384) }).strict())
      .max(20),
  })
  .strict();
export type BrowserGrantRequest = z.input<typeof browserGrantRequestSchema>;
export type BrowserSessionState = z.infer<typeof browserSessionStateSchema>;
export type BrowserGrantPurpose = z.infer<typeof browserGrantPurposeSchema>;
export type BrowserSessionStatus =
  | 'awaiting_import'
  | 'verifying'
  | 'connected'
  | 'relogin'
  | 'risk_blocked'
  | 'revoked'
  | 'expired';
export interface BrowserGrantMetadata {
  id: string;
  origin: string;
  originSet: string[];
  /** Registrable domain of the site plus reviewed related login domains (no payment domains). */
  cookieDomains: string[];
  importScope: { cookies: true; localStorageKeys: string[]; indexedDB: false };
  purposes: BrowserGrantPurpose[];
  storageKeys: string[];
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
  version: number;
  status: BrowserSessionStatus;
  lastUsedAt: number | null;
  cookieCount: number;
  reason: string | null;
}
