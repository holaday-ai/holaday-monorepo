type Tab = { id?: number; url?: string; title?: string; status?: string; pendingUrl?: string };
type Source = { tabId: number; origin: string };
interface RecordEntry {
  version: 1;
  sourceTabId: number;
  origin: string;
  sourceHash: string;
  nonce: string;
  phase: 'creating' | 'created' | 'navigating' | 'ready';
  tabId?: number;
  tabHash?: string;
}
interface Dependencies {
  owner(): string | null;
  current(): boolean;
  read(key: string): Promise<unknown>;
  write(key: string, entry: RecordEntry): Promise<void>;
  count(): Promise<number>;
  source(): Promise<Tab>;
  get(tabId: number): Promise<Tab>;
  find(marker: string): Promise<Tab[]>;
  create(marker: string): Promise<Tab>;
  navigate(tabId: number, url: string): Promise<unknown>;
  marker(nonce: string): string;
  wait(): Promise<void>;
  maxPolls?: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const phases = new Set(['creating', 'created', 'navigating', 'ready']);
export const TASK_TAB_JOURNAL_PREFIX = 'holaday.task-tab.v1.';
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
function record(value: unknown): RecordEntry {
  if (!value || typeof value !== 'object') throw new Error('preparation_record_invalid');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (key) =>
        ![
          'version',
          'sourceTabId',
          'origin',
          'sourceHash',
          'nonce',
          'phase',
          'tabId',
          'tabHash',
        ].includes(key),
    ) ||
    v.version !== 1 ||
    !Number.isSafeInteger(v.sourceTabId) ||
    Number(v.sourceTabId) < 0 ||
    typeof v.origin !== 'string' ||
    typeof v.sourceHash !== 'string' ||
    !digest.test(v.sourceHash) ||
    typeof v.nonce !== 'string' ||
    !uuid.test(v.nonce) ||
    typeof v.phase !== 'string' ||
    !phases.has(v.phase) ||
    (v.tabId !== undefined && (!Number.isSafeInteger(v.tabId) || Number(v.tabId) < 0)) ||
    (v.tabHash !== undefined && (typeof v.tabHash !== 'string' || !digest.test(v.tabHash))) ||
    (v.phase !== 'creating' && (!Number.isSafeInteger(v.tabId) || Number(v.tabId) < 0)) ||
    (v.phase === 'ready' && (typeof v.tabHash !== 'string' || !digest.test(v.tabHash)))
  )
    throw new Error('preparation_record_invalid');
  try {
    const url = new URL(v.origin);
    if (!/^https?:$/.test(url.protocol) || url.origin !== v.origin) throw new Error();
  } catch {
    throw new Error('preparation_record_invalid');
  }
  return v as unknown as RecordEntry;
}

