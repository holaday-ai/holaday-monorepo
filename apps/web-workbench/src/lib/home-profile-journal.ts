import type { createPinnedTrpc } from './trpc';

type Home = ReturnType<typeof createPinnedTrpc>['browserHome'];
export type HomeProfileOptions = Awaited<ReturnType<Home['profileOptions']['query']>>;
export type HomeSaveRequest = Parameters<Home['saveProfile']['mutate']>[0];
export type HomeSaveReceipt = Awaited<ReturnType<Home['profileSaveReceipt']['query']>>;
export interface HomeProfileApi {
  options(): Promise<HomeProfileOptions>;
  receipt(request: HomeSaveRequest): Promise<HomeSaveReceipt>;
  save(
    request: HomeSaveRequest,
  ): Promise<{ id: string; origin: string; status: string; expiresAt: number }>;
  cancel(
    request: HomeSaveRequest,
  ): Promise<{ state: 'saved' | 'cancelled'; id?: string; origin?: string }>;
  select(profileId: string | null): Promise<unknown>;
  forget(profileId: string): Promise<unknown>;
}
export interface HomeProfileJournalDependencies {
  key: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  lock<T>(run: () => Promise<T>): Promise<T>;
  current(): void;
  uuid(): string;
  api: HomeProfileApi;
}
export type HomeSaveInspection = {
  pending: HomeSaveRequest | null;
  receipt: HomeSaveReceipt | null;
};
export class HomeProfileJournal {
  constructor(private readonly deps: HomeProfileJournalDependencies) {}
  private read(): HomeSaveRequest | null {
    this.deps.current();
    const raw = this.deps.storage.getItem(this.deps.key);
    if (raw === null) return null;
    try {
      if (raw.length > 4096) throw new Error();
      const row = JSON.parse(raw);
      if (
        !row ||
        row.version !== 1 ||
        Object.keys(row).sort().join(',') !== 'request,version' ||
        !validRequest(row.request)
      )
        throw new Error();
      return row.request;
    } catch {
      throw new Error('无法安全读取上一次保存记录，请保留记录并联系支持。');
    }
  }
  private acknowledge(request: HomeSaveRequest): void {
    if (JSON.stringify(this.read()) !== JSON.stringify(request))
      throw new Error('保存记录已变化，请重新核对结果。');
    this.deps.current();
    this.deps.storage.removeItem(this.deps.key);
  }
  private async call<T>(run: () => Promise<T>): Promise<T> {
    this.deps.current();
    const result = await run();
    this.deps.current();
    return result;
  }
  private async inspectLocked(): Promise<HomeSaveInspection> {
    const pending = this.read();
    if (!pending) return { pending: null, receipt: null };
    const receipt = await this.call(() => this.deps.api.receipt(pending));
    if (
      receipt.state !== 'missing' &&
      (receipt.id !== pending.requestId || receipt.origin !== pending.origin)
    )
      throw new Error('保存回执与原请求不一致，请保留记录并联系支持。');
    if (receipt.state === 'saved') {
      this.acknowledge(pending);
      return { pending: null, receipt };
    }
    return { pending, receipt };
  }
  inspect(): Promise<HomeSaveInspection> {
    return this.deps.lock(() => this.inspectLocked());
  }
  save(options: HomeProfileOptions, includeStorage: boolean): Promise<HomeSaveInspection> {
    return this.deps.lock(async () => {
      const existing = this.read();
      if (existing) return this.inspectLocked();
      if (!options.enabled || !options.source)
        throw new Error('请先打开可保存的网站并刷新保存面板。');
      const request: HomeSaveRequest = {
        consent: 'cloud-browser-profile-v1',
        origin: options.source.origin,
        sourceId: options.source.sourceId,
        includeStorage,
        requestId: this.deps.uuid(),
        requestedAt: options.serverNow,
        clearEpoch: options.clearEpoch,
      };
      if (!validRequest(request)) throw new Error('无法准备这次保存，请刷新面板后重试。');
      this.deps.current();
      this.deps.storage.setItem(this.deps.key, JSON.stringify({ version: 1, request }));
      const saved = await this.call(() => this.deps.api.save(request));
      if (
        saved.id !== request.requestId ||
        saved.origin !== request.origin ||
        saved.status !== 'connected'
      )
        throw new Error('无法确认保存结果，请核对上一次保存。');
      this.acknowledge(request);
      return {
        pending: null,
        receipt: { state: 'saved', id: saved.id, origin: saved.origin, expiresAt: saved.expiresAt },
      };
    });
  }
  cancel(): Promise<{ state: 'none' | 'saved' | 'cancelled'; origin?: string }> {
    return this.deps.lock(async () => {
      const request = this.read();
      if (!request) return { state: 'none' };
      const result = await this.call(() => this.deps.api.cancel(request));
      if (
        result.state === 'saved' &&
        (result.id !== request.requestId || result.origin !== request.origin)
      )
        throw new Error('保存回执与原请求不一致，请保留记录并联系支持。');
      this.acknowledge(request);
      return {
        state: result.state,
        ...(result.state === 'saved' ? { origin: request.origin } : {}),
      };
    });
  }
}

function validRequest(value: unknown): value is HomeSaveRequest {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !==
    'clearEpoch,consent,includeStorage,origin,requestId,requestedAt,sourceId'
  )
    return false;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    row.consent !== 'cloud-browser-profile-v1' ||
    typeof row.origin !== 'string' ||
    typeof row.includeStorage !== 'boolean' ||
    typeof row.sourceId !== 'string' ||
    !uuid.test(row.sourceId) ||
    typeof row.requestId !== 'string' ||
    !uuid.test(row.requestId) ||
    typeof row.requestedAt !== 'number' ||
    !Number.isSafeInteger(row.requestedAt) ||
    row.requestedAt <= 0 ||
    typeof row.clearEpoch !== 'number' ||
    !Number.isSafeInteger(row.clearEpoch) ||
    row.clearEpoch < 0
  )
    return false;
  try {
    const url = new URL(row.origin);
    return (
      row.origin === url.origin &&
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
