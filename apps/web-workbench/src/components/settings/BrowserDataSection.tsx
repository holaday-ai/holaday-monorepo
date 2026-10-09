import { getAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { Section } from '@/pages/PageShell';
import type { BrowserGrantMetadata } from '@holaday/shared-types';
import { useEffect, useState } from 'react';
type Mode = {
  enabled: boolean;
  importEnabled: boolean;
  profileEnabled: boolean;
  grants: BrowserGrantMetadata[];
};
type Tab = Awaited<ReturnType<typeof trpc.tasks.localChromeTabs.query>>['tabs'][number];
const statuses: Record<string, string> = {
  awaiting_import: '等待导入',
  verifying: '正在校验',
  connected: '已连接',
  relogin: '需要重新登录',
  risk_blocked: '站点风控阻止，请回到 Chrome',
  revoked: '已撤销',
  expired: '已过期',
};
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/browser-data${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${getAccessToken() ?? ''}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  if (!response.ok) throw new Error('browser_data_unavailable');
  return response.json();
}
export function BrowserDataSection() {
  const [mode, setMode] = useState<Mode>();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [index, setIndex] = useState('');
  const [consent, setConsent] = useState(false);
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [keys, setKeys] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void request<Mode>('', undefined, controller.signal)
      .then(setMode)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setFailed(false);
    try {
      await work();
      setMode(await request<Mode>(''));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      id="browser-data"
      title="浏览器登录与数据"
      description="按站点授权云端只读访问，随时撤销和清除。"
    >
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          暂时无法处理，请重试；可继续使用你的 Chrome。
        </p>
      ) : null}
      {!mode ? (
        <p className="text-sm text-muted-foreground">正在读取状态…</p>
      ) : !mode.enabled ? (
        <p className="text-sm text-muted-foreground">
          云端登录数据导入尚未启用。你仍可使用自己的 Chrome 执行任务。
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            只导入所选站点的 Cookie 和你指定的 localStorage
            字段，不复制密码、支付卡、历史或书签。云端 IP
            与你的设备不同，可能要求重新登录或触发风控；遇到挑战请回到
            Chrome。当前云端任务只读，不发送表单。
          </p>
          {mode.importEnabled ? (
            <div className="space-y-3 rounded-lg border p-4">
              <button
                type="button"
                className="text-sm underline"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const found = await trpc.tasks.localChromeTabs.query();
                    setTabs(found.tabs);
                    setIndex('');
                    setConsent(false);
                  })
                }
              >
                选择 Chrome 站点
              </button>
              {tabs.length ? (
                <label className="block text-sm">
                  已选站点
                  <select
                    aria-label="已选站点"
                    className="ml-3 rounded border bg-background p-2"
                    value={index}
                    disabled={busy}
                    onChange={(e) => {
                      setIndex(e.target.value);
                      setConsent(false);
                    }}
                  >
                    <option value="">请选择</option>
                    {tabs.map((tab, i) => (
                      <option key={`${tab.extensionClientId}:${tab.tabId}`} value={i}>
                        {new URL(tab.expectedUrl).origin}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">请先连接扩展并打开已登录的站点。</p>
              )}
              <label className="block text-sm">
                localStorage 字段（选填）
                <input
                  aria-label="localStorage 字段（选填）"
                  className="ml-2 rounded border bg-background p-2"
                  value={keys}
                  onChange={(e) => setKeys(e.target.value)}
                  placeholder="字段名，以逗号分隔"
                  disabled={busy}
                />
              </label>
              {mode.profileEnabled ? (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={persist}
                    disabled={busy}
                    onChange={(e) => setPersist(e.target.checked)}
                  />
                  保存云端登录状态供后续任务使用
                </label>
              ) : null}
              <p className="text-xs text-muted-foreground">
                导入授权最长 7 天，Cookie 提前失效时同步失效。保存的云端状态闲置 7 天或满 30
                天清除，且不会超过站点授权期限。续期需要重新授权；不保证所有站点都支持导入。
              </p>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                我同意将这个站点的所选登录数据加密保存到云端，用于只读任务。
              </label>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
                disabled={busy || !consent || index === ''}
                onClick={() =>
                  void action(async () => {
                    const tab = tabs[Number(index)];
                    if (!tab) throw new Error();
                    const storageKeys = [
                      ...new Set(
                        keys
                          .split(',')
                          .map((k) => k.trim())
                          .filter(Boolean),
                      ),
                    ];
                    const grant = await request<BrowserGrantMetadata>('/grants', {
                      consent: 'session-import-v1',
                      request: {
                        origin: new URL(tab.expectedUrl).origin,
                        purposes: [
                          'read',
                          'session-import',
                          ...(persist ? ['profile-persist'] : []),
                        ],
                        storageKeys,
                      },
                    });
                    await request('/dispatch', {
                      grantId: grant.id,
                      extensionClientId: tab.extensionClientId,
                      target: {
                        tabId: tab.tabId,
                        selectionId: tab.selectionId,
                        expectedUrl: tab.expectedUrl,
                      },
                    });
                    setConsent(false);
                  })
                }
              >
                {busy ? '处理中…' : '授权并导入'}
              </button>
            </div>
          ) : null}
          {mode.grants.map((grant) => (
            <div
              key={grant.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <div>
                <p>
                  {grant.origin} · {statuses[grant.status] ?? '状态待确认'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {grant.cookieCount} 条 Cookie · 到期 {new Date(grant.expiresAt).toLocaleString()}{' '}
                  · 最近使用{' '}
                  {grant.lastUsedAt ? new Date(grant.lastUsedAt).toLocaleString() : '尚未使用'}
                </p>
              </div>
              {!['revoked', 'expired'].includes(grant.status) ? (
                <button
                  type="button"
                  className="underline"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await request(`/grants/${grant.id}/revoke`, {});
                    })
                  }
                >
                  撤销
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-destructive underline"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await request('/clear', {});
              })
            }
          >
            清除浏览器数据
          </button>
        </div>
      )}
    </Section>
  );
}
