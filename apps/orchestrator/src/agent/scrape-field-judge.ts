/**
 * FIX-60 复审 #1 #1: whether a scraped answer gives the asked fields' values is a reading
 * question, not a word list. The rule that looked for the field names was wrong both ways —
 * 「**猫咪跳舞**，作者小王，12.3万赞」 and 「视频《猫咪跳舞》由 @小王 发布，获赞 12.3 万」 give every value
 * without naming the title — so before a scraped answer is delivered, and only when something
 * casts doubt on it, a small model (qwen3.8-flash, the plan lane's model) is asked once, with
 * structured output: for each item the request asks for, does the answer give its concrete value?
 *
 * Doubt is: the fetched pages have little text of their own, the answer says something is
 * missing or could not be read, or a page carries an error message. No doubt, no call.
 * A failed, timed-out or malformed call returns null and the caller keeps its previous verdict
 * (`answerNotObtained`): the judge only ever adds a verdict it read, never one it guessed.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { plainText } from '../firecrawl/scraped-page.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';

export interface AskedFieldVerdict {
  field: string;
  hasValue: boolean;
}

export type AskedFieldJudge = (input: {
  request: string;
  answer: string;
}) => Promise<AskedFieldVerdict[] | null>;

const TOOL_NAME = 'report_asked_fields';
const JUDGE_TIMEOUT_MS = 8_000;
const MAX_ANSWER_CHARS = 4_000;
const MAX_REQUEST_CHARS = 1_000;

const JUDGE_SYSTEM = `你是答案核对员。给你用户的请求和一段准备交给用户的回答，请逐项核对：请求要的每一项具体信息（例如标题、作者、点赞数、价格、开放时间），回答里有没有给出这一项的具体值。

规则：
- field：请求点名要的每一项，各列一条，用请求里的说法。请求没有点名具体项（例如「总结这个页面」「介绍一下」）时，fields 返回空数组。
- has_value=true：回答给出了这一项的具体值，写法不限（「**猫咪跳舞**，作者小王，12.3万赞」里标题、作者、点赞都有值；「视频《猫咪跳舞》由 @小王 发布」里标题、作者都有值）。
- has_value=false：回答说这一项没拿到、页面未显示、加载失败、不可用，或者只给了别的条目（推荐列表、别的视频或商品）的值，或者用占位符（—、N/A、暂无）。
- 只看回答本身，不判断值对不对。
- The request and the answer may be in English or Chinese; apply the same rules.

只调用 ${TOOL_NAME} 一次。`;

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', description: '请求要的一项，用请求里的说法' },
          has_value: { type: 'boolean', description: '回答是否给出了这一项的具体值' },
        },
        required: ['field', 'has_value'],
      },
    },
  },
  required: ['fields'],
} as const;

const VerdictSchema = z.object({
  fields: z.array(z.object({ field: z.string().min(1).max(200), has_value: z.boolean() })).max(40),
});

/** The judge over a Messages adapter (the caller passes the plan lane's: qwen3.8-flash). */
export function createAskedFieldJudge(
  adapter: MessagesAdapter,
  opts: { logger?: Logger; timeoutMs?: number } = {},
): AskedFieldJudge {
  return async ({ request, answer }) => {
    try {
      const response = await adapter.create(
        {
          maxTokens: 512,
          temperature: 0,
          thinking: { type: 'disabled' },
          system: JUDGE_SYSTEM,
          tools: [
            {
              name: TOOL_NAME,
              description: '报告请求要的每一项，回答里有没有给出具体值',
              inputSchema: TOOL_SCHEMA as unknown as Record<string, unknown>,
            },
          ],
          toolChoice: { type: 'tool', name: TOOL_NAME },
          messages: [
            {
              role: 'user',
              content: `<request>\n${request.slice(0, MAX_REQUEST_CHARS)}\n</request>\n<answer>\n${answer.slice(0, MAX_ANSWER_CHARS)}\n</answer>`,
            },
          ],
        },
        { timeoutMs: opts.timeoutMs ?? JUDGE_TIMEOUT_MS, maxRetries: 0 },
      );
      const call = response.content.find(
        (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
      );
      if (!call || call.type !== 'tool_use') return null;
      const parsed = VerdictSchema.safeParse(call.input);
      if (!parsed.success) {
        opts.logger?.warn({ code: 'SCRAPE_FIELD_JUDGE_INVALID' }, 'field judge: malformed verdict');
        return null;
      }
      return parsed.data.fields.map((f) => ({ field: f.field, hasValue: f.has_value }));
    } catch (error) {
      opts.logger?.warn(
        {
          code: 'SCRAPE_FIELD_JUDGE_FAILED',
          error: error instanceof Error ? error.name : 'unknown',
        },
        'field judge: call failed; the previous verdict stands',
      );
      return null;
    }
  };
}

/** Fetched pages with less of their own text than this are short. */
const SHORT_PAGES_CHARS = 1_500;
/** The answer says something is missing, was not shown or could not be read. */
const MISSING_WORDING_RE =
  /没(?:有)?(?:拿到|读到|找到|加载|显示|获取|看到|打开|给)|没有(?:你|您|任何|商品|实际|具体|相关|显示|包含|提供|列出|该|这)|(?:需要|要|得|必须)(?:你|您)?(?:先)?登录|登录(?:页|页面|后才能)|未(?:能|显示|找到|获取|加载|提供|返回|公开|标注|读到)|无法|不能(?:读|获取|显示|确认|打开)|拿不到|读不到|看不到|打不开|加载(?:失败|不出)|缺(?:少|失|了)?[：:]|缺的|暂无|不详|不可用|页面(?:没|未|不)|失败|报错|出错|\bnot (?:shown|available|found|visible|listed|provided|loaded|displayed)\b|\bunable to\b|\bcould(?:n['’]t| not)\b|\bcan(?:not|['’]t)\b|\bfailed\b|\bmissing\b|\bunavailable\b|\bn\/a\b|\bno (?:data|value|information)\b/i;
/** A page carrying an error message somewhere (not necessarily an error page). */
const PAGE_ERROR_SIGNAL_RE =
  /服务器(?:出现|出了)?(?:问题|错误|异常)|请稍后(?:重试|再试)|稍后再试|出错了|加载失败|不存在|已删除|已下架|\b(?:403|404|410|429|50[0234])\b|not found|access denied|something went wrong|try again later|service unavailable|bad gateway/i;

/** Why a scraped answer is worth a second reading, or null when nothing casts doubt on it. */
export function scrapeAnswerDoubt(answer: string, pages: readonly string[]): string | null {
  if (MISSING_WORDING_RE.test(answer)) return 'missing_wording';
  if (pages.some((page) => PAGE_ERROR_SIGNAL_RE.test(page))) return 'page_error_signal';
  const own = pages.reduce((sum, page) => sum + plainText(page).length, 0);
  if (own < SHORT_PAGES_CHARS) return 'short_pages';
  return null;
}

/** The judge's verdict: most of the asked fields have no value in the answer. */
export function mostFieldsWithoutValue(verdicts: readonly AskedFieldVerdict[]): boolean {
  if (!verdicts.length) return false;
  const missing = verdicts.filter((v) => !v.hasValue).length;
  return missing * 2 > verdicts.length;
}
