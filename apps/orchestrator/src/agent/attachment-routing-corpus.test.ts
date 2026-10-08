import { pino } from 'pino';
import { expect, it } from 'vitest';
import type { NeutralResponseInputContent, ResponsesAdapter } from '../llm/responses-adapter.js';
import { runGenerateTask } from './generate-runner.js';
import { classifyExecutionMode } from './intent-classifier.js';
import { runScrapeTask } from './scrape-runner.js';

// Hand-labelled acceptance corpus. A classifier regression or a runner dropping
// either image/text material must fail at the model request boundary.
const corpus = [
  ['用这张图写短文', true, 'generate'],
  ['用这张图写短文，并提供可下载的文章文件', true, 'generate'],
  ['现在帮我用这张图写一个小故事', true, 'generate'],
  ['用附件写一篇介绍 Node.js 的技术文章', true, 'generate'],
  ['根据附件写一篇 Vue.js 和 Next.js 的对比报告', true, 'generate'],
  ['用附件里的数据写一份最新的季度报告', true, 'generate'],
  ['参考附件，写一篇文章总结 36kr.com 今天的新闻', true, 'scrape'],
  ['根据当前上传的图片写一篇短文', true, 'generate'],
  ['根据上传的照片写一个故事', true, 'generate'],
  ['根据附件写一篇 ASP.NET 的技术文章', true, 'generate'],
  ['根据附件写一篇关于 app.ts 的技术文章', true, 'generate'],
  ['根据附件写一篇关于 script.py 的技术文章', true, 'generate'],
  ['今天用附件写一篇故事', true, 'generate'],
  ['根据当前附件写一份报告', true, 'generate'],
  ['现在用附件生成一份文档', true, 'generate'],
  ['用附件生成最新的培训文档', true, 'generate'],
  ['用附件写一份报告，参考 https://example.com/article', true, 'scrape'],
  ['用附件写一篇文章，总结 www.example.com', true, 'scrape'],
  ['用附件写一份 example.org 的文档报告', true, 'scrape'],
  ['根据附件写今天的新闻报告', true, 'scrape'],
  ['用附件写一篇关于今天的股价的文章', true, 'scrape'],
  ['结合附件写今天的天气报告', true, 'scrape'],
  ['根据附件写最新市场报告', true, 'scrape'],
  ['Use the attachment to write a story now', true, 'generate'],
  ['Write an article about Node.js using the attachment', true, 'generate'],
  ["Write a report with the attachment about today's news", true, 'scrape'],
  ['Summarize https://example.com/article using the attachment and write a report', true, 'scrape'],
  ['根据 report.pdf 写一篇文章', true, 'generate'],
  ['用上传的 image.png 写一个小故事', true, 'generate'],
  ['写一个故事', false, 'generate'],
  ['现在写一份培训文档', false, 'generate'],
  ['写一篇 Node.js 技术文章', false, 'generate'],
  ['总结 36kr.com 的新闻', false, 'scrape'],
  ['分析 example.org 的主页内容', false, 'scrape'],
  ['查今天特斯拉股价', false, 'scrape'],
  ['搜索最新 AI 新闻', false, 'scrape'],
  ['查当前天气', false, 'scrape'],
  ['总结 https://example.com 的内容', false, 'scrape'],
  ['Summarize www.example.com', false, 'scrape'],
  ['帮我整理一份运维 SOP', false, 'generate'],
] as const;

it.each(corpus)(
  'routes and delivers material: %s (attached=%s)',
  async (intent, attached, lane) => {
    const logger = pino({ level: 'silent' });
    const mode = await classifyExecutionMode({ intent, hasFileAttachment: attached, logger });
    expect(mode).toBe(lane);
    const received: NeutralResponseInputContent[] = [];
    const adapter: ResponsesAdapter = {
      metadata: { provider: 'openai', model: 'local-fixture', protocol: 'responses' },
      async stream(request) {
        for (const message of typeof request.input === 'string' ? [] : request.input) {
          if (typeof message.content !== 'string') received.push(...message.content);
        }
        return {
          id: 'fixture',
          metadata: this.metadata,
          text: '根据用户材料和已取得来源完成的合成结果。',
          sources: [],
          usage: { inputTokens: 10, outputTokens: 10 },
          status: 'completed',
        };
      },
    };
    const opts = {
      taskId: 'tsk_attachment_corpus',
      userId: 'usr_fixture',
      intent,
      logger,
      responsesAdapter: adapter,
      ...(attached
        ? {
            fileIds: ['fil_image', 'fil_text'],
            attachments: [
              { type: 'image', source: { media_type: 'image/png', data: 'synthetic-image-bytes' } },
              { type: 'text', text: 'attachment-only marker: material 246' },
            ],
          }
        : {}),
    };
    if (mode === 'scrape') {
      await runScrapeTask({
        ...opts,
        firecrawl: {
          scrape: async (url) => ({ ok: true, url, markdown: 'Local web source.' }),
          search: async () => ({
            ok: true,
            results: [{ url: 'https://example.com/source', markdown: 'Local web source.' }],
          }),
        },
      });
    } else await runGenerateTask(opts);
    expect(
      received.some(
        (block) => block.type === 'input_image' && block.source.data === 'synthetic-image-bytes',
      ),
    ).toBe(attached);
    expect(
      received.some(
        (block) =>
          block.type === 'input_text' && block.text === 'attachment-only marker: material 246',
      ),
    ).toBe(attached);
  },
);
