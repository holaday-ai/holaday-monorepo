import { describe, expect, it } from "vitest";
import {
  extractStructuredItems,
  reviewListAnswer,
} from "../../execution/answer-verifier.js";
import type { ExecutionContract } from "../../execution/execution-contract.js";
import type { MessagesAdapter } from "../../llm/messages-adapter.js";
import { plainInternalWords, sanitizeFinalText } from "../text-sanitizer.js";
import { assessCompletionFacts } from "./completion-fields.js";
import { runUnifiedBrowserLoop } from "./unified-browser-loop.js";

function scriptedLoop(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
) {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: "anthropic", model: "fixture" },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: "anthropic", model: "fixture" },
        content: [{ type: "tool_use", id: String(turn), ...call }],
        stopReason: "tool_use",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { adapter, seen };
}
const finish = (status: "completed" | "failed", summary: string) => ({
  name: "finish",
  input: { status, summary },
});

describe("FIX-44 #2 · core-01: 「结果N_标题 / 结果N_链接」 are one result", () => {
  /** Deploy-44 core-01 (tsk_STCtcF3AHFQYmwTyKTF3Q), the list as delivered. */
  const CORE_01 = [
    "已从 Brave 搜索接口页面（搜索接口结果页）读取前5条搜索结果，每条标题与对应详情页链接均按页面原样提取。",
    "",
    "- 结果1_标题：Hola / An AI companion to talk to. Anytime, about anything.",
    "- 结果1_链接：https://holaapp.in/",
    "- 结果2_标题：Hola: Talk It Out with AI – Apps on Google Play",
    "- 结果2_链接：https://play.google.com/store/apps/details?id=ai.holaapp&hl=en_IN",
    "- 结果3_标题：Tryholo",
    "- 结果3_链接：https://tryholo.ai/",
    "- 结果4_标题：HolaAI-Chat Dream - Apps on Google Play",
    "- 结果4_链接：https://play.google.com/store/apps/details?id=app.ultra.hola.ai.eu&hl=en",
    "- 结果5_标题：Hola: Talk It Out with AI for Android - Free App",
    "- 结果5_链接：https://www.appbrain.com/app/hola-talk-it-out-with-ai/ai.holaapp",
  ].join("\n");
  const contract = {
    successCriteria: [
      {
        id: "c1",
        type: "list_item_sources",
        description: "",
        data: { minItems: 5, searchResults: true },
      },
    ],
  } as unknown as ExecutionContract;

  it("five results, each with its own link; no 缺少来源链接", () => {
    const items = extractStructuredItems(CORE_01);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.url)).toEqual([
      "https://holaapp.in/",
      "https://play.google.com/store/apps/details?id=ai.holaapp&hl=en_IN",
      "https://tryholo.ai/",
      "https://play.google.com/store/apps/details?id=app.ultra.hola.ai.eu&hl=en",
      "https://www.appbrain.com/app/hola-talk-it-out-with-ai/ai.holaapp",
    ]);
    expect(reviewListAnswer(contract, CORE_01)).toBeNull();
  });

  it("「Result1_title / Result1_link」 the same", () => {
    const english = CORE_01.replace(/结果(\d)_标题/g, "Result$1_title").replace(
      /结果(\d)_链接/g,
      "Result$1_link",
    );
    expect(extractStructuredItems(english)).toHaveLength(5);
    expect(reviewListAnswer(contract, english)).toBeNull();
  });

  it("reverse: a title whose link is missing is still flagged", () => {
    const missing = CORE_01.replace("- 结果3_链接：https://tryholo.ai/\n", "");
    expect(reviewListAnswer(contract, missing)).toContain(
      "第 3 条缺少来源链接",
    );
  });

  it("reverse: 「结果12」 is not result 1", () => {
    const items = extractStructuredItems(
      "- 结果1_标题：Alpha https://a.test/1\n- 结果12_标题：Beta https://b.test/2",
    );
    expect(items).toHaveLength(2);
  });
});

describe("FIX-44 #3 · currentURL reads as 当前地址", () => {
  /** Deploy-44 google-direct-1 (tsk_TKNNytsaVyqoDSS3evrwB), the field as delivered. */
  const GOOGLE_DIRECT_1 =
    "已成功在云端浏览器中打开 google.com。当前页面为 Google 首页，显示搜索框、Gmail、Images 等链接及 Sign in 按钮，地区显示为 Singapore。\n\n- currentURL：https://www.google.com/";

  it("Deploy-44 verbatim", () => {
    const expected = GOOGLE_DIRECT_1.replace("- currentURL：", "- 当前地址：");
    expect(plainInternalWords(GOOGLE_DIRECT_1)).toBe(expected);
    expect(sanitizeFinalText(GOOGLE_DIRECT_1)).toBe(expected);
  });

  it.each([
    ["**currentURL**：https://a.test/", "**当前地址**：https://a.test/"],
    [
      "当前页面 currentURL 为 https://a.test/。",
      "当前地址为 https://a.test/。",
    ],
  ])("%s", (input, expected) => {
    expect(plainInternalWords(input)).toBe(expected);
  });

  it.each([
    "在代码里读 `currentURL` 即可",
    "```\nconst currentURL = page.url();\n```",
    "见 https://example.org/?currentURL=1",
    "The API returns currentURL and title.",
  ])("reverse: 「%s」 is left as written", (text) => {
    expect(plainInternalWords(text)).toBe(text);
  });
});

