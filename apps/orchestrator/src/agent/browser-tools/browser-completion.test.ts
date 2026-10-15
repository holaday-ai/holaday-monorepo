import { describe, expect, it } from 'vitest';
import { completionGap, detectBrowserBlocker } from './browser-completion.js';

describe('browser completion host evidence', () => {
  it('detects YouTube bot confirmation and Google traffic walls', () => {
    for (const text of [
      'Sign in to confirm you’re not a bot',
      'Our systems have detected unusual traffic',
      'reCAPTCHA',
    ])
      expect(detectBrowserBlocker({ url: 'https://example.com', title: '', text })?.reason).toBe(
        'captcha',
      );
    expect(
      detectBrowserBlocker({ url: 'https://example.com/login', title: 'Sign in', text: 'Password' })
        ?.reason,
    ).toBe('login');
    expect(
      detectBrowserBlocker({
        url: 'https://example.com/article',
        title: 'News',
        text: 'Log in to comment',
      }),
    ).toBeNull();
  });
  it('rejects a fabricated zero step answer and asks for navigation', () => {
    expect(completionGap('打开浏览器查询天气', '天气晴朗', [], true)).toContain('navigate');
  });
  it('rejects claimed tab switches and downloads without successful receipts', () => {
    const trace = [{ tool: 'navigate', ok: true, url: 'https://example.com' }];
    expect(completionGap('打开网页', '已切回原标签', trace, true)).toContain('switch_tab');
    expect(completionGap('下载文件', '已下载，读到13字节', trace, true)).toContain('下载');
    expect(completionGap('打开网页', '通过 read_url 读取内容', trace, true)).toContain('read_url');
  });
  it('does not turn one tab or scroll receipt into a claim of three or five', () => {
    const trace = [
      { tool: 'navigate', ok: true, url: 'https://example.com', tabId: 'first' },
      { tool: 'new_tab', ok: true, tabId: 'second' },
    ];
    expect(completionGap('打开三个标签', '已打开了三个新标签', trace, true)).toContain('数量');
    expect(completionGap('滚动五次', '已滚动五次', trace, true)).toContain('增长');
    expect(
      completionGap(
        '切回原标签',
        '已切回原标签',
        [...trace, { tool: 'switch_tab', ok: true, tabId: 'second' }],
        true,
      ),
    ).toContain('原标签');
  });
  it('accepts actual file bytes only when backed by a stored receipt', () => {
    const trace = [
      { tool: 'navigate', ok: true, url: 'https://example.com' },
      {
        tool: 'download',
        ok: true,
        download: {
          fileId: 'f1',
          sizeBytes: 15,
          sha256: 'a'.repeat(64),
          filename: 'file.txt',
          downloadUrl: '/api/files/f1/download',
        },
      },
    ];
    expect(completionGap('下载文件', '已下载15字节', trace, true)).toBeNull();
    expect(completionGap('下载文件', '已下载13字节', trace, true)).toContain('字节');
  });
});

it('does not turn a negative action statement into a required or claimed action', () => {
  const trace = [{ tool: 'navigate', ok: true, url: 'https://example.com' }];
  for (const [intent, summary] of [
    ['读取视频元数据，不要下载或播放视频', '已读取标题，未下载视频，未切回原标签。'],
    ['Read the title; do not download the video.', "Read title. Didn't download anything."],
    ['只读取标题，无需下载', '读取标题；没有新建标签；未滚动。'],
  ])
    expect(completionGap(intent!, summary!, trace, true)).toBeNull();
  expect(completionGap('下载文件', '未下载文件', trace, true)).toContain('下载');
  expect(completionGap('不要下载，只读标题', 'Download guide', trace, true)).toBeNull();
});

describe('download receipts follow the requested task, not result titles', () => {
  const trace = [{ tool: 'navigate', ok: true, url: 'https://www.bing.com/search?q=HOLA+DAY+AI' }];
  it.each([
    [
      'Google 搜索「HOLA DAY AI」返回前5条标题和链接',
      '1. [Hola VPN for Windows & Mac - Download the Hola Desktop App](https://hola.org/products/desktop)',
    ],
    ['搜索 Python 返回标题', 'Python 下载与安装指南'],
    ['Read the first five search results; do not download files.', 'Download the Hola Desktop App'],
  ])(
    'allows a literal result title without inventing a download receipt: %s',
    (intent, summary) => {
      expect(completionGap(intent, summary, trace, true)).toBeNull();
    },
  );
  it.each(['下载文件', '请下载报告并保存文件', 'Download the report and save it'])(
    'still requires a successful receipt for a download task: %s',
    (intent) => {
      expect(completionGap(intent, '任务完成', trace, true)).toContain('下载');
    },
  );
  it('does not accept a failed download attempt as a receipt', () => {
    expect(
      completionGap('下载文件', '任务完成', [...trace, { tool: 'download', ok: false }], true),
    ).toContain('下载');
  });
});
