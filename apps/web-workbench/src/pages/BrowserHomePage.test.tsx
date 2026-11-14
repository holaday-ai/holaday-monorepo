// @vitest-environment happy-dom
import { BrowserHomeView } from '@/components/browser-home/BrowserHomeView';
import { ToastProvider } from '@/components/ui/toast';
import type { BrowserHomeSite } from '@/lib/browser-home';
import { setStoreNavigate, useTaskStore } from '@/stores/task-store';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserHomePage } from './BrowserHomePage';

const api = vi.hoisted(() => ({
  open: vi.fn(),
  nav: vi.fn(),
  close: vi.fn(),
  create: vi.fn(),
  reply: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    browserHome: {
      open: { mutate: api.open },
      nav: { mutate: api.nav },
      close: { mutate: api.close },
    },
    tasks: {
      create: { mutate: api.create },
      reply: { mutate: api.reply },
    },
    skills: { list: { query: async () => [] } },
    models: { list: { query: async () => ({ items: [] }) } },
  },
}));

vi.mock('@/lib/use-stream-token', () => ({
  useStreamToken: (enabled: boolean) => ({
    token: enabled ? 'stream-token' : null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/CdpScreencastViewport', () => ({
  CdpScreencastViewport: ({ wsUrl }: { wsUrl: string | null }) => (
    <div data-testid="screen" data-ws-url={wsUrl ?? ''} />
  ),
}));

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 404 })),
  );
  api.open.mockResolvedValue({ sessionId: 'bhs_usr_1', url: null });
  api.nav.mockResolvedValue({ ok: true, url: 'https://example.com/' });
  api.close.mockResolvedValue({ released: true });
  api.create.mockResolvedValue({ taskId: 'tsk_home_1', status: 'executing', steps: [] });
  api.reply.mockResolvedValue({ ok: true, state: 'stillAwaiting' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  useTaskStore.setState({
    tasks: [],
    selectedTaskId: null,
    localChromeSelection: null,
    browserPreference: null,
    awaitingUserByTask: {},
    subStatusByTask: {},
  });
});

function LeaveButton(): JSX.Element {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/elsewhere')}>
      离开
    </button>
  );
}

