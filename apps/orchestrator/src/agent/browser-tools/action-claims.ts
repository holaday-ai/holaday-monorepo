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
