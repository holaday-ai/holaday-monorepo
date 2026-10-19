import { readFileSync } from "node:fs";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MessagesAdapter } from "../../llm/messages-adapter.js";
import { unvisitedChecks } from "./action-claims.js";
import { observationState } from "./cloud-observation.js";
import {
  assessCompletionFacts,
  observedEvidence,
  stripEdgeQuotes,
} from "./completion-fields.js";
import { claimsNoPlayback, installPlaybackGuard } from "./playback-guard.js";
import { createPlaywrightUnifiedExecutor } from "./playwright-unified-executor.js";
import { runUnifiedBrowserLoop } from "./unified-browser-loop.js";
import {
  YOUTUBE_CARD_KINDS_EXPRESSION,
  answeredItems,
  markYoutubeCollections,
  markYoutubeHeadings,
  requestedVideoCount,
  videoShortfall,
  youtubeLinkKind,
} from "./video-count.js";

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/fix28-cases.json", import.meta.url), "utf8"),
) as {
  core04: {
    prompt: string;
    answer: string;
    page: { sourceURL: string; tree: string };
  };
  jaCore08: { answer: string; visitedUrls: string[] };
  localAnswers: { c1: string; c4: string; e4: string };
  headingsRead: {
    read: {
      tabId?: string;
      sourceURL: string;
      tree: string;
      headings: Array<Record<string, unknown>>;
    };
    failingAnswer: string;
  };
  rb2Core10: string;
  sa2Core11: { prompt: string; read: string; answers: string[] };
  sa2D16: { prompt: string; read: string; answers: string[] };
};

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
const finish = (summary: string) => ({
  name: "finish",
  input: { status: "completed", summary },
});

/**
 * FIX-28 — Deploy-27 core-04: 「前5个视频」 answered with 3 videos and 2 course
 * cards (`yt-lockup-view-model`, title link `/watch?v=…&list=…`), completed.
 */
describe("core-04: only single videos count toward 「前 N 个视频」", () => {
  const page = [
    { text: cases.core04.page.tree, sourceURL: cases.core04.page.sourceURL },
  ];
  // The production run read these two results too; the captured tree is cut
  // at 24 000 characters before them, so they are added as a links read.
  const read = [
    ...page,
    {
      text: "",
      sourceURL: cases.core04.page.sourceURL,
      links: [
        {
          text: "Software Testing Course – Playwright, E2E, and AI Agents",
          url: "https://www.youtube.com/watch?v=jydYq7oAtD8",
          kind: "video",
        },
        {
          text: "Playwright Automation Full Course for Beginners | Build Production Level Framework from Scratch",
          url: "https://www.youtube.com/watch?v=bP3M7vCGT4g",
          kind: "video",
        },
      ],
    },
  ];

  it("reads the count the task asks for", () => {
    expect(requestedVideoCount(cases.core04.prompt)).toBe(5);
    expect(
      requestedVideoCount(
        "请使用云端浏览器，YouTube 返回 top 3 videos about cats",
      ),
    ).toBe(3);
    expect(
      requestedVideoCount(
        "请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接",
      ),
    ).toBe(null);
  });

  it.each([
    ["https://www.youtube.com/watch?v=wGr5rz8WGCE&pp=ygUT", "video"],
    ["https://www.youtube.com/shorts/abc123", "video"],
    ["https://www.youtube.com/watch?v=4_m3HsaNwOE&list=PLhW3qG5bs", "playlist"],
    ["https://www.youtube.com/playlist?list=PLhW3qG5bs", "playlist"],
    ["https://www.youtube.com/@RaghavPal", "channel"],
    ["https://example.com/watch?v=x", null],
  ])("%s is %s", (url, kind) => {
    expect(youtubeLinkKind(url)).toBe(kind);
  });

  it("the production answer is short: its two course cards are not videos", () => {
    const short = videoShortfall(
      cases.core04.prompt,
      cases.core04.answer,
      read,
    )!;
    expect(short).toMatchObject({ wanted: 5, videos: 3 });
    expect(short.notVideos.map((item) => item.title)).toEqual([
      "Playwright Beginner Tutorials",
      "Playwright with TypeScript",
    ]);
  });

  it("without its own notes the page links still tell the course cards apart", () => {
    const bare = cases.core04.answer.replace(/（课程\/播放列表卡片）/g, "");
    expect(videoShortfall(cases.core04.prompt, bare, read)).toMatchObject({
      videos: 3,
    });
  });

  it("a video whose title starts like a course title is still a video", () => {
    const items = answeredItems(
      "1. Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]\n2. What is Playwright? (🎭 Playwright introduction tutorial, features & demo)",
      page,
    );
    expect(items.map((item) => item.kind)).toEqual(["video", "video"]);
  });

  it("five videos, or an honest 部分完成, pass", () => {
    const five = [
      "What is Playwright? (🎭 Playwright introduction tutorial, features & demo)",
      "Software Testing Course – Playwright, E2E, and AI Agents",
      "Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]",
      "Playwright Automation Full Course for Beginners | Build Production Level Framework from Scratch",
      "Playwright Automation Tutorial for Beginners from Scratch",
    ]
      .map((title, i) => `${i + 1}. ${title}`)
      .join("\n");
    expect(videoShortfall(cases.core04.prompt, five, read)).toBeNull();
    expect(
      videoShortfall(
        cases.core04.prompt,
        `部分完成：只找到 3 个视频，缺 2 个。\n${cases.core04.answer}`,
        read,
      ),
    ).toBeNull();
  });

  it("fewer items without padding is left to the general count check", () => {
    const three = cases.core04.answer
      .split("\n")
      .filter((line) => !/课程/.test(line))
      .join("\n");
    expect(videoShortfall(cases.core04.prompt, three, read)).toBeNull();
  });

  const loop = (answers: string[]) => {
    const { adapter, seen } = scriptedLoop([
      { name: "snapshot", input: {} },
      ...answers.map(finish),
    ]);
    return runUnifiedBrowserLoop({
      intent: cases.core04.prompt,
      adapter,
      maxSteps: 8,
      execute: async () => ({
        ok: true,
        text: JSON.stringify({
          tree: cases.core04.page.tree,
          sourceURL: cases.core04.page.sourceURL,
        }),
      }),
    }).then((outcome) => ({ outcome, seen: seen.join("\n") }));
  };

  it("the production answer is sent back once, naming the course cards", async () => {
    const honest = [
      "部分完成：只找到 3 个单个视频，缺 2 个。",
      "1. What is Playwright? (🎭 Playwright introduction tutorial, features & demo)",
      "2. Software Testing Course – Playwright, E2E, and AI Agents",
      "3. Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]",
    ].join("\n");
    const { outcome, seen } = await loop([cases.core04.answer, honest]);
    expect(seen).toContain("这些不是视频");
    expect(seen).toContain("「Playwright Beginner Tutorials」");
    expect(outcome.status).toBe("completed");
    expect(outcome.status === "completed" && outcome.summary).toMatch(
      /^部分完成/,
    );
  });

  it("padding again is not delivered as completed", async () => {
    const { outcome } = await loop([cases.core04.answer, cases.core04.answer]);
    expect(outcome).toMatchObject({ status: "failed", failureSource: "task" });
  });
});

