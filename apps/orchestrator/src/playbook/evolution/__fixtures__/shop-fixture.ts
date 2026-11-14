import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local static-page fixture for the self-evolution tests: a tiny shop with a
 * search form, a results page and a detail page. `variant = 'v2'` simulates a
 * site redesign (the search button is renamed 搜索 → 查找) so the replay's
 * local model repair path can be exercised. Bound to 127.0.0.1 only.
 */

export interface ShopFixture {
  baseUrl: string;
  variant: 'v1' | 'v2';
  close(): Promise<void>;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}</body></html>`;
}

export async function startShopFixture(): Promise<ShopFixture> {
  const state: { variant: 'v1' | 'v2' } = { variant: 'v1' };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let html: string;
    if (url.pathname === '/') {
      const button = state.variant === 'v1' ? '搜索' : '查找';
      html = page(
        '测试商城',
        `<h1>测试商城</h1>
         <form action="/search" method="get">
           <label for="q">搜索商品</label>
           <input id="q" name="q" type="search" autocomplete="off">
           <button type="submit">${button}</button>
         </form>
         <a href="/login">登录</a>`,
      );
    } else if (url.pathname === '/search') {
      const q = url.searchParams.get('q') ?? '';
      html = page(
        `搜索 ${q}`,
        `<h1>搜索结果：${esc(q)}</h1>
         <ul>
           <li><a href="/item?name=${encodeURIComponent(q)}">${esc(q)} 详情</a></li>
           <li><a href="/item?name=other">其他商品 详情</a></li>
         </ul>`,
      );
    } else if (url.pathname === '/item') {
      const name = url.searchParams.get('name') ?? '';
      html = page('商品详情', `<h1>商品详情</h1><p>${esc(name)}</p>`);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    get variant() {
      return state.variant;
    },
    set variant(v: 'v1' | 'v2') {
      state.variant = v;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
