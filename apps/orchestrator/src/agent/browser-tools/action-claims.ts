/**
 * FIX-27 (wa core-08): an answer said 「登录/认证类页面（Form Authentication
 * /login…）按规则不予打开」 while the run had opened /login — it denied its own
 * action. And it left out that it had filled the httpbin form. These checks
 * compare such statements with what the run did.
 */
export interface RunActions {
  /** Landing URLs of successful navigations, clicks and opened tabs. */
  visitedUrls: string[];
  /** The run landed on a login page (a login wall was detected). */
  loginPageVisited: boolean;
  /** A business form field was filled (search boxes excluded). */
  filled: boolean;
  /** Text the run's own `type` actions entered. */
  typedTexts: string[];
}

/** "未打开 / 没有访问 / 不予打开 / 未填写 …": the run did not do it. */
const DENIAL =
  /(?:未|没有|没|并未|从未|不曾|未曾|不予|不会|不去|不再)\s*(?:实际|再|去|曾)?\s*(?:进行\s*(?:表单)?\s*)?(打开|访问|进入|点击|点开|浏览|填写|填入|填表)/;

/** Search engines: the API-first interceptor serves their URLs without opening them. */
const SEARCH_ENGINE =
  /(?:^|\.)(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|baidu\.com|search-results\.holaday\.invalid)$/;

const pathOf = (raw: string) => {
  try {
    const url = new URL(raw);
    return {
      host: url.hostname.replace(/^www\./, '').toLowerCase(),
      path: url.pathname.toLowerCase(),
    };
  } catch {
    return null;
  }
};