/** A YouTube results page whose first two results are course cards, in real Chromium. */
describe("a results page that starts with two course cards", () => {
  let browser: Browser;
  const URL_ =
    "https://www.youtube.com/results?search_query=Playwright+tutorial";
  const card = (title: string, list: string, lessons: number) =>
    `<yt-lockup-view-model><div class="badge">${lessons} lessons</div><h3><a href="/watch?v=first${list}&amp;list=${list}">${title}</a></h3><span>Course</span><a href="/playlist?list=${list}">View full course</a></yt-lockup-view-model>`;
  const video = (title: string, id: string) =>
    `<ytd-video-renderer><h3><a id="video-title" href="/watch?v=${id}">${title}</a></h3><a href="/@channel${id}">Channel ${id}</a></ytd-video-renderer>`;
  const VIDEOS = [
    "What is Playwright? (introduction tutorial)",
    "Software Testing Course – Playwright, E2E, and AI Agents",
    "Playwright with TypeScript : Learn Playwright Automation from Scratch",
    "Playwright Automation Full Course for Beginners",
    "Playwright Automation Tutorial for Beginners from Scratch",
    "Playwright MCP Master Class",
  ];
  const html = `<!doctype html><title>Playwright tutorial - YouTube</title><main>${card(
    "Playwright Beginner Tutorials",
    "PLaaa",
    16,
  )}${card("Playwright with TypeScript", "PLbbb", 26)}${VIDEOS.map((t, i) =>
    video(t, `v${i}`),
  ).join("")}</main>`;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  const open = async () => {
    const context = await browser.newContext();
    await context.route("https://www.youtube.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      }),
    );
    const page = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      taskIntent: cases.core04.prompt,
    });
    await tools.execute({ tool: "navigate", url: URL_ } as never);
    return { context, tools };
  };

  it("the snapshot marks the course cards, and refs still click", async () => {
    const { context, tools } = await open();
    try {
      const read = JSON.parse(
        (await tools.execute({ tool: "snapshot" } as never)).text,
      );
      const tree = String(read.tree);
      expect(tree).toMatch(
        /link "Playwright Beginner Tutorials" \[ref=e\d+\][^\n]*\[youtube=playlist\]/,
      );
      expect(tree).not.toMatch(
        /link "What is Playwright\?[^\n]*\[youtube=playlist\]/,
      );
      const ref = tree.match(
        /link "Playwright Beginner Tutorials" \[ref=(e\d+)\]/,
      )![1];
      const click = await tools.execute({
        tool: "click",
        ref,
        observationRevision: read.observationRevision,
      } as never);
      expect(click.ok).toBe(true);
    } finally {
      tools.dispose();
      await context.close();
    }
  });

  it.each([
    ["title links with list=", (h: string) => h],
    [
      "title links to its first lesson",
      (h: string) => h.replace(/&amp;list=PL[a-z]+"/g, '"'),
    ],
  ])("the card kinds in the DOM (%s)", async (_label, layout) => {
    const context = await browser.newContext();
    await context.route("https://www.youtube.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: layout(html),
      }),
    );
    const page = await context.newPage();
    try {
      await page.goto(URL_);
      const cards = (await page.evaluate(
        YOUTUBE_CARD_KINDS_EXPRESSION,
      )) as Array<{
        title: string;
        kind: string;
      }>;
      const kindOf = (title: string) =>
        cards.find((card) => card.title === title)?.kind;
      expect(kindOf("Playwright Beginner Tutorials")).toBe("playlist");
      expect(kindOf("Playwright with TypeScript")).toBe("playlist");
      for (const title of VIDEOS) expect(kindOf(title)).toBe("video");
    } finally {
      await context.close();
    }
  });

  it("links: course cards are playlists, results are videos", async () => {
    const { context, tools } = await open();
    try {
      const { items } = JSON.parse(
        (await tools.execute({ tool: "links" } as never)).text,
      ) as {
        items: Array<{ text: string; kind: string }>;
      };
      const kindOf = (text: string) =>
        items.find((item) => item.text === text)?.kind;
      expect(kindOf("Playwright Beginner Tutorials")).toBe("playlist");
      expect(kindOf("View full course")).toBe("playlist");
      expect(kindOf(VIDEOS[0]!)).toBe("video");
      expect(kindOf(VIDEOS[2]!)).toBe("video");
    } finally {
      tools.dispose();
      await context.close();
    }
  });

  it("a snapshot read tells course cards from videos", async () => {
    const { context, tools } = await open();
    try {
      const read = JSON.parse(
        (await tools.execute({ tool: "snapshot" } as never)).text,
      );
      const pages = [{ text: String(read.tree), sourceURL: URL_ }];
      const padded = [
        "Playwright Beginner Tutorials",
        "Playwright with TypeScript",
        ...VIDEOS.slice(0, 3),
      ]
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n");
      expect(answeredItems(padded, pages).map((item) => item.kind)).toEqual([
        "playlist",
        "playlist",
        "video",
        "video",
        "video",
      ]);
      expect(videoShortfall(cases.core04.prompt, padded, pages)).toMatchObject({
        videos: 3,
      });
    } finally {
      tools.dispose();
      await context.close();
    }
  });

  it("the loop sends a padded answer back; five videos complete", async () => {
    const { context, tools } = await open();
    try {
      const padded = [
        "Playwright Beginner Tutorials",
        "Playwright with TypeScript",
        ...VIDEOS.slice(0, 3),
      ]
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n");
      const five = VIDEOS.slice(0, 5)
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n");
      const { adapter, seen } = scriptedLoop([
        { name: "snapshot", input: {} },
        finish(padded),
        { name: "scroll", input: { direction: "down" } },
        { name: "snapshot", input: {} },
        finish(five),
      ]);
      const outcome = await runUnifiedBrowserLoop({
        intent: cases.core04.prompt,
        adapter,
        maxSteps: 10,
        observationV2: true,
        execute: (action) => tools.execute(action as never),
      });
      expect(seen.join("\n")).toContain("这些不是视频");
      expect(outcome.status).toBe("completed");
      expect(outcome.status === "completed" && outcome.summary).toContain(
        VIDEOS[4],
      );
    } finally {
      tools.dispose();
      await context.close();
    }
  });
});

