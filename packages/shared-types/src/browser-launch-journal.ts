import { z } from 'zod';

const sourceSchema = z
  .object({
    browserSessionId: z.string().uuid(),
    tabId: z.number().int().nonnegative(),
    origin: z
      .string()
      .url()
      .refine((s) => /^https?:/.test(s) && new URL(s).origin === s),
    selectionId: z.string().uuid(),
    mode: z.enum(['current', 'independent']),
  })
  .strict();
const entrySchema = z
  .object({
    version: z.literal(1),
    ownerHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    clientRequestId: z.string().uuid(),
    preparationId: z.string().uuid(),
    createdAt: z.number().finite().nonnegative(),
    phase: z.enum(['preparing', 'creating', 'created', 'acknowledged']),
    source: sourceSchema,
    request: z
      .record(z.unknown())
      .refine((r) => typeof r.intent === 'string' && r.intent.length > 0),
    taskId: z.string().min(1).max(64).optional(),
    status: z.string().max(64).optional(),
  })
  .strict();
export type BrowserLaunchSource = z.infer<typeof sourceSchema>;
export type BrowserLaunchJournalEntry = z.infer<typeof entrySchema>;
export interface BrowserLaunchJournalStorage {
  all(): Promise<unknown[]>;
  put(entry: BrowserLaunchJournalEntry): Promise<void>;
  remove(id: string): Promise<void>;
  lock<T>(run: () => Promise<T>): Promise<T>;
}
export interface BrowserLaunchTarget {
  extensionClientId: string;
  tabId: number;
  expectedUrl: string;
  selectionId: string;
  launchBrowserSessionId?: string;
  /** UI negotiation only. Remove before sending an authoritative selection. */
  preparationReadiness?: boolean;
}
export type BrowserLaunchCreationReceipt =
  | { state: 'absent' | 'pending' | 'unknown' }
  | { state: 'created'; taskId: string; status: string };