/** Statements in `answer` that deny an action the run took; empty when none. */
export function deniedActions(answer: string, run: RunActions): string[] {
  const visited = run.visitedUrls.map(pathOf).filter((v): v is NonNullable<typeof v> => !!v);
  const out: string[] = [];
  // A clause (comma-separated) is the scope of a denial: "未打开 Google 结果页，而是
  // 读取了接口结果页" denies only the first part.
  for (const sentence of answer.split(/[。；;\n，,]/)) {
    const denial = sentence.match(DENIAL);
    if (!denial) continue;
    const said = sentence.trim().slice(0, 120);
    if (denial[1] === '填写' || denial[1] === '填入' || denial[1] === '填表') {
      // "未填写日期控件" is true without a date fill; a denied form fill is not.
      if (run.filled && /表单|填表|任何字段|字段|form/i.test(sentence) && !/日期/.test(sentence))
        out.push(`答案说「${said}」，但本次实际填写过表单`);
      continue;
    }
    // The object denied: after the verb ("未打开 X"), or — when the verb ends the
    // clause — before it ("X 按规则不予打开"). "已读取…（未点击播放按钮）" denies the
    // button, not the page named earlier.
    const after = sentence.slice(denial.index! + denial[0].length);
    const scope = /[\p{L}\p{N}/]/u.test(after) ? after : sentence.slice(0, denial.index);
    const hosts = [...scope.matchAll(/((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[a-z0-9_\-/.]*)?/gi)];
    const paths = [
      ...scope.matchAll(/(?:^|[\s（(、,，:："'「])(\/[a-z][a-z0-9_\-]*(?:\/[a-z0-9_\-]+)*)/gi),
    ].map((m) => m[1]!.toLowerCase());
    const hit =
      hosts.some(([, rawHost, rawPath]) => {
        const host = rawHost!.toLowerCase().replace(/^www\./, '');
        if (SEARCH_ENGINE.test(host)) return false;
        return visited.some(
          (v) =>
            (v.host === host || v.host.endsWith(`.${host}`)) &&
            (!rawPath || rawPath === '/' || v.path.startsWith(rawPath.toLowerCase())),
        );
      }) ||
      paths.some((path) =>
        visited.some((v) => !SEARCH_ENGINE.test(v.host) && v.path.startsWith(path)),
      ) ||
      (run.loginPageVisited &&
        /登录页|登录\s*\/\s*认证|登录类|认证类页面|login\s*page/i.test(scope));
    if (hit) out.push(`答案说「${said}」，但本次实际打开过这个页面`);
  }
  return out;
}

/** A form task whose answer does not say what it filled (wa core-08). */
export function omitsFill(answer: string, run: RunActions): boolean {
  if (!run.filled) return false;
  if (run.typedTexts.some((text) => text.trim().length >= 3 && answer.includes(text.trim())))
    return false;
  return !/已(?:在[^。；\n]{0,40})?(?:填写|填入|填好)|填写了|填入了|已填/.test(answer);
}

/** "已检查 / 查看了 / 打开过 / 访问了 / 排查了 / checked / visited": a claimed look at a page. */
const CHECKED =
  /(?:已|都|均|逐(?:个|项|一)?)?\s*(?:检查|查看|打开|访问|进入|排查|浏览|看)(?:了|过)?|checked|visited|opened|looked\s+at/i;
/** "均不含 / 都没有 / 均无 / 也无": what the named pages contain — it says they were looked at. */
const CONTAINS = /(?:均|都|也)?\s*(?:不含|没有|无|未见|不存在|不包含)/;

/**
 * FIX-28 (FIX-27 ja core-08): 「其余表单页（inputs、dropdown、radio_buttons、
 * tinymce）均不含日期选择器」 while the run never opened dropdown or
 * radio_buttons. Pages the answer names as checked — by path (`/dropdown`) or
 * as a bracketed list of path-like names after 「页」 — that no visited URL
 * reached. Only explicitly named pages count.
 */
export function unvisitedChecks(answer: string, run: RunActions): string[] {
  const visited = run.visitedUrls.map(pathOf).filter((v): v is NonNullable<typeof v> => !!v);
  if (!visited.length) return [];
  const segments = new Set(
    visited.flatMap((v) =>
      v.path
        .split('/')
        .filter(Boolean)
        .map((s) => s.toLowerCase()),
    ),
  );
  const out: string[] = [];
  for (const sentence of answer.split(/[。；;\n]/)) {
    if (DENIAL.test(sentence)) continue;
    const named: string[] = [];
    if (CHECKED.test(sentence))
      for (const m of sentence.matchAll(/(?:^|[\s（(、,，:：「])\/([a-z][a-z0-9_-]*)/gi))
        named.push(m[1]!.toLowerCase());
    if (CHECKED.test(sentence) || CONTAINS.test(sentence))
      for (const m of sentence.matchAll(/页(?:面)?\s*[（(]([^）)]{2,120})[）)]/g)) {
        // A list of path-like names only (「inputs、dropdown」); a bracket that holds
        // a title (「标题为 "An iFrame containing…"」) or a tab id is not one.
        const names = m[1]!.split(/[、,，]/).map((name) => name.trim());
        if (
          names.every(
            (name) =>
              /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(name) &&
              name.length <= 30 &&
              !/^(?:tab|frame)_|[0-9a-f]{6}/.test(name),
          )
        )
          named.push(...names);
      }
    const missing = [...new Set(named)].filter(
      (name) => !segments.has(name) && !segments.has(name.replace(/-/g, '_')),
    );
    if (missing.length)
      out.push(
        `答案说「${sentence.trim().slice(0, 80)}」，但本次没有打开过：${missing.join('、')}`,
      );
  }
  return out;
}

/** "通过搜索引擎检索 / 搜索了 / 尝试搜索 / searched": a search the run says it ran. */
const SEARCH_CLAIM =
  /(?:搜索引擎|网页搜索|联网搜索|站内搜索)?\s*(?:检索|搜索|搜寻|查找)(?:了|过)?\s*(?:该|这个|此|视频|页面|相关|目标|关键词|ID|id)|(?:通过|使用|用|借助|尝试|又|再|已|还)\s*(?:搜索引擎|网页搜索|联网搜索|搜索|检索)|(?:搜索|检索)(?:了|过)|(?:多次|反复|几次|一再)\s*(?:搜索|检索)|\b(?:searched|searching)\b|\b(?:a|another|web) search\b/i;
/** "换了来源 / 改用其他网站 / tried other sources": a second source the run says it tried. */
const SOURCE_CLAIM =
  /(?:换|改用|换用|切换到|尝试)(?:了)?\s*(?:其他|别的|另一个?|另外的?|备用)\s*(?:来源|网站|站点|渠道|数据源)|(?:其他|别的|另一个?)(?:来源|网站|站点|渠道)(?:也|均|都)|\b(?:other|another|alternative) (?:sources?|sites?)\b/i;
/** Advice, or a negation right before the verb, is not a claim: "建议搜索", "可以换其他来源", "未搜索". */
const NOT_A_CLAIM =
  /建议|可以|可尝试|可考虑|请|如需|若要|如果|您可|你可|\bplease\b|\byou (?:can|could|may|might)\b|\btry to\b|(?:未|没有|没|并未|无需|不用|不必|不曾|从未)\s*(?:通过|使用|进行|做|曾|再|去)?\s*(?:搜索|检索|搜寻|换|改用|切换|尝试)|\b(?:not|never|without|no)\s+(?:\w+\s+)?(?:search|other|another|alternative)/i;

/** What the run did that a claim of a search or another source needs. */
export interface RunSources {
  /** URLs the run landed on (navigations, clicks, opened tabs). */
  visitedUrls: string[];
  /** The run called web_search, typed into a search box, or opened a search page. */
  searched: boolean;
}

/**
 * FIX-29 (FIRECRAWL-1 r4 fc-douyin): the failure text said 「尝试通过…搜索引擎检索该视频
 * ID 均未获得有效结果」 while the run never searched. Sentences that claim a search,
 * or another source, the run did not make.
 */
export function unperformedActions(answer: string, run: RunSources): string[] {
  const hosts = new Set(
    run.visitedUrls
      .map(pathOf)
      .filter((v): v is NonNullable<typeof v> => !!v)
      .map((v) => v.host),
  );
  const searched = run.searched || [...hosts].some((host) => SEARCH_ENGINE.test(host));
  const out: string[] = [];
  for (const sentence of answer.split(/[。；;\n]/)) {
    for (const clause of sentence.split(/[，,、]/)) {
      if (NOT_A_CLAIM.test(clause)) continue;
      const said = sentence.trim().slice(0, 100);
      if (!searched && SEARCH_CLAIM.test(clause) && !/搜索(?:接口|结果|框|栏)/.test(clause)) {
        out.push(`答案说「${said}」，但本次没有做过任何搜索`);
        break;
      }
      if (hosts.size <= 1 && !searched && SOURCE_CLAIM.test(clause)) {
        out.push(
          `答案说「${said}」，但本次只打开过${hosts.size ? ` ${[...hosts][0]}` : '目标页面'}，没有换过来源`,
        );
        break;
      }
    }
  }
  return out;
}

/**
 * The answer without the clauses that `unperformedActions` flagged. A failure
 * text is often one comma-joined line (「页面显示登录墙，搜索引擎检索也无结果，需要
 * 登录」): only the flagged clause goes, the true ones stay (coordinator review 3).
 */
export function withoutUnperformed(answer: string, run: RunSources): string {
  return answer
    .split(/(?<=[。；;\n])/)
    .map((sentence) => {
      if (!unperformedActions(sentence, run).length) return sentence;
      const end = sentence.match(/[。；;\n]+$/)?.[0] ?? '';
      const kept = sentence
        .slice(0, sentence.length - end.length)
        .split(/(?<=[，,、])/)
        .filter((clause) => !unperformedActions(clause, run).length)
        .join('')
        .replace(/[，,、\s]+$/, '');
      return kept ? `${kept}${end}` : '';
    })
    .join('')
    .trim();
}