/**
 * FIX-28 — replay frames under the playback guard: a player told play()
 * succeeded kept redrawing its progress bar, so the page never settled across a
 * screenshot. Refused like a browser refuses autoplay, it settles.
 */
describe("a guarded player settles", () => {
  let browser: Browser;
  // A player that redraws its progress bar while it believes it is playing.
  const html = `<!doctype html><body><div id="bar" aria-valuenow="0"></div><video id="v" muted width="160" height="90"></video>
<script>
const v = document.getElementById('v');
const c = document.createElement('canvas'); c.width = 160; c.height = 90;
v.srcObject = c.captureStream(10);
v.play().then(() => setInterval(() => document.getElementById('bar').setAttribute('aria-valuenow', String(v.currentTime)), 100),
  () => document.getElementById('bar').setAttribute('data-state', 'play-button'));
</script></body>`;
  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
  });
  afterAll(async () => {
    await browser?.close();
  });
  it("the page does not change across a screenshot, and the player shows its play button", async () => {
    const context = await browser.newContext();
    await installPlaybackGuard(context);
    const page = await context.newPage();
    try {
      // A canvas-stream video never fires `load` (with or without the guard).
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      let changed = 0;
      for (let i = 0; i < 5; i++) {
        const before = (await observationState(page.mainFrame())).version;
        await page.screenshot({ type: "jpeg", quality: 45 });
        await page.waitForTimeout(150);
        if ((await observationState(page.mainFrame())).version !== before)
          changed++;
      }
      expect(changed).toBe(0);
      expect(await page.getAttribute("#bar", "data-state")).toBe("play-button");
      expect(
        await page.evaluate(
          () => (document.getElementById("v") as HTMLVideoElement).paused,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe("「未播放」 is about playback, not the page", () => {
  it.each([
    "页面没有播放列表，列出的都是单个视频",
    "这些不是播放列表",
    "页面没有播放次数，只有点赞数",
    "页面未显示播放量",
    "没有播放按钮可点",
    "did not find a playlist",
  ])("「%s」 is not a 未播放 claim", (answer) => {
    expect(claimsNoPlayback(answer)).toBe(false);
  });
  it.each([
    "视频未播放，只读取了标题",
    "全程没有播放视频",
    "未主动播放",
    "did not play the video",
  ])("「%s」 is one", (answer) => {
    expect(claimsNoPlayback(answer)).toBe(true);
  });
});

describe("an entry without a playback receipt does not fail 「未播放」", () => {
  const run = (playbackReceipt?: () => Promise<null>) => {
    const { adapter, seen } = scriptedLoop([
      { name: "navigate", input: { url: "https://www.youtube.com/watch?v=x" } },
      { name: "read_page", input: {} },
      finish("视频标题：Me at the zoo（未播放）"),
      finish("视频标题：Me at the zoo（未播放）"),
    ]);
    return runUnifiedBrowserLoop({
      intent: "请使用云端浏览器，YouTube 公开视频页读标题（不播放）",
      adapter,
      maxSteps: 6,
      ...(playbackReceipt ? { playbackReceipt } : {}),
      execute: async (action) =>
        action.tool === "navigate"
          ? {
              ok: true,
              text: "已打开",
              url: "https://www.youtube.com/watch?v=x",
            }
          : { ok: true, text: 'heading "Me at the zoo"\nMe at the zoo' },
    }).then((outcome) => ({ outcome, seen: seen.join("\n") }));
  };
  it("no receipt function: not checked, delivered", async () => {
    const { outcome, seen } = await run();
    expect(seen).not.toContain("没有播放状态回执");
    expect(outcome.status).toBe("completed");
  });
  it("a receipt function that reads nothing: still sent back, then failed", async () => {
    const { outcome, seen } = await run(async () => null);
    expect(seen).toContain("没有播放状态回执");
    expect(outcome.status).toBe("failed");
  });
});

/** FIX-27 ja core-08: 「其余表单页（inputs、dropdown、radio_buttons、tinymce）均不含…」. */
describe("pages named as checked must have been opened", () => {
  const run = {
    visitedUrls: cases.jaCore08.visitedUrls,
    loginPageVisited: false,
    filled: true,
    typedTexts: ["Test User"],
  };
  it("the ja answer names dropdown and radio_buttons, never opened", () => {
    const found = unvisitedChecks(cases.jaCore08.answer, run);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("dropdown、radio_buttons");
  });
  it.each([
    "手动访问 /datepicker 返回 404；/large_form 为敏感输入页被遮挡无法读取",
    "其余表单页（inputs、tinymce）均不含日期选择器",
    "从 Wikipedia 页面（tab_0e443644-2dd9-4eba-a9b4-9cdc03a61a4a）打开了 3 个链接",
    "the-internet.herokuapp.com 的 Inputs、Large Form 页面无 date 日期控件",
    "未打开 /login 登录页",
    "页面（Customer name、Telephone）已填写",
    // Scan of 410 real answers: titles in brackets are not page lists.
    '已使用云端浏览器访问 the-internet.herokuapp.com 的 iframe 页面（标题为 "An iFrame containing the TinyMCE WYSIWYG Editor"）',
    "最后已切换回打开这些链接的起始页面（Web browser - Wikipedia，tab_6c0885e4-4ff2-4f07-bfa7-48f8ccc47b10）",
  ])("no false hit: %s", (answer) => {
    expect(unvisitedChecks(answer, run)).toEqual([]);
  });
  it.each([
    "已检查 /dropdown 和 /inputs，均无日期控件",
    "逐项查看了表单页（checkboxes、inputs）",
  ])("caught: %s", (answer) => {
    expect(unvisitedChecks(answer, run).length).toBe(1);
  });

  const loop = (answers: string[]) => {
    const { adapter, seen } = scriptedLoop([
      {
        name: "navigate",
        input: { url: "https://the-internet.herokuapp.com/inputs" },
      },
      { name: "read_page", input: {} },
      ...answers.map(finish),
    ]);
    let url = "about:blank";
    return runUnifiedBrowserLoop({
      intent:
        "请使用云端浏览器，the-internet.herokuapp.com 找日期控件，没有就说明",
      adapter,
      maxSteps: 6,
      currentPageUrl: () => url,
      execute: async (action) => {
        if (action.tool === "navigate") {
          url = (action as { url: string }).url;
          return { ok: true, text: "已打开", url };
        }
        return { ok: true, text: 'heading "Inputs"\nNumber', url };
      },
    }).then((outcome) => ({ outcome, seen: seen.join("\n") }));
  };
  const claimed =
    "其余表单页（inputs、dropdown、radio_buttons）均不含日期控件。";
  const honest = "只打开了 /inputs 页，该页只有数字输入框，没有日期控件。";
  it("sent back once; the honest rewrite is delivered", async () => {
    const { outcome, seen } = await loop([claimed, honest]);
    expect(seen).toContain("本次没有打开过：dropdown、radio_buttons");
    expect(outcome.status).toBe("completed");
  });
  it("a repeat is not delivered as completed", async () => {
    const { outcome } = await loop([claimed, claimed]);
    expect(outcome.status).toBe("failed");
  });
});

/**
 * FIX-28 local runs c1/c4 (559ae994) padded with course cards and were
 * delivered: the cards were not recognised in the page they read (not
 * reproducible later; YouTube serves several layouts). The page read now marks
 * course/playlist links, and a title is matched by heading and by a link name
 * that adds only its length, channel or card kind.
 */
describe("course cards in other layouts", () => {
  const page = [
    { text: cases.core04.page.tree, sourceURL: cases.core04.page.sourceURL },
  ];

  it("the c1 and c4 answers are short against the production page read", () => {
    // Their other titles are real results outside the captured tree.
    const c1 = videoShortfall(
      cases.core04.prompt,
      cases.localAnswers.c1,
      page,
    )!;
    expect(c1.notVideos.map((item) => item.title)).toEqual([
      "Playwright Beginner Tutorials",
    ]);
    const c4 = videoShortfall(
      cases.core04.prompt,
      cases.localAnswers.c4,
      page,
    )!;
    expect(c4.notVideos.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Playwright with TypeScript",
        "Automation Testing - Playwright With JavaScript Tutorials - From Basic To Advanced",
        "Playwright with Python",
      ]),
    );
  });

  it("a course title that is only a heading is told by the link inside it", () => {
    const tree = [
      '- heading "Playwright with Python" [level=3] [ref=e10]:',
      "  - generic [ref=e11]:",
      "    - link [ref=e12]:",
      "      - /url: https://www.youtube.com/watch?v=abc&list=PLpython",
      '- heading "Real Video Title" [level=3] [ref=e20]:',
      '  - link "Real Video Title" [ref=e21]:',
      "    - /url: https://www.youtube.com/watch?v=real1",
    ].join("\n");
    expect(
      answeredItems("1. Playwright with Python\n2. Real Video Title", [
        { text: tree },
      ]).map((item) => item.kind),
    ).toEqual(["playlist", "video"]);
  });

  it("a link name that adds the card kind, channel or length after the title", () => {
    const tree = [
      '- link "Playwright with Java 课程 · SDET- QA" [ref=e1]:',
      "  - /url: https://www.youtube.com/playlist?list=PLjava",
      '- link "What is Playwright? (🎭 Playwright introduction tutorial, features & demo) 12分钟18秒钟" [ref=e2]:',
      "  - /url: https://www.youtube.com/watch?v=wGr5rz8WGCE",
      '- link "Playwright with TypeScript : Learn Playwright Automation" [ref=e3]:',
      "  - /url: https://www.youtube.com/watch?v=ts1",
    ].join("\n");
    expect(
      answeredItems(
        "1. Playwright with Java\n2. What is Playwright? (🎭 Playwright introduction tutorial, features & demo)\n3. Playwright with TypeScript",
        [{ text: tree }],
      ).map((item) => item.kind),
    ).toEqual(["playlist", "video", "unknown"]);
  });

  it("the page read marks course and playlist links, nothing else", () => {
    const marked = markYoutubeCollections(cases.core04.page.tree);
    const line = (name: string) =>
      marked.split("\n").find((l) => l.includes(`link "${name}"`))!;
    expect(line("Playwright Beginner Tutorials")).toContain(
      "[youtube=playlist]",
    );
    expect(line("Playwright with TypeScript")).toContain("[youtube=playlist]");
    expect(
      marked.split("\n").find((l) => l.includes('link "What is Playwright?')),
    ).not.toContain("[youtube=playlist]");
    // Only attributes are added: every ref is still there.
    const refs = (tree: string) =>
      [...tree.matchAll(/\[ref=(e\d+)\]/g)].map((m) => m[1]);
    expect(refs(marked)).toEqual(refs(cases.core04.page.tree));
  });
});

/** FIX-28 e4 (bad1f6f8): three of five titles were in no read of the run, labelled 未核实 and delivered. */
describe("titles that are not on the pages the run read", () => {
  const page = [
    { text: cases.core04.page.tree, sourceURL: cases.core04.page.sourceURL },
  ];
  it("the e4 answer is short: three titles were never read", () => {
    const short = videoShortfall(
      cases.core04.prompt,
      cases.localAnswers.e4,
      page,
    )!;
    // (Its second title is a real result outside the captured tree.)
    expect(short.notOnPage.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Playwright Crash Course 2026 | Step-by-Step Automation Setup with Python & Pytest in VS Code",
        "Complete Playwright Course - Getting Started to Advanced Level 🚀",
        "Playwright: A Complete Guide to Modern Web Testing Framework",
      ]),
    );
    expect(short.videos).toBeLessThan(5);
  });
  it("a bare prefix found in some description is not the title", () => {
    const tree =
      '- generic [ref=e1]: "FREE Complete Playwright Course covering everything from beginner"';
    const answer =
      "1. Complete Playwright Course - Getting Started to Advanced Level 🚀\n2. FREE Complete Playwright Course covering everything from beginner";
    expect(
      videoShortfall(
        "请使用云端浏览器，YouTube 搜索「x」返回前2个视频标题",
        answer,
        [{ text: tree }],
      ),
    ).toMatchObject({ videos: 1 });
  });
  it("a title the page shows cut short still counts", () => {
    const tree = `- link "Playwright Automation Tutorial for Beginners from Scr…" [ref=e1]:\n  - /url: https://www.youtube.com/watch?v=x1`;
    const answer = [
      "Playwright Automation Tutorial for Beginners from Scratch",
      "What is Playwright? (🎭 Playwright introduction tutorial, features & demo)",
    ]
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n");
    expect(
      videoShortfall(
        "请使用云端浏览器，YouTube 搜索「x」返回前2个视频标题",
        answer,
        [...page, { text: tree }],
      ),
    ).toBeNull();
  });
  const loop = (answers: string[]) => {
    const { adapter, seen } = scriptedLoop([
      { name: "snapshot", input: {} },
      ...answers.map(finish),
    ]);
    return runUnifiedBrowserLoop({
      intent: cases.core04.prompt,
      adapter,
      maxSteps: 8,
      execute: async () => ({
        ok: true,
        text: JSON.stringify({
          tree: cases.core04.page.tree,
          sourceURL: cases.core04.page.sourceURL,
        }),
      }),
    }).then((outcome) => ({ outcome, seen: seen.join("\n") }));
  };
  it("sent back once naming them; repeated, it fails", async () => {
    const once = await loop([cases.localAnswers.e4, cases.localAnswers.e4]);
    expect(once.seen).toContain("这些标题不在本次读过的页面里");
    expect(once.seen).toContain(
      "「Complete Playwright Course - Getting Started to Advanced Level 🚀」",
    );
    expect(once.outcome).toMatchObject({
      status: "failed",
      failureSource: "task",
    });
  });
});

/**
 * FIX-28 local c1/c4/h1: in some layouts a course card's title links to its
 * first lesson (no list=). The card's own marks (「16 节课」, 「课程」, 「View
 * full course」) say what it is.
 */
describe("a course card whose title links to its first lesson", () => {
  const tree = [
    "- generic [ref=e1] [cursor=pointer]:",
    "  - link [ref=e2]:",
    "    - /url: https://www.youtube.com/watch?v=lesson1",
    "    - generic [ref=e3]: 16 节课",
    "  - generic [ref=e4]:",
    '    - heading "Playwright with TypeScript" [level=3] [ref=e5]:',
    '      - link "Playwright with TypeScript" [ref=e6]:',
    "        - /url: https://www.youtube.com/watch?v=lesson1",
    "    - generic [ref=e7]:",
    '      - link "SDET- QA" [ref=e8]:',
    "        - /url: https://www.youtube.com/@sdetpavan",
    '      - link "课程" [ref=e9]:',
    "        - /url: https://www.youtube.com/@sdetpavan",
    "- generic [ref=e10] [cursor=pointer]:",
    "  - link [ref=e11]:",
    "    - /url: https://www.youtube.com/watch?v=full1",
    "    - generic [ref=e12]: 3:32:30",
    "  - generic [ref=e13]:",
    '    - heading "Playwright Automation Full Course for Beginners 3小时32分钟" [level=3] [ref=e14]:',
    '      - link "Playwright Automation Full Course for Beginners 3小时32分钟" [ref=e15]:',
    "        - /url: https://www.youtube.com/watch?v=full1",
    "        - text: Playwright Automation Full Course for Beginners",
    "    - generic [ref=e16]: 9 chapters",
  ].join("\n");
  it("the course card is a playlist, the 「Full Course」 video is a video", () => {
    expect(
      answeredItems(
        "1. Playwright with TypeScript\n2. Playwright Automation Full Course for Beginners",
        [{ text: tree }],
      ).map((item) => item.kind),
    ).toEqual(["playlist", "video"]);
  });
  it("the page read marks the course title, not the video", () => {
    const marked = markYoutubeCollections(tree).split("\n");
    expect(
      marked.find((l) => l.includes('link "Playwright with TypeScript"')),
    ).toContain("[youtube=playlist]");
    expect(
      marked.find((l) => l.includes('link "Playwright Automation Full Course')),
    ).not.toContain("[youtube=playlist]");
  });
  it("an answer padded with it is short", () => {
    expect(
      videoShortfall(
        "请使用云端浏览器，YouTube 搜索「x」返回前2个视频标题",
        "1. Playwright with TypeScript\n2. Playwright Automation Full Course for Beginners",
        [{ text: tree }],
      ),
    ).toMatchObject({ videos: 1 });
  });
});

/**
 * FIX-28 root cause of local c1/c4/h1/v2: the snapshot tree is cut at 24 000
 * characters while its headings list every card's title, without a kind; the
 * model took course titles from it and the count could not tell them. Each
 * heading of a YouTube card now carries the kind its card's DOM says.
 */
describe("YouTube headings carry the kind of their card", () => {
  const text = JSON.stringify(cases.headingsRead.read);
  const read = [
    observedEvidence(
      text,
      `${cases.headingsRead.read.tree}\n${cases.headingsRead.read.headings.map((h) => h.text).join("\n")}`,
    ),
  ];

  it("the read has the cards the tree was cut before", () => {
    expect(cases.headingsRead.read.tree).not.toContain(
      "Playwright with Python",
    );
    expect(read[0]!.youtubeCards).toEqual(
      expect.arrayContaining([
        { title: "Playwright with Python", kind: "playlist" },
        { title: "Playwright with TypeScript", kind: "playlist" },
      ]),
    );
  });

  it("the answer that took course titles from the headings is short", () => {
    const short = videoShortfall(
      cases.core04.prompt,
      cases.headingsRead.failingAnswer,
      read,
    )!;
    expect(short.notVideos.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Playwright with TypeScript",
        "Automation Testing - Playwright With JavaScript Tutorials - From Basic To Advanced",
        "Playwright with Python",
      ]),
    );
  });

  it("the loop sends it back", async () => {
    const { adapter, seen } = scriptedLoop([
      { name: "snapshot", input: {} },
      finish(cases.headingsRead.failingAnswer),
      finish(cases.headingsRead.failingAnswer),
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: cases.core04.prompt,
      adapter,
      maxSteps: 6,
      execute: async () => ({ ok: true, text }),
    });
    expect(seen.join("\n")).toContain("「Playwright with Python」");
    expect(outcome.status).toBe("failed");
  });

  it("marks headings by exact title or title plus length", () => {
    expect(
      markYoutubeHeadings(
        [
          { level: 3, text: "Course A" },
          { level: 3, text: "Video B 12分钟18秒钟" },
          { level: 2, text: "Other" },
        ],
        [
          { title: "Course A", kind: "playlist" },
          { title: "Video B", kind: "video" },
        ],
      ),
    ).toEqual([
      { level: 3, text: "Course A", youtube: "playlist" },
      { level: 3, text: "Video B 12分钟18秒钟", youtube: "video" },
      { level: 2, text: "Other" },
    ]);
  });
});

