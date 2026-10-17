import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
/**
 * 模型管理 — one-click brain switches backed by the `model_catalog` table.
 * Changes apply immediately to new tasks: no env edit, no restart.
 */
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { formatDateTime, useMountedRef } from './admin-shared';

type ModelsData = Awaited<ReturnType<typeof trpc.models.adminList.query>>;
type ModelRow = ModelsData['items'][number];
type UpdateInput = Parameters<typeof trpc.models.adminUpdate.mutate>[0];

const PROVIDER_LABEL: Record<string, string> = {
  'alibaba-model-studio': '阿里云百炼',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

const LANE_LABEL: Record<string, string> = {
  browser: '浏览器决策',
  generate: '生成',
  scrape: '搜索抓取',
  plan: '规划',
  suggestions: '下一步建议',
  verifier: '核验',
  vision: '视觉',
  video_edit_planner: '视频剪辑规划',
};

export function AdminModelsPage(): JSX.Element {
  const mountedRef = useMountedRef();
  const [data, setData] = React.useState<ModelsData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    try {
      const next = await trpc.models.adminList.query();
      if (mountedRef.current) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(pageErrorMessage(err, '模型列表加载失败'));
    }
  }, [mountedRef]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const update = async (input: UpdateInput, success: string) => {
    setBusyId(input.id);
    setNotice(null);
    try {
      const res = await trpc.models.adminUpdate.mutate(input);
      if (!mountedRef.current) return;
      setData((prev) => (prev ? { ...prev, items: res.items } : prev));
      setNotice(`${success}，新任务立即生效。`);
      setEditing(null);
    } catch (err) {
      if (mountedRef.current) setNotice(pageErrorMessage(err, '保存失败'));
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  };

  const startEdit = (row: ModelRow) => {
    setEditing(row.id);
    setDraft(
      Object.fromEntries(Object.entries(row.laneModels).map(([k, v]) => [k, String(v ?? '')])),
    );
  };

  if (error) {
    return <div className="p-6 text-[13px] text-[#FF0061]">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 p-6 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-[20px] font-semibold text-foreground">模型管理</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          选择用户可以使用的大脑和默认模型。修改即时生效，无需改配置或重启。隐藏的模型仍可由管理员在输入框的“模型”菜单中使用。
        </p>
      </header>
      {notice ? (
        <div className="rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-[13px] text-foreground">
          {notice}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-[10px] border border-[#EFEFEF] bg-white">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="bg-[#FAFAFA] text-[12px] text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">模型</th>
              <th className="px-4 py-2.5 font-medium">供应商</th>
              <th className="px-4 py-2.5 font-medium">服务状态</th>
              <th className="px-4 py-2.5 font-medium">对用户可见</th>
              <th className="px-4 py-2.5 font-medium">默认</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="border-t border-[#EFEFEF]">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {row.label}
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {row.updatedAt ? `更新于 ${formatDateTime(row.updatedAt)}` : '初始配置'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {PROVIDER_LABEL[row.provider] ?? row.provider}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'text-[12px]',
                        row.configured ? 'text-[#1A7F37]' : 'text-[#B54708]',
                      )}
                    >
                      {row.configured ? '已配置' : '缺少 API 密钥'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.userVisible}
                      disabled={busyId === row.id || (row.isDefault && row.userVisible)}
                      onClick={() =>
                        void update(
                          { id: row.id, userVisible: !row.userVisible },
                          row.userVisible
                            ? `已对用户隐藏 ${row.label}`
                            : `已对用户开放 ${row.label}`,
                        )
                      }
                      className={cn(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50',
                        row.userVisible ? 'bg-[#FF0061]' : 'bg-[#DCDDDD]',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                          row.userVisible ? 'translate-x-4' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {row.isDefault ? (
                      <span className="rounded-[6px] bg-[#FF0061]/10 px-2 py-0.5 text-[12px] text-[#FF0061]">
                        默认
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === row.id || !row.configured}
                        onClick={() =>
                          void update({ id: row.id, isDefault: true }, `已把 ${row.label} 设为默认`)
                        }
                        className="rounded-[6px] border border-[#DCDDDD] px-2 py-0.5 text-[12px] hover:bg-[#EFEFEF] disabled:opacity-50"
                      >
                        设为默认
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => (editing === row.id ? setEditing(null) : startEdit(row))}
                      className="text-[12px] text-[#57479C] hover:underline"
                    >
                      {editing === row.id ? '收起' : '各通道模型'}
                    </button>
                    {busyId === row.id ? (
                      <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />
                    ) : null}
                  </td>
                </tr>
                {editing === row.id ? (
                  <tr className="border-t border-[#EFEFEF] bg-[#FAFAFA]">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {data.lanes.map((lane) => (
                          <label key={lane} className="flex items-center gap-2 text-[12px]">
                            <span className="w-24 shrink-0 text-muted-foreground">
                              {LANE_LABEL[lane] ?? lane}
                            </span>
                            <input
                              value={draft[lane] ?? ''}
                              onChange={(event) =>
                                setDraft((prev) => ({ ...prev, [lane]: event.target.value }))
                              }
                              className="min-w-0 flex-1 rounded-[6px] border border-[#DCDDDD] bg-white px-2 py-1 text-[12px]"
                              placeholder="使用默认"
                            />
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => {
                            const laneModels = Object.fromEntries(
                              Object.entries(draft)
                                .map(([k, v]) => [k, v.trim()] as const)
                                .filter(([, v]) => v.length > 0),
                            );
                            void update(
                              { id: row.id, laneModels } as UpdateInput,
                              `已更新 ${row.label} 的通道模型`,
                            );
                          }}
                          className="rounded-[6px] bg-[#FF0061] px-3 py-1 text-[12px] text-white disabled:opacity-50"
                        >
                          保存
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <McpServersSection />
    </div>
  );
}

type McpData = Awaited<ReturnType<typeof trpc.models.adminMcpList.query>>;

/** 百炼 MCP 服务 — attached to the Qwen 生成 / 搜索抓取 lanes; auth reuses the DashScope key. */
function McpServersSection(): JSX.Element {
  const mountedRef = useMountedRef();
  const [data, setData] = React.useState<McpData | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [url, setUrl] = React.useState('');

  React.useEffect(() => {
    trpc.models.adminMcpList
      .query()
      .then((next) => {
        if (mountedRef.current) setData(next);
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setMessage(pageErrorMessage(err, 'MCP 服务加载失败'));
      });
  }, [mountedRef]);

  const save = async (items: McpData['items'], success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await trpc.models.adminMcpUpdate.mutate({ items: [...items] });
      if (!mountedRef.current) return;
      setData(next);
      setMessage(`${success}，新任务立即生效。`);
      setLabel('');
      setUrl('');
    } catch (err) {
      if (mountedRef.current) setMessage(pageErrorMessage(err, '保存失败'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const full = data ? data.items.length >= data.max : true;
  const canAdd = !busy && !full && label.trim().length > 0 && url.trim().length > 0;

  return (
    <section className="space-y-3 rounded-[10px] border border-[#EFEFEF] bg-white p-4">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">百炼 MCP 服务</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          千问的“生成”和“搜索抓取”通道会带上这些 MCP 工具，鉴权沿用百炼 API 密钥。最多{' '}
          {data?.max ?? 10} 个，地址须为阿里云百炼的 https
          域名（dashscope.aliyuncs.com、dashscope-intl.aliyuncs.com 或
          *.maas.aliyuncs.com），否则会拒绝保存。
        </p>
      </div>
      {message ? <div className="text-[12px] text-foreground">{message}</div> : null}
      {!data ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
        </div>
      ) : (
        <>
          {data.items.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">暂未配置 MCP 服务。</div>
          ) : (
            <ul className="divide-y divide-[#EFEFEF] rounded-[8px] border border-[#EFEFEF]">
              {data.items.map((item) => (
                <li key={item.label} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                  <span className="w-32 shrink-0 font-medium text-foreground">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.url}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void save(
                        data.items.filter((other) => other.label !== item.label),
                        `已删除 ${item.label}`,
                      )
                    }
                    className="text-[#FF0061] hover:underline disabled:opacity-50"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="名称（字母、数字、- 或 _）"
              className="rounded-[6px] border border-[#DCDDDD] px-2 py-1 text-[12px] sm:w-48"
            />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://dashscope.aliyuncs.com/…/sse"
              className="min-w-0 flex-1 rounded-[6px] border border-[#DCDDDD] px-2 py-1 text-[12px]"
            />
            <button
              type="button"
              disabled={!canAdd}
              onClick={() =>
                void save(
                  [...data.items, { label: label.trim(), url: url.trim() }],
                  `已添加 ${label.trim()}`,
                )
              }
              className="rounded-[6px] bg-[#FF0061] px-3 py-1 text-[12px] text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
              ) : full ? (
                '已达上限'
              ) : (
                '添加'
              )}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