describe("FIX-44 #3 · 未核实 cuts a value at a bracket it never opened", () => {
  /** Deploy-44 core-06 (tsk_YJHs4pGN8uXsZPCA5NCYH), the opening as delivered. */
  const CORE_06 =
    "已读取维基百科「人工智能」页面第3节（章节标题：研究課題），内容完整。该节概述了人工智能当前的主要研究方向与子领域。";
  const facts = (text: string) =>
    assessCompletionFacts({
      summary: CORE_06,
      pages: [{ text }],
      receipts: "",
      toolTexts: "",
      intent: "请使用云端浏览器，维基百科长页面，分段读取并总结第3节",
    });

  it("「研究課題」 is checked, not 「研究課題）」", () => {
    expect(
      facts('heading "人工智能"\n3 研究課題\n演绎、推理和解决问题').unverified,
    ).toEqual([]);
  });

  it("reverse: a section title the page lacks is still unverified", () => {
    expect(facts('heading "人工智能"\n3 历史').unverified.join("；")).toContain(
      "研究課題",
    );
  });

  it("reverse: a bracket the value opens itself is kept", () => {
    const summary = "页面标题：Safari (web browser) - Wikipedia，已读取。";
    const result = assessCompletionFacts({
      summary,
      pages: [{ text: 'heading "Safari (web browser) - Wikipedia"' }],
      receipts: "",
      toolTexts: "",
      intent: "读页面标题",
    });
    expect(result.unverified).toEqual([]);
  });
});

describe("FIX-44 #4 · reg-dy-2: a named field given as absent is read from the page text first", () => {
  const INTENT =
    "打开 https://www.douyin.com/video/7377304298310389027 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）";
  const URL = "https://www.douyin.com/video/7377304298310389027";
  /** Deploy-44 reg-dy-2 (tsk_iEpiCkSw8F7Mp36CWFeTd): only snapshots, author 「页面未显示」. */
  const REG_DY_2 =
    "在 https://www.douyin.com/video/7377304298310389027 页面读取到视频信息：\n- 视频标题：第52集 | 柠檬巴巴露亚\n- 作者：页面未显示\n- 点赞数：4741\n- 评论数：214\n- 收藏数：4370\n- 分享数：1652";
  /** The popup hides the page from snapshot; the page text still has the author (dy-2). */
  const run = (
    calls: Array<{ name: string; input: Record<string, unknown> }>,
  ) => {
    const execute = (async (action: { tool: string }) => ({
      ok: true,
      url: URL,
      text: JSON.stringify({
        sourceURL: URL,
        ...(action.tool === "get_page_text"
          ? { text: "第52集 | 柠檬巴巴露亚\n小喵麻麻\n4741 214 4370 1652" }
          : {
              tree: 'heading "第52集 | 柠檬巴巴露亚"\n4741 214 4370 1652\ndialog "登录"',
            }),
      }),
      ...(action.tool === "screenshot"
        ? { image: { mediaType: "image/jpeg", data: "AA==" } }
        : {}),
    })) as never;
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent: INTENT,
      adapter,
      maxSteps: 20,
      observationV2: true,
      execute,
      currentPageUrl: () => URL,
    }).then((outcome) => ({ outcome, seen: seen.join("\n") }));
  };

  it("the Deploy-44 trace (snapshots only) is told to get_page_text first, then reads the author", async () => {
    const { outcome, seen } = await run([
      { name: "navigate", input: { url: URL } },
      { name: "snapshot", input: {} },
      finish("completed", REG_DY_2),
      { name: "get_page_text", input: {} },
      finish(
        "completed",
        REG_DY_2.replace("作者：页面未显示", "作者：小喵麻麻"),
      ),
    ]);
    expect(seen).toContain("请先 get_page_text 读一次页面正文");
    expect(outcome).toMatchObject({
      status: "completed",
      summary: expect.stringContaining("小喵麻麻"),
    });
    expect(outcome).not.toHaveProperty("partial");
  });

  it("after a screenshot too: get_page_text first, then the popup ×", async () => {
    const { seen } = await run([
      { name: "navigate", input: { url: URL } },
      { name: "snapshot", input: {} },
      { name: "screenshot", input: {} },
      finish("completed", REG_DY_2),
      finish("completed", REG_DY_2),
    ]);
    expect(seen).toContain("请先 get_page_text 读一次页面正文");
    expect(seen).toContain("仍读不到再点弹窗自己的关闭按钮（×，不要按 Esc）");
  });

  it("reverse: the page text was already read — no second get_page_text ask", async () => {
    const { seen } = await run([
      { name: "navigate", input: { url: URL } },
      { name: "get_page_text", input: {} },
      finish("completed", REG_DY_2),
      finish("completed", REG_DY_2),
    ]);
    expect(seen).not.toContain("请先 get_page_text");
    expect(seen).toContain("请先 screenshot 看一眼");
  });

  it("still absent after the look: delivered as 部分完成, as before", async () => {
    const { outcome } = await run([
      { name: "navigate", input: { url: URL } },
      { name: "snapshot", input: {} },
      finish("completed", REG_DY_2),
      finish("completed", REG_DY_2),
    ]);
    expect(outcome).toMatchObject({
      status: "completed",
      partial: { missing: "作者" },
    });
  });
});