/**
 * FIX-28 rb2 core-10: the page said 「You successfully clicked an alert」 and
 * 「You clicked: Cancel」; the answer quoted 「You clicked」 and 「You clicked:」,
 * which matched as substrings of the second. A label quoted without its value
 * is sent back with the page's whole text.
 */
describe("a quote that is only the label of a 「label: value」 text", () => {
  const tree = [
    '- heading "JavaScript Alerts" [level=3] [ref=e1]',
    '- heading "Result:" [level=4] [ref=e17]',
    '- paragraph [ref=e23]: "You clicked: Cancel"',
    "- paragraph [ref=e24]: You successfully clicked an alert",
    '- paragraph [ref=e25]: "You entered: null"',
  ].join("\n");
  const pages = [
    {
      text: tree,
      sourceURL: "https://the-internet.herokuapp.com/javascript_alerts",
    },
  ];
  const check = (summary: string) =>
    assessCompletionFacts({ summary, pages, intent: "x" });
  it("the rb2 answer is a misquote, with the whole text", () => {
    const facts = check(cases.rb2Core10);
    expect(facts.contradictions.join("；")).toContain("只抄了页面原文");
    expect((facts.misquoted ?? []).map((m) => m.nearest)).toEqual(
      expect.arrayContaining([expect.stringContaining("You clicked: Cancel")]),
    );
  });
  it.each([
    "页面结果为「You clicked: Cancel」",
    "页面结果为「You successfully clicked an alert」",
    "页面结果为「You entered: null」",
    "结果标题为「Result:」",
  ])("a whole text passes: %s", (summary) => {
    expect(check(summary).contradictions).toEqual([]);
  });
  it.each([
    "页面结果为「You clicked」",
    "页面结果为「You clicked:」",
    "页面结果为「You entered」",
  ])("a cut one is sent back: %s", (summary) => {
    expect(check(summary).contradictions.join("")).toContain("只抄了页面原文");
  });
});

