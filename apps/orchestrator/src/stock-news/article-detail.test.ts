import { describe, expect, it, vi } from 'vitest';
import {
  htmlArticleParagraphs,
  resolveNewsDetail,
  validateArticleSourceUrl,
} from './article-detail.js';

describe('stock news article detail', () => {
  it('rejects non-public or unsupported article URLs before fetching', () => {
    expect(() => validateArticleSourceUrl('http://127.0.0.1/private')).toThrow(/https/i);
    expect(() => validateArticleSourceUrl('https://example.com/article')).toThrow(/已验证公开来源/);
    expect(() => validateArticleSourceUrl('file:///tmp/article')).toThrow(/https/i);
  });

  it('accepts trusted feed sources without allowing arbitrary public URLs', () => {
    expect(validateArticleSourceUrl('https://www.cls.cn/detail/123')).toMatchObject({ hostname: 'www.cls.cn' });
    expect(() => validateArticleSourceUrl('https://attacker.example/article')).toThrow(/已验证公开来源/);
  });

  it('upgrades a legacy HTTP URL from an allowed source before it is fetched', () => {
    expect(validateArticleSourceUrl('http://finance.eastmoney.com/a/202608083835838437.html')).toMatchObject({
      protocol: 'https:',
      hostname: 'finance.eastmoney.com',
    });
  });

  it('uses structured article bodies when a source does not expose paragraph tags', () => {
    expect(htmlArticleParagraphs(`
      <html><head><script type="application/ld+json">
        {"@context":"https://schema.org","@type":"NewsArticle","articleBody":"第一段来自公开来源的结构化正文，足以作为站内阅读内容，而不是模型补写。\\n\\n第二段继续说明事件的背景和公开事实，用户可以在当前弹窗内阅读。"}
      </script></head><body><div>页面壳</div></body></html>
    `)).toEqual([
      '第一段来自公开来源的结构化正文，足以作为站内阅读内容，而不是模型补写。',
      '第二段继续说明事件的背景和公开事实，用户可以在当前弹窗内阅读。',
    ]);
  });

  it('uses the upstream source summary when a supported source body cannot be read', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('upstream unavailable');
    }) as unknown as typeof fetch;

    await expect(resolveNewsDetail({
      url: 'https://finance.eastmoney.com/a/202608080000000001.html',
      sourceName: '东方财富',
      publishedAt: '2026-08-08T10:00:00.000Z',
      summary: '这是来源返回的摘要。',
    }, { fetchImpl })).resolves.toMatchObject({
      contentStatus: 'source-summary',
      summary: '这是来源返回的摘要。',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not follow a verified source redirect to another host', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/not-an-article' },
    })) as unknown as typeof fetch;

    await expect(resolveNewsDetail({
      url: 'https://finance.eastmoney.com/a/202608080000000003.html',
      sourceName: '东方财富',
      publishedAt: '2026-08-08T10:00:00.000Z',
      summary: '来源摘要。',
    }, { fetchImpl })).resolves.toMatchObject({
      contentStatus: 'source-summary',
      summary: '来源摘要。',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns cleaned body paragraphs only from a supported fetched source', async () => {
    const detail = await resolveNewsDetail({
      url: 'https://finance.eastmoney.com/a/202608080000000002.html',
      sourceName: '东方财富',
      publishedAt: '2026-08-08T10:00:00.000Z',
      summary: '来源摘要。',
    }, {
      fetchImpl: async () => new Response(`
        <html><body><article>
          <p>这是一段足够长、可验证的公开来源正文，用于验证详情页不会把导航文字当成新闻内容。</p>
          <p>第二段同样来自原始页面，保留为用户可追溯的阅读内容，不由模型补写。</p>
        </article><script>window.bad = true;</script></body></html>
      `, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      now: () => new Date('2026-08-08T10:05:00.000Z'),
    });

    expect(detail).toMatchObject({
      contentStatus: 'source-body',
      summary: '来源摘要。',
      body: [
        '这是一段足够长、可验证的公开来源正文，用于验证详情页不会把导航文字当成新闻内容。',
        '第二段同样来自原始页面，保留为用户可追溯的阅读内容，不由模型补写。',
      ],
      extractedAt: '2026-08-08T10:05:00.000Z',
    });
  });
});
