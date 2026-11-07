/**
 * BROWSER-AUTOPILOT-3 — the article's own section list, deterministically.
 *
 * "第3节" means the third section of the article body. Counting every visible
 * H2 on the page also counts the table of contents ("目录" / "Contents" is an
 * H2 in Wikipedia's Vector 2022 skin), navigation and sidebars, which made
 * "section 3" the second body section (Deploy-21 core-06). The outline is taken
 * only from the main content region: `#mw-content-text` on MediaWiki, otherwise
 * the article/main region holding the most headings. Headings inside
 * navigation, sidebars, tables of contents and appendix sections (参考文献 /
 * References …) are not sections.
 *
 * `collectArticleOutline` runs inside the page (self-contained, no closures);
 * use the expression builders below, which neutralise tsx/esbuild `__name`.
 */
export interface OutlineEntry {
  /** "3" for a top-level section, "3.2" for its second subsection. */
  index: string;
  level: number;
  title: string;
  /** `#id` of the heading when the page gives one. */
  anchor: string;
}
export interface ArticleOutline {
  /** Which region the outline was read from. */
  scope: string;
  sections: OutlineEntry[];
  /** Appendix headings left out of the numbering. */
  excluded: string[];
}
export interface OutlineSectionText {
  title: string;
  anchor: string;
  text: string;
}

const collectArticleOutline = (arg: { mode: 'outline' | 'section'; section?: number }) => {
  const EXCLUDED_CONTAINERS =
    '.mw-editsection,nav,aside,header,footer,[role=navigation],[role=complementary],[role=banner],[role=contentinfo],#toc,.toc,.vector-toc,#vector-toc,.navbox,.vertical-navbox,.sidebar,.infobox,.catlinks,.printfooter,.mw-references-wrap,.reflist,[hidden],[aria-hidden=true]';
  const APPENDIX =
    /^(参考文献|参考资料|參考資料|参考来源|參考來源|参考|參考|注释|註釋|注解|脚注|腳註|外部链接|外部連結|外部链接与延伸阅读|延伸阅读|延伸閱讀|扩展阅读|擴展閱讀|参见|參見|参看|參看|相关条目|相關條目|相关链接|相關連結|来源|來源|引用|References|Notes|Footnotes|Citations|Sources|Bibliography|Further reading|External links|See also|Works cited|Notes and references)$/i;
  const visible = (el: Element) => el.getClientRects().length > 0;
  const clean = (value: string | null) =>
    (value ?? '')
      .replace(/\[(?:编辑|編輯|edit|编辑源代码)\]/gi, '')
      .replace(/[¶§#]+\s*$/u, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  const countable = (root: Element) =>
    Array.from(root.querySelectorAll('h2,h3')).filter(
      (h) => visible(h) && !h.closest(EXCLUDED_CONTAINERS) && !APPENDIX.test(clean(h.textContent)),
    );
  let root: Element = document.body;
  let scope = 'body';
  const wiki = document.querySelector('#mw-content-text');
  if (wiki) {
    root = wiki;
    scope = '#mw-content-text';
  } else {
    let best = 0;
    for (const selector of [
      '[itemprop=articleBody]',
      'article',
      'main',
      '[role=main]',
      '#content',
      '#main-content',
      '#main',
      '.post-content',
      '.entry-content',
      '.article-body',
      '.article-content',
    ]) {
      for (const candidate of Array.from(document.querySelectorAll(selector))) {
        if (!visible(candidate)) continue;
        const count = countable(candidate).length;
        // More headings wins; the same headings in a narrower region win too.
        if (count > best || (count === best && count > 0 && root.contains(candidate))) {
          best = count;
          root = candidate;
          scope = selector;
        }
      }
    }
  }
  const excluded: string[] = [];
  const headings = Array.from(root.querySelectorAll('h2,h3')).filter((h) => {
    if (!visible(h) || h.closest(EXCLUDED_CONTAINERS)) return false;
    if (APPENDIX.test(clean(h.textContent))) {
      excluded.push(clean(h.textContent));
      return false;
    }
    return true;
  });
  const top = headings.some((h) => h.tagName === 'H2') ? 'H2' : 'H3';
  const anchorOf = (h: Element) => {
    const id =
      h.id ||
      (h.parentElement?.classList.contains('mw-heading') ? h.parentElement.id : '') ||
      h.querySelector('[id]')?.id ||
      '';
    return id ? `#${id}` : '';
  };
  const entries: Array<{ el: Element; index: string; level: number; title: string }> = [];
  let major = 0;
  let minor = 0;
  for (const h of headings) {
    const title = clean(h.textContent);
    if (!title) continue;
    if (h.tagName === top) {
      major += 1;
      minor = 0;
      entries.push({ el: h, index: String(major), level: Number(h.tagName[1]), title });
    } else if (major > 0) {
      minor += 1;
      entries.push({ el: h, index: `${major}.${minor}`, level: 3, title });
    }
  }
  if (arg.mode === 'outline')
    return {
      scope,
      sections: entries.slice(0, 160).map((entry) => ({
        index: entry.index,
        level: entry.level,
        title: entry.title,
        anchor: anchorOf(entry.el),
      })),
      excluded: excluded.slice(0, 20),
    };
  const tops = entries.filter((entry) => !entry.index.includes('.'));
  const target = tops[(arg.section ?? 0) - 1];
  if (!target) throw new Error('Requested section is not present in this document');
  const box = (el: Element) => el.closest('.mw-heading') ?? el;
  const next = tops[arg.section ?? 0];
  const range = document.createRange();
  range.setStartBefore(box(target.el));
  if (next) range.setEndBefore(box(next.el));
  else range.setEnd(root, root.childNodes.length);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (
      parent?.getClientRects().length &&
      !parent.closest('script,style') &&
      !parent.closest(EXCLUDED_CONTAINERS) &&
      range.intersectsNode(walker.currentNode)
    )
      parts.push(walker.currentNode.textContent ?? '');
  }
  return {
    title: target.title,
    anchor: anchorOf(target.el),
    text: parts.join(' ').replace(/\s+/g, ' ').trim(),
  };
};

const expression = (arg: { mode: 'outline' | 'section'; section?: number }) =>
  `(() => { const __name = (target) => target; return (${collectArticleOutline.toString()})(${JSON.stringify(arg)}); })()`;
/** In-page expression returning the body {@link ArticleOutline}. */
export const ARTICLE_OUTLINE_EXPRESSION = expression({ mode: 'outline' });
/** In-page expression returning {@link OutlineSectionText} of top-level section `n`. */
export const articleSectionExpression = (n: number) => expression({ mode: 'section', section: n });
