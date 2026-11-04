import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFirecrawlLane } from './firecrawl-lane.js';
import { xhsCountsLine, xhsNoteCounts, xhsNoteId } from './xhs-counts.js';

/**
 * FIX-54 #2 (Deploy-54 xhs-read): the online answer said the like count could not be read,
 * because the markdown ran the engage bar together as 「15681,80024」. The fixture is the
 * Firecrawl rawHtml of the same note (2026-11-04), trimmed.
 */
const NOTE = '6929ba55000000001e023ef8';
const URL_ = `https://www.xiaohongshu.com/explore/${NOTE}`;
const RAW = readFileSync(new URL('./__fixtures__/xhs-note-6929ba55.html', import.meta.url), 'utf8');
// The markdown lines as Firecrawl gave them, online and locally.
const MARKDOWN = 'Edited at Jan 1\n\n24 comments\n\nLog in to comment\n\n15681,80024\n\nAppealGot it';

describe('FIX-54 #2 · xhs-read: the note counts are read by field, not from the glued line', () => {
  it('finds the note id on note pages only', () => {
    expect(xhsNoteId(URL_)).toBe(NOTE);
    expect(xhsNoteId(`https://www.rednote.com/discovery/item/${NOTE}?xsec_token=x`)).toBe(NOTE);
    expect(xhsNoteId('https://www.xiaohongshu.com/explore')).toBeNull();
    expect(xhsNoteId(`https://www.example.com/explore/${NOTE}`)).toBeNull();
  });

  it('reads likes 1,568, collects 1,800, comments 24 from the real page state', () => {
    // The engage bar in the same page shows 1568 / 1,800 / 24 — the same counts.
    expect(RAW).toContain('class="count" selected-disabled-search="">1568<');
    expect(RAW).toContain('class="count">1,800<');
    expect(xhsNoteCounts(RAW, NOTE)).toEqual({
      liked: '1,568',
      collected: '1,800',
      comments: '24',
      shares: '574',
    });
    expect(xhsCountsLine(xhsNoteCounts(RAW, NOTE)!)).toBe(
      '笔记互动数（页面数据逐项读取，非正文拼接）：点赞 1,568｜收藏 1,800｜评论 24｜分享 574',
    );
  });

  it('does not guess: another note, no state, or a value that is not a count gives nothing', () => {
    expect(xhsNoteCounts(RAW, '0000000000000000000000ff')).toBeNull();
    expect(xhsNoteCounts(MARKDOWN, NOTE)).toBeNull();
    const bad = RAW.replace('"likedCount":"1,568"', '"likedCount":"赞"');
    expect(xhsNoteCounts(bad, NOTE)?.liked).toBeUndefined();
  });

  it("does not take another note's counts in the same map", () => {
    const other = '1111111111111111111111aa';
    const two = RAW.replace(
      `"noteDetailMap":{"${NOTE}":`,
      `"noteDetailMap":{"${other}":{"note":{"interactInfo":{"likedCount":"9"}}},"${NOTE}":`,
    );
    expect(xhsNoteCounts(two, NOTE)?.liked).toBe('1,568');
    expect(xhsNoteCounts(two, other)?.liked).toBe('9');
  });

  it('the scrape asks for rawHtml on a note page and puts the counts line first', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            markdown: MARKDOWN,
            ...(body.formats.includes('rawHtml') ? { rawHtml: RAW } : {}),
            metadata: { sourceURL: body.url, creditsUsed: 1 },
          },
        }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;
    const lane = createFirecrawlLane({ apiKey: 'fc-test', baseUrl: 'https://fc.test', fetch });
    const note = await lane.scrape(URL_);
    expect(bodies[0]!.formats).toEqual(['markdown', 'rawHtml']);
    expect(note.ok && note.markdown.split('\n')[0]).toBe(
      '笔记互动数（页面数据逐项读取，非正文拼接）：点赞 1,568｜收藏 1,800｜评论 24｜分享 574',
    );
    expect(note.ok && 'rawHtml' in note).toBe(false);
    const other = await lane.scrape('https://example.com/a');
    expect(bodies[1]!.formats).toEqual(['markdown']);
    expect(other.ok && other.markdown).toBe(MARKDOWN);
  });
});
