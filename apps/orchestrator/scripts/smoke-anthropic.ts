#!/usr/bin/env tsx
/**
 * Anthropic API smoke test — minimal, cheap, single call.
 *
 * Goals:
 *   1. Confirm ANTHROPIC_API_KEY is valid.
 *   2. Confirm the response shape matches what AnthropicPlanner relies on.
 *
 * Explicitly uses **claude-haiku-4-5** — cheapest tier. Do NOT swap for Opus
 * just to reuse the planner's prompt; smoke should stay under a cent.
 *
 * Usage (from repo root):
 *   pnpm --filter @holaday/orchestrator smoke-anthropic
 */
import Anthropic from '@anthropic-ai/sdk';
import '../src/config/env.js'; // load .env / .env.local via the shared loader

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 256;

interface SmokeResult {
  ok: boolean;
  model: string;
  stopReason: string | null;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  elapsedMs: number;
}

async function main(): Promise<SmokeResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing — set it in .env.local');
  }

  const client = new Anthropic();
  const started = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly one word: "ok". No punctuation, no other text.',
      },
    ],
  });

  const elapsedMs = Date.now() - started;
  const firstText = response.content.find((b) => b.type === 'text');
  const text = firstText?.type === 'text' ? firstText.text : '';

  return {
    ok: true,
    model: response.model,
    stopReason: response.stop_reason,
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
    elapsedMs,
  };
}

main()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
  })
  .catch((err) => {
    if (err instanceof Anthropic.APIError) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            status: err.status,
            name: err.name,
            message: err.message,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
