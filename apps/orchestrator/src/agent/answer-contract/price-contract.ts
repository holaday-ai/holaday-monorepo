/**
 * REBUILD-3: the price contract in the browser loop's finish path (behind
 * `ANSWER_CONTRACT_PRICE`). See README.md in this folder.
 *
 * finish(price_result) → schema check (one retry) → quote / same-block check (one send-back with
 * the text actually read) → items still wrong move to `missing` → code renders the answer.
 * A missing item never causes a send-back; anything missing makes the answer 部分完成.
 */
import type {
  MessagesAdapter,
  NeutralInputContentBlock,
  NeutralMessage,
  NeutralMessagesRequestOptions,
  NeutralToolDefinition,
} from '../../llm/messages-adapter.js';
import { renderPriceAnswer, renderPriceFailure, shortName } from './price-render.js';
import {
  PRICE_RESULT_SCHEMA,
  type PriceLanguage,
  type PriceMissing,
  type PriceResult,
  parsePriceResult,
} from './price-result.js';
import { type RejectedPriceItem, verifyPriceItems } from './price-verify.js';
import type { ReadPage } from './read-blocks.js';

export type { AnswerContractKind } from './handled.js';

/** The finish tool of a price task: the usual finish plus `price_result`. */
export function priceFinishTool(finish: NeutralToolDefinition): NeutralToolDefinition {
  const schema = finish.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    ...finish,
    description: `${finish.description} 这是查价格任务：必须同时填 price_result（结构化结果，答案由系统按它排版；summary 只写一句话概括）。`,
    inputSchema: {
      ...finish.inputSchema,
      properties: { ...(schema.properties ?? {}), price_result: PRICE_RESULT_SCHEMA },
      required: [...(schema.required ?? []), 'price_result'],
    },
  };
}

/** Appended to the browser system prompt for a price task. */
export const PRICE_CONTRACT_RULE = `17. 这是查价格任务。finish 时必须填 price_result，答案由系统按它排版，summary 只写一句话概括，不要再列表：
- language：用户用中文问就填 zh，用英文问就填 en。
- items：每款一条。name、variant、price 照页面原样写（不换算、不补全）；quote 从本次读到的页面文字里逐字复制一小段，要包含这一款的价格；block_ref 写这一款所在快照节点的 ref（如 e123：取 snapshot / read_page 里包住这一款规格和价格的最小节点——商品卡片、列表项，或详情页上那一个规格项；不要取只含标题链接的子节点，也不要取整页、整个列表或整个规格区：区块里有两个以上不同价格或两个以上规格选项会被退回）。详情页的规格项里没有商品名时，name 可以照本页标题写。读的是 get_page_text 这类没有 ref 的文字时，block_ref 写 text，quote 只摘同时含规格和价格的一小段（300 字以内、只含一个价格；名称不在其中时要是本页标题）。source_url 写这一款的链接（页面上读到的），没有就填 null。
- missing：没拿到的写在这里（field 写 price / variant / name / link，item 写是哪一款，reason 写页面上为什么没有），不要编，也不要用别的规格或别的商品的价格顶替；如实缺项不会被退回，会按「部分完成」交付。
- note：可选的一句补充说明，不要在 note 里写价格。`;

export interface PriceFinishOptions {
  /** How many items the request asks for (「前三个」), when it says. */
  wantedCount: number | null;
}

export type PriceFinishDecision =
  /** Sent back to the model as an error tool result; the run goes on. */
  | { kind: 'retry'; message: string; reason: string }
  /** The answer, rendered by code. */
  | {
      kind: 'deliver';
      summary: string;
      evidence: string;
      partial?: { found: number; wanted: number; missing: string };
      result: PriceResult;
    }
  /** Nothing usable was obtained. */
  | { kind: 'fail'; reason: string }
  /** No valid price_result after the retry: the caller degrades (two steps, then legacy). */
  | { kind: 'invalid'; errors: string[] };

const REJECTED_REASON: Record<PriceLanguage, string> = {
  zh: '名称、规格和价格没能在本次读到的同一区块里核对上',
  en: 'name, variant and price could not be matched to one block of the pages read',
};

function sendBackMessage(rejected: readonly RejectedPriceItem[]): string {
  const lines = rejected.map(({ index, item, problems, readText }) =>
    [
      `第 ${index + 1} 条「${shortName(item.name)}」（block_ref=${item.block_ref}）：${problems.join('；')}。`,
      readText ? `本次读到的这个区块是：\n${readText}` : '本次读到的页面里没有找到这段文字。',
    ].join('\n'),
  );
  return [
    'price_result 里有条目没能核对上：',
    ...lines,
    '请按上面实际读到的原文改正这些条目：variant、price、quote 都要出自同一个最小的规格项或商品卡片（block_ref 指向它；name 不在其中时要是本页标题）；这一款确实没读到就把它移进 missing（如实缺项不会被退回）。其余条目不变，再 finish。这是唯一一次退回，再不对的条目会移进 missing。',
  ].join('\n\n');
}