describe("the loop sends a cut quote back with the whole text", () => {
  const tree = [
    '- heading "Result:" [level=4] [ref=e17]',
    '- paragraph [ref=e23]: "You clicked: Cancel"',
  ].join("\n");
  it("「You clicked」 is returned once; 「You clicked: Cancel」 is delivered", async () => {
    const { adapter, seen } = scriptedLoop([
      { name: "read_page", input: {} },
      finish("点击 JS Confirm 后页面结果为「You clicked」。"),
      finish("点击 JS Confirm 后页面结果为「You clicked: Cancel」。"),
    ]);
    const outcome = await runUnifiedBrowserLoop({
      // (A neutral task: the JavaScript-alerts dialog receipt is another check.)
      intent: "请使用云端浏览器，读出页面上的结果",
      adapter,
      maxSteps: 6,
      execute: async () => ({ ok: true, text: tree }),
    });
    expect(seen.join("\n")).toContain("最接近的是「You clicked: Cancel」");
    expect(outcome.status === "completed" && outcome.summary).toContain(
      "「You clicked: Cancel」",
    );
  });
});

/**
 * FIX-28 (14:55) sa2 core-11: the footer is 「Powered by」 + link 「Elemental
 * Selenium」 + 「and」 + link 「Sauce Labs」; a link node ends in a colon with
 * its /url child, and its name was dropped, so the whole sentence was never
 * read. sa2 D16: 「“HOLA DAY AI”的搜索结果」 retypes the page's inner 「」 as “”,
 * and the quote was cut at the inner closing mark. Both were sent back three
 * times and failed.
 */