function mount(region: 'cn' | 'intl' | null = 'cn') {
  render(
    <MemoryRouter initialEntries={['/browser']}>
      <ToastProvider>
        <LeaveButton />
        <Routes>
          <Route path="/browser" element={<BrowserHomePage region={region} plan="pro" />} />
          <Route path="/elsewhere" element={<p>别的页面</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const addressBar = () =>
  screen.getByRole('textbox', { name: /云浏览器地址栏/ }) as HTMLInputElement;

describe('BROWSER-HOME-1 BrowserHomePage', () => {
  it('opens the cloud browser on mount and shows the HOLA DAY home meanwhile', async () => {
    mount();
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(addressBar().value).toBe('HOLA DAY 主页');
    expect(screen.getByRole('heading', { name: /云浏览器/ })).toBeTruthy();
    expect(screen.queryByTestId('screen')).toBeNull();
  });

  it('address bar input → browserHome.nav goto, then the live screen of bhs_<userId>', async () => {
    const user = mount();
    await waitFor(() => expect(api.open).toHaveBeenCalled());
    await user.click(addressBar());
    expect(addressBar().value).toBe('');
    await user.type(addressBar(), 'example.com{Enter}');
    await waitFor(() =>
      expect(api.nav).toHaveBeenCalledWith({ direction: 'goto', input: 'example.com' }),
    );
    const screenEl = await screen.findByTestId('screen');
    expect(screenEl.getAttribute('data-ws-url')).toMatch(/\/screencast-ws\/bhs_usr_1$/);
    await waitFor(() => expect(addressBar().value).toBe('https://example.com/'));
  });

  it('shows the server’s Chinese refusal and stays on the home view', async () => {
    api.nav.mockResolvedValueOnce({
      ok: false,
      reason: 'blocked_target',
      message: '不能打开本机或内网地址。',
    });
    const user = mount();
    await user.click(addressBar());
    await user.type(addressBar(), 'file:///etc/passwd{Enter}');
    expect(await screen.findByText('不能打开本机或内网地址。')).toBeTruthy();
    expect(screen.queryByTestId('screen')).toBeNull();
  });

  it('back from the first page returns to the home view', async () => {
    const user = mount();
    await user.click(addressBar());
    await user.type(addressBar(), 'example.com{Enter}');
    await screen.findByTestId('screen');
    api.nav.mockResolvedValueOnce({ ok: false, reason: 'no_history' });
    await user.click(screen.getByRole('button', { name: '后退' }));
    await waitFor(() => expect(screen.queryByTestId('screen')).toBeNull());
    expect(addressBar().value).toBe('HOLA DAY 主页');
  });

  it('an already open browser goes on showing its page', async () => {
    api.open.mockResolvedValueOnce({ sessionId: 'bhs_usr_1', url: 'https://news.example/' });
    mount();
    expect(await screen.findByTestId('screen')).toBeTruthy();
    expect(addressBar().value).toBe('https://news.example/');
  });

  it('leaving the route releases the cloud browser', async () => {
    const user = mount();
    await waitFor(() => expect(api.open).toHaveBeenCalled());
    expect(api.close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '离开' }));
    expect(screen.getByText('别的页面')).toBeTruthy();
    await waitFor(() => expect(api.close).toHaveBeenCalledTimes(1));
  });
});

describe('BROWSER-HOME-1 home view', () => {
  const placeholders: BrowserHomeSite[] = Array.from({ length: 8 }, (_, i) => ({
    name: '待添加',
    url: '',
    logo: null,
    regions: ['cn', 'intl'],
    order: i,
    placeholder: true,
  }));
  const site: BrowserHomeSite = {
    name: '示例',
    url: 'https://example.com/',
    logo: '/browser-home/logos/example.png',
    regions: ['cn'],
    order: 0,
    placeholder: false,
  };

  function view(props: {
    region: 'cn' | 'intl' | null;
    production?: boolean;
    sites?: BrowserHomeSite[];
  }) {
    const onOpen = vi.fn(async () => true);
    const loadSites = async () => props.sites ?? placeholders;
    render(
      <BrowserHomeView
        region={props.region}
        onOpen={onOpen}
        recentTasks={[]}
        onOpenTask={vi.fn()}
        production={props.production ?? false}
        loadSites={loadSites}
      />,
    );
    return { user: userEvent.setup(), onOpen };
  }

  it('defaults to Google for the overseas entry and 百度 for the domestic one; switchable', async () => {
    const intl = view({ region: 'intl' });
    expect(screen.getByRole('button', { name: 'Google' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await intl.user.type(screen.getByRole('searchbox'), '天气{Enter}');
    expect(intl.onOpen).toHaveBeenCalledWith('https://www.google.com/search?q=%E5%A4%A9%E6%B0%94');
    cleanup();

    const cn = view({ region: 'cn' });
    expect(screen.getByRole('button', { name: '百度' }).getAttribute('aria-pressed')).toBe('true');
    await cn.user.click(screen.getByRole('button', { name: 'Google' }));
    await cn.user.type(screen.getByRole('searchbox'), 'news{Enter}');
    expect(cn.onOpen).toHaveBeenCalledWith('https://www.google.com/search?q=news');
  });

  it('shows 8 placeholder tiles in development and none in a production build', async () => {
    view({ region: 'cn' });
    const section = await screen.findByRole('region', { name: '推荐网站' });
    expect(section.querySelectorAll('[data-placeholder="true"]')).toHaveLength(8);
    expect(within(section).getAllByText('待添加')).toHaveLength(8);
    cleanup();

    view({ region: 'cn', production: true });
    await waitFor(() => expect(screen.queryByRole('region', { name: '推荐网站' })).toBeNull());
    expect(screen.queryByText('待添加')).toBeNull();
  });

  it('opens a recommended site and keeps my shortcuts apart (add / remove)', async () => {
    const { user, onOpen } = view({ region: 'cn', sites: [site] });
    await user.click(await screen.findByRole('button', { name: '示例' }));
    expect(onOpen).toHaveBeenCalledWith('https://example.com/');

    const mine = screen.getByRole('region', { name: '我的快捷方式' });
    await user.click(within(mine).getByRole('button', { name: '添加' }));
    await user.type(screen.getByRole('textbox', { name: '快捷方式名称' }), '我的站');
    await user.type(screen.getByRole('textbox', { name: '快捷方式网址' }), 'mine.example');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await user.click(within(mine).getByRole('button', { name: '我的站' }));
    expect(onOpen).toHaveBeenLastCalledWith('https://mine.example/');
    expect(window.localStorage.getItem('holaday.browserHome.shortcuts')).toContain('mine.example');
    await user.click(within(mine).getByRole('button', { name: '移除我的站' }));
    expect(within(mine).queryByRole('button', { name: '我的站' })).toBeNull();
  });
});

describe('BROWSER-HOME-1 step 4: a task from the floating input runs in this browser', () => {
  const composer = () => {
    const box = document.querySelector('textarea');
    if (!box) throw new Error('no composer');
    return box;
  };
  const card = () => screen.getByRole('region', { name: '云浏览器任务' });
  const patchTask = (patch: Record<string, unknown>) =>
    useTaskStore.setState((prev) => ({
      tasks: prev.tasks.map((t) => (t.taskId === 'tsk_home_1' ? { ...t, ...patch } : t)),
    }));

  it('sends browserHomeSession, keeps the same screen, shows progress then the result in place', async () => {
    // A Chrome selection or a public-cloud preference elsewhere never rides along.
    useTaskStore.setState({ browserPreference: 'cloud-public' } as never);
    // The shell's "pin the URL to the new task" is not used: the page stays /browser.
    const pinUrl = vi.fn();
    setStoreNavigate(pinUrl);
    const user = mount();
    await waitFor(() => expect(api.open).toHaveBeenCalled());
    await user.type(composer(), '把这个页面的标题和价格整理一下');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const sent = api.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      intent: '把这个页面的标题和价格整理一下',
      browserHomeSession: true,
    });
    expect(sent).not.toHaveProperty('localChrome');
    expect(sent).not.toHaveProperty('browserPreference');
    expect(sent).not.toHaveProperty('replyToTaskId');

    // The screen of this page's browser — the stream route stays bhs_<userId> throughout.
    const screenEl = await screen.findByTestId('screen');
    expect(screenEl.getAttribute('data-ws-url')).toMatch(/\/screencast-ws\/bhs_usr_1$/);
    expect(within(card()).getByText('执行中')).toBeTruthy();
    expect(screen.queryByText('别的页面')).toBeNull();
    expect(pinUrl).not.toHaveBeenCalled();
    setStoreNavigate(null);

    patchTask({ status: 'completed', resultText: '标题：Item 1\n价格：¥99' });
    await waitFor(() => expect(within(card()).getByText('已完成')).toBeTruthy());
    expect(within(card()).getByTestId('browser-home-task-body').textContent).toContain('¥99');
    expect(screen.getByTestId('screen').getAttribute('data-ws-url')).toMatch(
      /\/screencast-ws\/bhs_usr_1$/,
    );

    // Collapsible, and dismissible once ended.
    await user.click(within(card()).getByRole('button', { name: '收起任务卡片' }));
    expect(within(card()).queryByTestId('browser-home-task-body')).toBeNull();
    await user.click(within(card()).getByRole('button', { name: '关闭任务卡片' }));
    expect(screen.queryByRole('region', { name: '云浏览器任务' })).toBeNull();
    expect(screen.queryByText('别的页面')).toBeNull();
  });

  it('a failure shows its reason in the card; a server refusal is a toast and keeps the draft', async () => {
    api.create.mockRejectedValueOnce(
      Object.assign(new Error('云浏览器里已有一个任务在执行，请等它结束后再发送。'), {
        data: { code: 'PRECONDITION_FAILED' },
      }),
    );
    const user = mount();
    await waitFor(() => expect(api.open).toHaveBeenCalled());
    await user.type(composer(), '再整理一次');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText(/已有一个任务在执行/)).toBeTruthy();
    expect((composer() as HTMLTextAreaElement).value).toBe('再整理一次');
    expect(screen.queryByRole('region', { name: '云浏览器任务' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(card()).toBeTruthy());
    patchTask({ status: 'failed', resultText: '页面打不开' });
    await waitFor(() => expect(within(card()).getByText('失败')).toBeTruthy());
    expect(within(card()).getByTestId('browser-home-task-body').textContent).toBeTruthy();
  });

  it('when the assistant asks, the floating input answers that task instead of starting another', async () => {
    const user = mount();
    await waitFor(() => expect(api.open).toHaveBeenCalled());
    await user.type(composer(), '帮我登录后看订单');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(card()).toBeTruthy());
    useTaskStore.setState((prev) => ({
      tasks: prev.tasks.map((t) =>
        t.taskId === 'tsk_home_1' ? { ...t, status: 'awaiting_user' as const } : t,
      ),
      awaitingUserByTask: { tsk_home_1: { question: '请先在画面里登录', at: Date.now() } },
    }));
    expect(await within(card()).findByText('请先在画面里登录')).toBeTruthy();
    await user.type(composer(), '登录好了');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() =>
      expect(api.reply).toHaveBeenCalledWith({ taskId: 'tsk_home_1', message: '登录好了' }),
    );
    expect(api.create).toHaveBeenCalledTimes(1);
  });
});