/** One price contract per run: it remembers its one retry and its one send-back. */
export function createPriceContract(options: PriceFinishOptions) {
  let schemaRetried = false;
  let sentBack = false;
  return {
    decide(
      args: Record<string, unknown>,
      pages: readonly ReadPage[],
      context: { final: boolean },
    ): PriceFinishDecision {
      const parsed = parsePriceResult(args.price_result);
      if (!parsed.ok) {
        if (!schemaRetried && !context.final) {
          schemaRetried = true;
          return {
            kind: 'retry',
            reason: `price_result 校验失败：${parsed.errors.join('；')}`,
            message: `price_result 不符合 finish 工具里的结构：${parsed.errors.slice(0, 8).join('；')}。请按结构重新 finish（没拿到的写进 missing）。`,
          };
        }
        return { kind: 'invalid', errors: parsed.errors };
      }
      const result = parsed.value;
      const checked = verifyPriceItems(result.items, pages);
      if (checked.rejected.length && !sentBack && !context.final) {
        sentBack = true;
        return {
          kind: 'retry',
          reason: checked.rejected
            .map((r) => `第${r.index + 1}条：${r.problems.join('；')}`)
            .join(' | '),
          message: sendBackMessage(checked.rejected),
        };
      }
      const language = result.language;
      const missing: PriceMissing[] = [
        ...result.missing,
        ...checked.rejected.map(({ item }) => ({
          field: 'price',
          item: item.name,
          reason: REJECTED_REASON[language],
        })),
      ];
      const given = checked.passed.length + new Set(missing.map((m) => m.item)).size;
      if (options.wantedCount !== null && given < options.wantedCount)
        for (let k = given + 1; k <= options.wantedCount; k += 1)
          missing.push({
            field: 'item',
            item: language === 'en' ? `item ${k}` : `第 ${k} 款`,
            reason:
              language === 'en'
                ? `only ${given} of ${options.wantedCount} were given`
                : `答案只给出了 ${given} 款，要求 ${options.wantedCount} 款`,
          });
      if (!checked.passed.length)
        return {
          kind: 'fail',
          reason: renderPriceFailure(missing, language),
        };
      const rendered = renderPriceAnswer({
        language,
        items: checked.passed,
        missing,
        note: result.note,
      });
      const missingItems = [...new Set(missing.map((m) => m.item))];
      return {
        kind: 'deliver',
        summary: rendered.summary,
        evidence: checked.passed
          .map((v) => v.item.quote)
          .join('\n')
          .slice(0, 2000),
        ...(rendered.partial
          ? {
              partial: {
                found: checked.passed.length,
                wanted: checked.passed.length + missingItems.length,
                missing: missingItems.map((m) => shortName(m)).join('、'),
              },
            }
          : {}),
        result,
      };
    },
  };
}

/** The request had images (screenshots) in it: the case where structured output degrades. */
export function hasImages(messages: readonly NeutralMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((block) => block.type === 'image'),
  );
}

const DESCRIBE_PROMPT =
  '逐行写出这些截图里能看到的商品名称、规格和价格，照图上原样写，看不清的写「看不清」，不要推测，不要调用工具。';

/**
 * Structured output with images degraded (the schema check failed twice): two steps. First the
 * screenshots are described as text, then the result is structured from text only (no image in
 * that request). The description is not page text: a quote taken from it fails the check.
 */
export async function twoStepPriceResult(input: {
  adapter: MessagesAdapter;
  system: string;
  messages: readonly NeutralMessage[];
  finishTool: NeutralToolDefinition;
  options?: NeutralMessagesRequestOptions;
}): Promise<Record<string, unknown> | null> {
  const images = input.messages
    .flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.filter((block) => block.type === 'image')
        : [],
    )
    .slice(-2);
  let described = '';
  if (images.length) {
    const seen = await input.adapter.create(
      {
        maxTokens: 1_500,
        system: '你只负责把截图里的文字照原样转写出来。',
        messages: [{ role: 'user', content: [...images, { type: 'text', text: DESCRIBE_PROMPT }] }],
      },
      input.options,
    );
    described = seen.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim();
  }
  // Text only: images out, a text note in their place; tool results stay as read.
  const textOnly: NeutralMessage[] = input.messages.map((message) =>
    Array.isArray(message.content)
      ? {
          ...message,
          content: message.content.map(
            (block): NeutralInputContentBlock =>
              block.type === 'image' ? { type: 'text', text: '[截图已转写为文字，见最后]' } : block,
          ),
        }
      : message,
  );
  const tail: NeutralMessage = {
    role: 'user',
    content: `${
      described ? `截图转写（这不是页面文字，不能作为 quote 或价格来源）：\n${described}\n\n` : ''
    }请只根据本次读到的页面文字调用 finish，按结构填 price_result（没拿到的写进 missing）。`,
  };
  // The failed finish call has no tool result yet: it is left out, the request ends with the user.
  const base = textOnly.at(-1)?.role === 'assistant' ? textOnly.slice(0, -1) : textOnly;
  const last = base.at(-1);
  const messages =
    last?.role === 'user'
      ? [
          ...base.slice(0, -1),
          {
            role: 'user' as const,
            content: [
              ...(typeof last.content === 'string'
                ? [{ type: 'text' as const, text: last.content }]
                : last.content),
              { type: 'text' as const, text: tail.content as string },
            ],
          },
        ]
      : [...base, tail];
  const structured = await input.adapter.create(
    {
      maxTokens: 8_192,
      system: input.system,
      messages,
      tools: [input.finishTool],
      toolChoice: { type: 'tool', name: input.finishTool.name },
    },
    input.options,
  );
  const call = structured.content.find(
    (block) => block.type === 'tool_use' && block.name === input.finishTool.name,
  );
  return call && call.type === 'tool_use' && call.input && typeof call.input === 'object'
    ? (call.input as Record<string, unknown>)
    : null;
}
