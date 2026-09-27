import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import { z } from 'zod';
import type { MaintenanceIdentity } from './ordinary-maintenance.js';

const directory = '/var/lib/holaday-deploy/evidence';
const maxBytes = 256 * 1024;
const denied = () => new Error('MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const candidate = z.string().regex(/^[a-f0-9]{40}$/);
const timestamp = z.number().int().safe().nonnegative();
const count = z.number().int().safe().nonnegative();
const identitySchema = z.object({ candidate, bootId: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
const bindingSchema = z
  .object({
    attempt: z
      .string()
      .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
    candidate,
    configDigest: hash,
    migrationDigest: hash,
    inventoryDigest: hash,
  })
  .strict();
const stage = z.enum(['prepare', 'preopen']);
const contextSchema = bindingSchema
  .extend({
    stage,
    nowMs: timestamp,
    identity: identitySchema.optional(),
  })
  .strict();
const sourceSchema = z
  .object({
    kind: z.enum(['host', 'database', 'provider-query', 'provider-rehearsal']),
    digest: hash,
    observedAtMs: timestamp,
    targetDigest: hash,
  })
  .strict();
const reportSchema = bindingSchema
  .extend({
    schemaVersion: z.literal(1),
    stage,
    observedAtMs: timestamp,
    maintenanceEndsAtMs: timestamp,
    reconcileByMs: timestamp,
    operatorRef: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
    identity: identitySchema.optional(),
    sources: z.array(sourceSchema).length(4),
    host: z
      .object({
        inventoryDigest: hash,
        unknownWriters: count,
        unsettledWork: count,
        phase: z.enum(['prepared', 'fenced-stopped']),
      })
      .strict(),
    payments: z
      .object({
        scopeDigest: hash,
        queriedScopeDigest: hash,
        unresolved: count,
        validUnpaid: count,
        followupDigest: hash,
        recovery: z.enum(['retry-proven', 'query-and-existing-settlement-proven']),
        recoveryUntilMs: timestamp,
        rehearsalDigest: hash,
        deferredUnverified: z
          .array(
            z.union([
              z
                .object({
                  // Keep this exact approved historical record aligned with the collector.
                  recordDigest: z.literal(
                    '75467f5b0aec5367761433a57fbd45aa9a41347e638f385178c12f5af7740b95',
                  ),
                  fieldsDigest: hash,
                  approvalRef: z.literal('paypal-sandbox-20260927'),
                  state: z.literal('unverified-deferred'),
                })
                .strict(),
              z
                .object({
                  recordDigest: hash,
                  fieldsDigest: hash,
                  approvalRef: z.literal('alipay-historical-20260927'),
                  state: z.literal('unverified-deferred'),
                })
                .strict(),
            ]),
          )
          .min(1)
          .max(10)
          .optional(),
      })
      .strict(),
  })
  .strict();
const indexSchema = bindingSchema
  .extend({ stage, identity: identitySchema.optional(), reportDigest: hash })
  .strict();
export type CutoverBinding = z.infer<typeof bindingSchema>;
export type ServicesContext = z.infer<typeof contextSchema>;
export type CutoverEvidence = z.infer<typeof reportSchema>;

export function parseServicesContext(value: unknown): ServicesContext {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success) throw denied();
  const context = parsed.data;
  if (
    context.stage === 'preopen'
      ? context.identity?.candidate !== context.candidate
      : context.identity !== undefined
  )
    throw denied();
  return context;
}
const sameIdentity = (a?: MaintenanceIdentity, b?: MaintenanceIdentity) =>
  a?.candidate === b?.candidate && a?.bootId === b?.bootId;
const sameBinding = (a: CutoverBinding, b: CutoverBinding) =>
  (['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'] as const).every(
    (key) => a[key] === b[key],
  );
const fresh = (observed: number, now: number) => observed <= now && now - observed <= 60_000;

/** Interpret only protected collector output, never an operator success switch.
 * configDigest binds the application configuration; the collector must bind
 * gateway/merchant configuration in inventoryDigest as well. Source digests
 * bind the complete order scope and rehearsal artifact. */
export function validateServicesEvidence(value: unknown, expected: ServicesContext): void {
  const context = parseServicesContext(expected);
  const result = reportSchema.safeParse(value);
  if (!result.success) throw denied();
  const report = result.data;
  if (
    !sameBinding(report, context) ||
    report.stage !== context.stage ||
    !sameIdentity(report.identity, context.identity) ||
    !fresh(report.observedAtMs, context.nowMs) ||
    report.maintenanceEndsAtMs <= context.nowMs ||
    report.reconcileByMs < report.maintenanceEndsAtMs ||
    report.payments.recoveryUntilMs < report.reconcileByMs ||
    report.host.inventoryDigest !== context.inventoryDigest ||
    report.host.unknownWriters !== 0 ||
    report.host.unsettledWork !== 0 ||
    report.host.phase !== (context.stage === 'preopen' ? 'fenced-stopped' : 'prepared') ||
    report.payments.unresolved !== 0 ||
    report.payments.scopeDigest !== report.payments.queriedScopeDigest
  )
    throw denied();
  if (new Set(report.sources.map((source) => source.kind)).size !== 4) throw denied();
  const deferred = report.payments.deferredUnverified;
  if (deferred) {
    const paypal = deferred.filter((row) => row.approvalRef === 'paypal-sandbox-20260927');
    const alipay = deferred.filter((row) => row.approvalRef === 'alipay-historical-20260927');
    if (
      paypal.length > 1 ||
      (alipay.length &&
        (alipay.length !== 9 ||
          createHash('sha256')
            .update(JSON.stringify(alipay.map((row) => row.recordDigest).sort()))
            .digest('hex') !== '6e81aade39333ad180272497a70b06aeffb57194a643c525fde264684df69686'))
    )
      throw denied();
  }
  const databaseDigest = deferred
    ? createHash('sha256')
        .update(
          JSON.stringify([
            report.payments.scopeDigest,
            deferred.map((row) => [row.recordDigest, row.fieldsDigest, row.approvalRef, row.state]),
          ]),
        )
        .digest('hex')
    : report.payments.scopeDigest;
  for (const source of report.sources) {
    const historical = source.kind === 'provider-rehearsal';
    const target = source.kind === 'host' ? context.inventoryDigest : context.configDigest;
    const content =
      source.kind === 'host'
        ? context.inventoryDigest
        : source.kind === 'database'
          ? databaseDigest
          : source.kind === 'provider-query'
            ? report.payments.queriedScopeDigest
            : report.payments.rehearsalDigest;
    if (
      source.targetDigest !== target ||
      source.digest !== content ||
      source.observedAtMs > report.observedAtMs ||
      (!historical && !fresh(source.observedAtMs, context.nowMs))
    )
      throw denied();
  }
}

const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a: Stats, b: Stats) =>
  sameFile(a, b) &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs &&
  a.mode === b.mode &&
  a.uid === b.uid &&
  a.gid === b.gid &&
  a.nlink === b.nlink;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function checkDirectory(): Promise<Stats> {
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.uid !== 0 ||
    (stat.mode & 0o7777) !== 0o750 ||
    (await fs.realpath(directory)) !== directory
  )
    throw denied();
  return stat;
}
function checkFile(stat: Stats, group: number) {
  if (
    !stat.isFile() ||
    stat.uid !== 0 ||
    stat.gid !== group ||
    stat.nlink !== 1 ||
    (stat.mode & 0o7777) !== 0o640 ||
    stat.size < 1 ||
    stat.size > maxBytes
  )
    throw denied();
}
type ProtectedBytes = { bytes: Buffer; stat: Stats; path: string };
async function readProtected(name: string, folder: Stats): Promise<ProtectedBytes> {
  const path = `${directory}/${name}`;
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    checkFile(stat, folder.gid);
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, length);
      if (part.bytesRead === 0) break;
      length += part.bytesRead;
    }
    const after = await handle.stat();
    checkFile(after, folder.gid);
    if (
      length !== stat.size ||
      length > maxBytes ||
      !unchanged(stat, after) ||
      !unchanged(after, await fs.lstat(path)) ||
      !sameFile(folder, await checkDirectory())
    )
      throw denied();
    const value = bytes.subarray(0, length);
    if (!Buffer.from(value.toString('utf8')).equals(value)) throw denied();
    return { bytes: value, stat, path };
  } finally {
    await handle.close();
  }
}
function decodeIndex(file: ProtectedBytes) {
  const parsed = indexSchema.safeParse(JSON.parse(file.bytes.toString('utf8')));
  if (!parsed.success) throw denied();
  return parsed.data;
}
async function readBoundReport(
  context: ServicesContext,
  initialIndex?: ProtectedBytes,
): Promise<CutoverEvidence> {
  const folder = await checkDirectory();
  const initialReport = await fs.lstat(`${directory}/${context.attempt}.json`);
  checkFile(initialReport, folder.gid);
  const indexFile = initialIndex ?? (await readProtected('active.json', folder));
  const index = decodeIndex(indexFile);
  if (
    !sameBinding(index, context) ||
    index.stage !== context.stage ||
    !sameIdentity(index.identity, context.identity)
  )
    throw denied();
  const file = await readProtected(`${context.attempt}.json`, folder);
  if (!unchanged(initialReport, file.stat) || digest(file.bytes) !== index.reportDigest)
    throw denied();
  const report: unknown = JSON.parse(file.bytes.toString('utf8'));
  validateServicesEvidence(report, context);
  if (
    !unchanged(indexFile.stat, await fs.lstat(indexFile.path)) ||
    !unchanged(file.stat, await fs.lstat(file.path)) ||
    !sameFile(folder, await checkDirectory())
  )
    throw denied();
  return report as CutoverEvidence;
}
export async function readServicesEvidence(expected: ServicesContext): Promise<CutoverEvidence> {
  try {
    return await readBoundReport(parseServicesContext(expected));
  } catch {
    throw denied();
  }
}
export async function readActiveServicesContext(
  identity: MaintenanceIdentity,
  nowMs: number,
): Promise<ServicesContext> {
  try {
    identitySchema.parse(identity);
    const folder = await checkDirectory();
    const file = await readProtected('active.json', folder);
    const { reportDigest: _, ...binding } = decodeIndex(file);
    const context = parseServicesContext({ ...binding, nowMs });
    if (context.stage !== 'preopen' || !sameIdentity(context.identity, identity)) throw denied();
    await readBoundReport(context, file);
    return context;
  } catch {
    throw denied();
  }
}