export interface BrowserLaunchJournalDependencies<T extends { taskId: string }> {
  onOperation?(entry: BrowserLaunchJournalEntry): void;
  current(): Promise<void>;
  receipt(id: string): Promise<BrowserLaunchCreationReceipt>;
  resolve(source: BrowserLaunchSource): Promise<BrowserLaunchTarget>;
  prepare(
    source: BrowserLaunchTarget,
    id: string,
    resumeOnly: boolean,
    mode: BrowserLaunchSource['mode'],
  ): Promise<BrowserLaunchTarget>;
  create(
    request: Record<string, unknown> & {
      intent: string;
      localChrome: BrowserLaunchTarget;
      clientRequestId: string;
    },
  ): Promise<T>;
  release(entry: BrowserLaunchJournalEntry): Promise<void>;
}
export interface BrowserLaunchJournalResult<T> {
  taskId: string;
  status?: string;
  operationId: string;
  recovered: boolean;
  response?: T;
}
export const BROWSER_LAUNCH_JOURNAL_PREFIX = 'holaday.browser-launch.v1.';
export const BROWSER_LAUNCH_RECOVERED_EVENT = 'holaday:browser-launch-recovered';
export function resolveBrowserLaunchTarget(
  source: BrowserLaunchSource,
  tabs: Array<BrowserLaunchTarget & { launchRecoveryReady?: boolean }>,
): BrowserLaunchTarget {
  const matching = tabs.filter(
    (t) => t.launchBrowserSessionId === source.browserSessionId && t.launchRecoveryReady === true,
  );
  const connections = [...new Set(matching.map((t) => t.extensionClientId))];
  if (connections.length !== 1) throw new Error('原 Chrome 会话尚未连接，请连接原浏览器后继续。');
  return {
    extensionClientId: connections[0]!,
    tabId: source.tabId,
    expectedUrl: source.origin,
    selectionId: source.selectionId,
    launchBrowserSessionId: source.browserSessionId,
    ...(matching.some((target) => target.preparationReadiness === true)
      ? { preparationReadiness: true }
      : {}),
  };
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
async function hash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
async function ownerDigest(ownerId: string): Promise<string> {
  z.string().min(1).max(128).parse(ownerId);
  return hash(ownerId);
}
const unknownMessage = '此前提交的结果尚未确认，请先查看任务列表；不会重复创建任务。';

/** Persistent adapter for the same preparation/client request IDs used by BrowserTaskLaunches.
 * Only user-authored request data is saved; source paths, page content and auth tokens are absent.
 */
export class BrowserLaunchJournal {
  constructor(private readonly storage: BrowserLaunchJournalStorage) {}

  private async entries(): Promise<BrowserLaunchJournalEntry[]> {
    const entries: BrowserLaunchJournalEntry[] = [];
    for (const raw of await this.storage.all()) {
      const parsed = entrySchema.safeParse(raw);
      if (!parsed.success) throw new Error(unknownMessage);
      if ((await hash(canonical(parsed.data.request))) !== parsed.data.requestHash)
        throw new Error(unknownMessage);
      if (['created', 'acknowledged'].includes(parsed.data.phase) && !parsed.data.taskId)
        throw new Error(unknownMessage);
      entries.push(parsed.data);
    }
    return entries;
  }
  async pending(ownerId: string): Promise<BrowserLaunchJournalEntry[]> {
    const ownerHash = await ownerDigest(ownerId);
    return (await this.entries()).filter(
      (e) => e.ownerHash === ownerHash && e.phase !== 'acknowledged',
    );
  }
  async run<T extends { taskId: string }>(
    ownerId: string,
    request: Record<string, unknown> & { intent: string },
    source: BrowserLaunchSource,
    deps: BrowserLaunchJournalDependencies<T>,
  ): Promise<BrowserLaunchJournalResult<T>> {
    source = sourceSchema.parse(source);
    request = JSON.parse(JSON.stringify(request));
    if (
      request.localChrome !== undefined ||
      request.clientRequestId !== undefined ||
      typeof request.intent !== 'string' ||
      !request.intent ||
      canonical(request).length > 262144
    )
      throw new Error('任务发起信息无效，请重新选择页面。');
    const requestHash = await hash(canonical(request));
    const ownerHash = await ownerDigest(ownerId);
    return this.storage.lock(async () => {
      await deps.current();
      const entries = await this.entries();
      await this.cleanupEntries(entries, ownerHash, deps);
      const matching = entries.filter(
        (e) =>
          e.ownerHash === ownerHash &&
          e.request.intent === request.intent &&
          e.phase !== 'acknowledged',
      );
      if (matching.length > 1) throw new Error(unknownMessage);
      let entry = matching[0];
      const existing = !!entry;
      if (!entry) {
        if (entries.filter((e) => e.phase !== 'acknowledged').length >= 64)
          throw new Error('待确认的任务过多，请先查看任务列表。');
        entry = {
          version: 1,
          ownerHash,
          requestHash,
          request: JSON.parse(JSON.stringify(request)),
          source: { ...source },
          phase: 'preparing',
          createdAt: Date.now(),
          clientRequestId: crypto.randomUUID(),
          preparationId: crypto.randomUUID(),
        };
        await this.storage.put(entry);
        await deps.current();
      }
      deps.onOperation?.(entry);
      return this.execute(entry, source, existing, deps, requestHash);
    });
  }
  async resume<T extends { taskId: string }>(
    ownerId: string,
    id: string,
    deps: BrowserLaunchJournalDependencies<T>,
  ): Promise<BrowserLaunchJournalResult<T>> {
    const ownerHash = await ownerDigest(ownerId);
    return this.storage.lock(async () => {
      await deps.current();
      const entry = (await this.entries()).find(
        (e) => e.clientRequestId === id && e.ownerHash === ownerHash && e.phase !== 'acknowledged',
      );
      if (!entry) throw new Error(unknownMessage);
      deps.onOperation?.(entry);
      return this.execute(entry, entry.source, true, deps);
    });
  }
  private async execute<T extends { taskId: string }>(
    entry: BrowserLaunchJournalEntry,
    requestedSource: BrowserLaunchSource,
    existing: boolean,
    deps: BrowserLaunchJournalDependencies<T>,
    requestedHash = entry.requestHash,
  ): Promise<BrowserLaunchJournalResult<T>> {
    await deps.current();
    if (entry.phase === 'created' && entry.taskId)
      return {
        taskId: entry.taskId,
        status: entry.status,
        operationId: entry.clientRequestId,
        recovered: true,
      };
    if (existing) {
      const receipt = await deps.receipt(entry.clientRequestId);
      await deps.current();
      if (receipt.state === 'created') {
        await this.storage.put({
          ...entry,
          phase: 'created',
          taskId: receipt.taskId,
          status: receipt.status,
        });
        await deps.current();
        return {
          taskId: receipt.taskId,
          status: receipt.status,
          operationId: entry.clientRequestId,
          recovered: true,
        };
      }
      if (receipt.state !== 'absent') throw new Error(unknownMessage);
    }
    if (entry.requestHash !== requestedHash)
      throw new Error('此前提交内容发生变化，请先核对原任务；不会重复创建。');
    // An absent record may have been purged after the server's 24-hour TTL.
    if (Date.now() - entry.createdAt > 23 * 60 * 60 * 1000 || entry.createdAt > Date.now() + 60_000)
      throw new Error(unknownMessage);
    if (
      entry.source.browserSessionId !== requestedSource.browserSessionId ||
      entry.source.tabId !== requestedSource.tabId ||
      entry.source.origin !== requestedSource.origin ||
      entry.source.mode !== requestedSource.mode
    )
      throw new Error('原 Chrome 页面已改变，请先核对此前任务；不会切换浏览器重做。');
    const source = await deps.resolve(entry.source);
    await deps.current();
    if (source.launchBrowserSessionId !== entry.source.browserSessionId)
      throw new Error('原 Chrome 会话已断开，请重新连接后继续；不会切换浏览器。');
    if (source.tabId !== entry.source.tabId || source.expectedUrl !== entry.source.origin)
      throw new Error('原页面目标已改变，请核对任务。');
    const target = await deps.prepare(source, entry.preparationId, existing, entry.source.mode);
    await deps.current();
    if (
      target.launchBrowserSessionId !== entry.source.browserSessionId ||
      target.extensionClientId !== source.extensionClientId ||
      target.expectedUrl !== entry.source.origin ||
      (entry.source.mode === 'current'
        ? target.tabId !== source.tabId
        : target.tabId === source.tabId)
    )
      throw new Error('Chrome 会话已改变，请查看此前任务。');
    entry = { ...entry, phase: 'creating' };
    await this.storage.put(entry);
    await deps.current();
    const response = await deps.create({
      ...entry.request,
      intent: entry.request.intent as string,
      localChrome: {
        extensionClientId: target.extensionClientId,
        tabId: target.tabId,
        expectedUrl: target.expectedUrl,
        selectionId: target.selectionId,
        ...(target.launchBrowserSessionId
          ? { launchBrowserSessionId: target.launchBrowserSessionId }
          : {}),
      },
      clientRequestId: entry.clientRequestId,
    });
    await deps.current();
    if (!response.taskId) throw new Error(unknownMessage);
    if (
      ['creationUnconfirmed', 'acceptedUnconfirmed'].includes(
        String((response as { admissionState?: unknown }).admissionState),
      )
    )
      throw new Error(unknownMessage);
    const status = (response as { status?: unknown }).status;
    await this.storage.put({
      ...entry,
      phase: 'created',
      taskId: response.taskId,
      ...(typeof status === 'string' ? { status } : {}),
    });
    await deps.current();
    return {
      taskId: response.taskId,
      operationId: entry.clientRequestId,
      recovered: false,
      response,
    };
  }
  async acknowledge<T extends { taskId: string }>(
    ownerId: string,
    id: string,
    deps: BrowserLaunchJournalDependencies<T>,
  ): Promise<void> {
    const ownerHash = await ownerDigest(ownerId);
    await this.storage.lock(async () => {
      await deps.current();
      const entry = (await this.entries()).find(
        (e) => e.ownerHash === ownerHash && e.clientRequestId === id,
      );
      if (!entry) return;
      if (!entry.taskId) throw new Error(unknownMessage);
      const acknowledged = { ...entry, phase: 'acknowledged' as const };
      await this.storage.put(acknowledged);
      await deps.current();
      await this.cleanupEntries([acknowledged], ownerHash, deps);
    });
  }
  async cleanup<T extends { taskId: string }>(
    ownerId: string,
    deps: BrowserLaunchJournalDependencies<T>,
  ): Promise<void> {
    const ownerHash = await ownerDigest(ownerId);
    await this.storage.lock(async () => {
      await deps.current();
      await this.cleanupEntries(await this.entries(), ownerHash, deps);
    });
  }
  private async cleanupEntries<T extends { taskId: string }>(
    entries: BrowserLaunchJournalEntry[],
    ownerHash: string,
    deps: BrowserLaunchJournalDependencies<T>,
  ): Promise<void> {
    for (const entry of entries
      .filter((e) => e.ownerHash === ownerHash && e.phase === 'acknowledged')
      .slice(0, 2)) {
      if (entry.ownerHash !== ownerHash || entry.phase !== 'acknowledged') continue;
      try {
        await deps.release(entry);
        await deps.current();
        await this.storage.remove(entry.clientRequestId);
      } catch {
        // A confirmed task remains confirmed if its non-destructive cleanup fails.
        await deps.current();
      }
    }
  }
}