describe("a quote read across adjacent nodes or with nested quote marks", () => {
  const footer = observedEvidence(
    cases.sa2Core11.read,
    JSON.parse(cases.sa2Core11.read).tree,
    "https://the-internet.herokuapp.com/infinite_scroll",
  );
  const results = observedEvidence(
    cases.sa2D16.read,
    JSON.parse(cases.sa2D16.read).tree,
    "https://search-results.holaday.invalid/search?q=HOLA%20DAY%20AI",
  );
  const quotes = (
    summary: string,
    page: ReturnType<typeof observedEvidence>,
    intent = "x",
  ) =>
    assessCompletionFacts({
      summary,
      pages: [page],
      intent,
    }).contradictions.filter((c) => c.startsWith("原文引用"));
  // The page's paragraphs are random on every load: only the footer is compared.
  it.each([0, 1, 2])(
    "sa2 core-11 answer %i: the footer quote is the page text",
    (i) => {
      expect(
        quotes(
          cases.sa2Core11.answers[i]!,
          footer,
          cases.sa2Core11.prompt,
        ).filter((c) => c.includes("Powered")),
      ).toEqual([]);
    },
  );
  it.each([0, 1, 2])("sa2 D16 answer %i is delivered", (i) => {
    expect(
      assessCompletionFacts({
        summary: cases.sa2D16.answers[i]!,
        pages: [results],
        intent: cases.sa2D16.prompt,
      }).contradictions,
    ).toEqual([]);
  });
  it.each([
    "页脚显示“Powered by Elemental Selenium and Selenium Labs”",
    "页脚显示“Powered by Sauce Labs”",
    "页脚显示“Powered by Elemental Selenium and Sauce Lab”",
    "页脚显示“owered by Elemental Selenium”",
  ])("a footer the page never said is still a misquote: %s", (summary) => {
    expect(quotes(summary, footer)).toHaveLength(1);
  });
  it.each([
    "h1 原文为「“HOLA NIGHT AI”的搜索结果」",
    "h1 原文为「“HOLA DAY AI”的全部结果」",
    "页面注明「已改用搜索接口结果页：本次打开 www.google.com 的搜索结果页。」",
    "标题：「“HOLA DAY AI”的结果」",
  ])("a nested quote the page never said is still sent back: %s", (summary) => {
    expect(
      assessCompletionFacts({ summary, pages: [results], intent: "x" })
        .contradictions,
    ).not.toEqual([]);
  });
  it("a cut label is still sent back across nodes (rb2 core-10)", () => {
    const page = {
      text: ["- paragraph [ref=e23]:", '  - text: "You clicked: Cancel"'].join(
        "\n",
      ),
      sourceURL: "https://the-internet.herokuapp.com/javascript_alerts",
    };
    expect(
      assessCompletionFacts({
        summary: "页面结果为「You clicked」",
        pages: [page],
        intent: "x",
      }).contradictions.join(""),
    ).toContain("只抄了页面原文");
  });
  it("takes off wrapping and stray quote marks, keeps a pair inside", () => {
    expect(stripEdgeQuotes("“Powered by Sauce Labs”")).toBe(
      "Powered by Sauce Labs",
    );
    expect(stripEdgeQuotes("“HOLA DAY AI")).toBe("HOLA DAY AI");
    expect(stripEdgeQuotes("“HOLA DAY AI”的搜索结果")).toBe(
      "“HOLA DAY AI”的搜索结果",
    );
    expect(stripEdgeQuotes("「“x y z”」")).toBe("x y z");
  });
  it("the loop delivers the sa2 D16 answer on the first finish", async () => {
    const { adapter } = scriptedLoop([
      { name: "read_page", input: {} },
      finish(cases.sa2D16.answers[2]!),
    ]);
    const rejected: unknown[] = [];
    const outcome = await runUnifiedBrowserLoop({
      // (Without 「保留步骤截图」: the screenshot receipt is another check.)
      intent: cases.sa2D16.prompt.replace("，并保留步骤截图", ""),
      adapter,
      maxSteps: 4,
      execute: async () => ({ ok: true, text: cases.sa2D16.read }),
      onCompletionRejected: async (d) => {
        rejected.push(d);
      },
    });
    expect(rejected).toEqual([]);
    expect(outcome.status).toBe("completed");
  });
});