/** Write-ahead effect journal. URLs stay in Chrome; persistence holds only origins/digests/IDs. */
export class TaskTabJournal {
  constructor(private readonly deps: Dependencies) {}
  async prepare(source: Source, preparationId: string): Promise<Tab> {
    const owner = this.deps.owner();
    this.assertCurrent();
    if (!owner || !uuid.test(preparationId)) throw new Error('target_required');
    const key = `${TASK_TAB_JOURNAL_PREFIX}${await hash(owner)}.${preparationId}`;
    const saved = await this.deps.read(key);
    this.assertCurrent();
    let entry: RecordEntry;
    if (saved === undefined) {
      if ((await this.deps.count()) >= 64) throw new Error('browser_busy');
      const original = await this.deps.source();
      this.assertCurrent();
      const url = new URL(original.url ?? '');
      if (
        original.id !== source.tabId ||
        url.origin !== source.origin ||
        !/^https?:$/.test(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error('target_changed');
      entry = {
        version: 1,
        sourceTabId: source.tabId,
        origin: source.origin,
        sourceHash: await hash(original.url ?? ''),
        nonce: crypto.randomUUID(),
        phase: 'creating',
      };
      await this.save(key, entry);
      // A crash after this write but before the browser receipt must never issue another create.
      const created = await this.deps.create(this.deps.marker(entry.nonce));
      this.assertCurrent();
      if (!Number.isSafeInteger(created.id) || created.id === source.tabId)
        throw new Error('tab_create_failed');
      entry = { ...entry, phase: 'created', tabId: created.id };
      await this.save(key, entry);
    } else {
      entry = record(saved);
      if (entry.sourceTabId !== source.tabId || entry.origin !== source.origin)
        throw new Error('target_changed');
    }
    if (entry.phase === 'creating') {
      const found = await this.poll(async () => {
        const tabs = await this.deps.find(this.deps.marker(entry.nonce));
        if (tabs.length > 1) throw new Error('preparation_ambiguous');
        return tabs[0] ?? null;
      });
      if (!Number.isSafeInteger(found.id) || found.id === source.tabId)
        throw new Error('target_changed');
      entry = { ...entry, phase: 'created', tabId: found.id };
      await this.save(key, entry);
    }
    if (entry.tabId === undefined || entry.tabId === source.tabId)
      throw new Error('target_changed');
    const tabId = entry.tabId;
    if (entry.phase === 'ready') {
      const tab = await this.deps.get(entry.tabId);
      this.assertCurrent();
      if (
        tab.id !== tabId ||
        tab.pendingUrl ||
        tab.status === 'loading' ||
        (await hash(tab.url ?? '')) !== entry.tabHash
      )
        throw new Error('target_changed');
      this.assertCurrent();
      return tab;
    }
    if (entry.phase === 'created') {
      const marker = this.deps.marker(entry.nonce);
      await this.poll(async () => {
        const placeholder = await this.deps.get(tabId);
        if (
          placeholder.id !== tabId ||
          (placeholder.pendingUrl && placeholder.pendingUrl !== marker) ||
          (placeholder.url && placeholder.url !== marker)
        )
          throw new Error('target_changed');
        if (placeholder.pendingUrl || placeholder.status === 'loading' || !placeholder.url)
          return null;
        return placeholder;
      });
      const original = await this.deps.get(entry.sourceTabId);
      this.assertCurrent();
      if (original.pendingUrl || (await hash(original.url ?? '')) !== entry.sourceHash)
        throw new Error('target_changed');
      entry = { ...entry, phase: 'navigating' };
      await this.save(key, entry);
      // Re-entry in this phase only observes. An uncertain navigation is never replayed.
      if (!original.url) throw new Error('target_changed');
      await this.deps.navigate(tabId, original.url);
      this.assertCurrent();
    }
    const marker = this.deps.marker(entry.nonce);
    const ready = await this.poll(async () => {
      const tab = await this.deps.get(tabId);
      if (tab.id !== tabId) throw new Error('target_changed');
      if (tab.pendingUrl || tab.status === 'loading' || tab.url === marker) return null;
      if (new URL(tab.url ?? '').origin !== entry.origin) throw new Error('origin_grant_required');
      return tab;
    });
    entry = { ...entry, phase: 'ready', tabHash: await hash(ready.url ?? '') };
    await this.save(key, entry);
    return ready;
  }
  private assertCurrent(): void {
    if (!this.deps.current()) throw new Error('target_changed');
  }
  private async save(key: string, entry: RecordEntry): Promise<void> {
    this.assertCurrent();
    await this.deps.write(key, entry);
    this.assertCurrent();
  }
  private async poll<T>(read: () => Promise<T | null>): Promise<T> {
    const deadline = Date.now() + 8_000;
    for (let n = 0; n < (this.deps.maxPolls ?? 160) && Date.now() <= deadline; n++) {
      this.assertCurrent();
      const value = await read();
      this.assertCurrent();
      if (value !== null) return value;
      await this.deps.wait();
    }
    throw new Error('task_tab_not_ready');
  }
}
