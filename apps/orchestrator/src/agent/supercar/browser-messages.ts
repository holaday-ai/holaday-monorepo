import type Anthropic from '@anthropic-ai/sdk';
import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralInputContentBlock,
  type NeutralMessagesRequest,
  type NeutralMessagesRequestOptions,
  serializeMessagesRequest,
} from '../../llm/messages-adapter.js';
import { NORMALIZED_COORDINATE_PROMPT } from './browser-coordinates.js';

export type BrowserModelResponse = Pick<
  Anthropic.Beta.BetaMessage,
  'content' | 'stop_reason' | 'container'
> & {
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

const tuple = (length: number, normalized: boolean) => ({
  type: 'array',
  items: { type: 'number', minimum: 0, ...(normalized ? { maximum: 1000 } : {}) },
  minItems: length,
  maxItems: length,
});

function computerTool(width: number, height: number, normalized: boolean) {
  return {
    name: 'computer',
    description: `操作当前网页。截图尺寸 ${width}×${height}；${normalized ? NORMALIZED_COORDINATE_PROMPT : '坐标使用截图原始像素，左上角为 (0,0)。'}每次操作后读取新截图。导航使用 navigate；截图不含浏览器地址栏。key/hold_key 的按键组合放在 text，wait/hold_key 的 duration 单位为秒。scroll_amount 为滚动步数。`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'screenshot',
            'left_click',
            'right_click',
            'middle_click',
            'double_click',
            'triple_click',
            'type',
            'key',
            'hold_key',
            'mouse_move',
            'left_mouse_down',
            'left_mouse_up',
            'left_click_drag',
            'scroll',
            'wait',
          ],
        },
        coordinate: tuple(2, normalized),
        start_coordinate: tuple(2, normalized),
        text: { type: 'string' },
        key: { type: 'string' },
        duration: { type: 'number', minimum: 0, maximum: 10 },
        scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        scroll_amount: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['action'],
      additionalProperties: false,
    },
  };
}

function contentBlocks(
  content:
    | Anthropic.Beta.BetaMessageParam['content']
    | Anthropic.Beta.BetaToolResultBlockParam['content'],
  protectedImages?: Set<NeutralInputContentBlock>,
): string | NeutralInputContentBlock[] {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  const blocks: NeutralInputContentBlock[] = [];
  const screenshots: NeutralInputContentBlock[] = [];
  for (const block of content) {
    if (block.type === 'text') blocks.push({ type: 'text', text: block.text });
    else if (block.type === 'image' && block.source.type === 'base64') {
      const converted = {
        type: 'image' as const,
        source: {
          kind: 'base64' as const,
          mediaType: block.source.media_type,
          data: block.source.data,
        },
      };
      blocks.push(converted);
      protectedImages?.add(converted);
    } else if (block.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    } else if (block.type === 'tool_result') {
      const result = contentBlocks(block.content ?? '');
      const parts = typeof result === 'string' ? [{ type: 'text' as const, text: result }] : result;
      const images = parts.filter((part) => part.type === 'image');
      const text = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      blocks.push({
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content: text || '操作已返回。',
        isError: block.is_error,
      });
      if (images.length)
        screenshots.push(
          { type: 'text', text: `工具 ${block.tool_use_id} 返回的页面截图：` },
          ...images,
        );
    } else {
      // Never silently erase attachments or provider-specific history.
      throw new MessagesAdapterError(
        'INVALID_REQUEST',
        `Unsupported browser content: ${block.type}`,
      );
    }
  }
  // Keep tool replies together before the images, preserving call correlation.
  return [...blocks, ...screenshots];
}

export async function createBrowserMessage(
  adapter: MessagesAdapter,
  input: Anthropic.Beta.MessageCreateParamsNonStreaming,
  options: NeutralMessagesRequestOptions,
): Promise<BrowserModelResponse> {
  const tools = (input.tools ?? []).flatMap((tool) => {
    if (tool.type === 'computer_20251124')
      return [
        computerTool(
          tool.display_width_px,
          tool.display_height_px,
          adapter.metadata.provider === 'alibaba-model-studio',
        ),
      ];
    if ('input_schema' in tool)
      return [
        {
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.input_schema as Record<string, unknown>,
        },
      ];
    return []; // No Anthropic server-side web_search/container in this runner.
  });
  const system =
    typeof input.system === 'string'
      ? input.system
      : (input.system ?? []).map((block) => block.text).join('\n');
  const protectedImages = new Set<NeutralInputContentBlock>();
  const request: NeutralMessagesRequest = {
    maxTokens: input.max_tokens,
    system: `${system}\n当前运行环境以实际 tools 列表为准。没有内置 web_search；需要搜索时通过 navigate 打开搜索页面并操作浏览器。只调用已提供的工具。`,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: contentBlocks(message.content, protectedImages),
    })),
    tools,
  };
  // Retain latest observations, not every full-resolution frame for 50 turns.
  // Replace only images; all user text and paired tool results remain intact.
  const images = request.messages.flatMap((message) =>
    typeof message.content === 'string'
      ? []
      : message.content.filter((block) => block.type === 'image'),
  );
  let bytes = images
    .filter((block) => protectedImages.has(block))
    .reduce((sum, block) => sum + block.source.data.length, 0);
  if (bytes > 4_000_000)
    throw new MessagesAdapterError(
      'INVALID_REQUEST',
      'Browser reference images exceed request budget',
    );
  const keep = new Set(protectedImages);
  let frameCount = 0;
  for (const block of [...images].reverse().filter((block) => !protectedImages.has(block))) {
    if (frameCount < 3 && bytes + block.source.data.length <= 4_000_000) {
      keep.add(block);
      bytes += block.source.data.length;
      frameCount++;
    } else if (frameCount === 0) {
      throw new MessagesAdapterError(
        'INVALID_REQUEST',
        'Latest browser image exceeds request budget',
      );
    }
  }
  request.messages = request.messages.map((message) => ({
    ...message,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((block) =>
            block.type === 'image' && !keep.has(block)
              ? {
                  type: 'text' as const,
                  text: '[较早的截图已移出视觉上下文，操作记录保留；如需旧页面请重新观察。]',
                }
              : block,
          ),
  }));
  if (adapter.metadata.provider === 'alibaba-model-studio') {
    // The Messages-compatible endpoint accepts mixed tool_result/image blocks,
    // but live probes failed to read those images. A separate user observation
    // preserves all paired tool replies and makes both independent fixtures readable.
    request.messages = request.messages.flatMap((message) => {
      const content = message.content;
      if (
        message.role !== 'user' ||
        typeof content === 'string' ||
        !content.some((block) => block.type === 'tool_result') ||
        !content.some((block) => block.type === 'image')
      )
        return [message];
      return [
        { role: 'user' as const, content: content.filter((block) => block.type === 'tool_result') },
        { role: 'user' as const, content: content.filter((block) => block.type !== 'tool_result') },
      ];
    });
  }
  if (Buffer.byteLength(serializeMessagesRequest(request, adapter.metadata), 'utf8') > 5_500_000) {
    throw new MessagesAdapterError(
      'INVALID_REQUEST',
      'Browser conversation exceeds request budget',
    );
  }
  const result = await adapter.create(request, options);
  return {
    content: result.content.map((block) =>
      block.type === 'text'
        ? { ...block, citations: null }
        : { ...block, input: block.input as Record<string, unknown> },
    ),
    stop_reason: result.stopReason === 'unknown' ? null : result.stopReason,
    container: null,
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      cache_read_input_tokens: result.usage.cacheReadInputTokens,
      cache_creation_input_tokens: result.usage.cacheCreationInputTokens,
    },
  };
}
