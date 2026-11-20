import type { ModelPriceCatalog } from './model-pricing.js';
/** Official USD list prices. Estimates exclude promotional credits/discounts. */
export const BUILTIN_MODEL_PRICES: ModelPriceCatalog = {
  version: '2026-10-08-list-usd-v1',
  entries: [
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3.8-max', 'qwen3.8-max-0902'],
      region: 'cn',
      unit: 'token',
      tiers: [
        {
          upTo: 1000000,
          input: 1.65,
          output: 4.951,
          cached: 0.206,
          explicitRead: 0.137,
          explicitWrite: 2.063,
        },
      ],
      source: 'https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-8-max',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3.7-plus', 'qwen3.7-plus-2026-05-26'],
      region: 'cn',
      unit: 'token',
      tiers: [
        {
          upTo: 256000,
          input: 0.276,
          output: 1.101,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 1000000,
          input: 0.826,
          output: 3.301,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3.8-flash'],
      region: 'cn',
      unit: 'token',
      tiers: [
        {
          upTo: 1000000,
          input: 0.113,
          output: 0.382,
          cached: 0.014,
          explicitRead: 0.014,
          explicitWrite: 0.177,
        },
      ],
      source: 'https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-8-flash',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen-image-2.0-pro'],
      region: 'cn',
      unit: 'image',
      tiers: [
        {
          rate: 0.071676,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['wan2.7-image'],
      region: 'cn',
      unit: 'image',
      tiers: [
        {
          rate: 0.027504,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['wan2.7-t2v', 'wan2.7-i2v', 'wan2.7-t2v-2026-06-12', 'wan2.7-t2v-2026-04-25'],
      region: 'cn',
      unit: 'second',
      tiers: [
        {
          resolution: '720p',
          rate: 0.086012,
        },
        {
          resolution: '1080p',
          rate: 0.143353,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3-tts-vc-2026-01-22'],
      region: 'cn',
      unit: 'character',
      tiers: [
        {
          rate: 1.15e-5,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3.8-max', 'qwen3.8-max-0902'],
      region: 'intl',
      unit: 'token',
      tiers: [
        {
          upTo: 1000000,
          input: 2,
          output: 6,
          cached: 0.25,
          explicitRead: 0.17,
          explicitWrite: 2.5,
        },
      ],
      source: 'https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-8-max',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3.7-plus', 'qwen3.7-plus-2026-05-26'],
      region: 'intl',
      unit: 'token',
      tiers: [
        {
          upTo: 256000,
          input: 0.4,
          output: 1.6,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 1000000,
          input: 1.2,
          output: 4.8,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3.8-flash'],
      region: 'intl',
      unit: 'token',
      tiers: [
        {
          upTo: 1000000,
          input: 0.15,
          output: 0.47,
          cached: 0.016,
          explicitRead: 0.016,
          explicitWrite: 0.2,
        },
      ],
      source: 'https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-8-flash',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen-image-2.0-pro'],
      region: 'intl',
      unit: 'image',
      tiers: [
        {
          rate: 0.075,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['wan2.7-image'],
      region: 'intl',
      unit: 'image',
      tiers: [
        {
          rate: 0.03,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['wan2.7-t2v', 'wan2.7-i2v', 'wan2.7-t2v-2026-06-12', 'wan2.7-t2v-2026-04-25'],
      region: 'intl',
      unit: 'second',
      tiers: [
        {
          resolution: '720p',
          rate: 0.1,
        },
        {
          resolution: '1080p',
          rate: 0.15,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3-tts-vc-2026-01-22'],
      region: 'intl',
      unit: 'character',
      tiers: [
        {
          rate: 1.15e-5,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3-coder-plus', 'qwen3-coder-plus-2025-09-23', 'qwen3-coder-plus-2025-07-22'],
      region: 'cn',
      unit: 'token',
      tiers: [
        {
          upTo: 32000,
          input: 0.574,
          output: 2.294,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 128000,
          input: 0.861,
          output: 3.441,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 256000,
          input: 1.434,
          output: 5.735,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 1000000,
          input: 2.868,
          output: 28.671,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3-tts-flash', 'qwen3-tts-flash-2025-11-27', 'qwen3-tts-flash-2025-09-18'],
      region: 'cn',
      unit: 'character',
      tiers: [
        {
          rate: 1.1468200000000001e-5,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3-coder-plus', 'qwen3-coder-plus-2025-09-23', 'qwen3-coder-plus-2025-07-22'],
      region: 'intl',
      unit: 'token',
      tiers: [
        {
          upTo: 32000,
          input: 1,
          output: 5,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 128000,
          input: 1.8,
          output: 9,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 256000,
          input: 3,
          output: 15,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
        {
          upTo: 1000000,
          input: 6,
          output: 60,
          implicitCache: 0.2,
          explicitReadRatio: 0.1,
          explicitWriteRatio: 1.25,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['qwen3-tts-flash', 'qwen3-tts-flash-2025-11-27', 'qwen3-tts-flash-2025-09-18'],
      region: 'intl',
      unit: 'character',
      tiers: [
        {
          rate: 1e-5,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'fal',
      models: ['fal-ai/veo3.1/fast', 'fal-ai/veo3.1/fast/first-last-frame-to-video'],
      region: 'any',
      unit: 'second',
      tiers: [
        {
          resolution: '720p',
          audio: false,
          rate: 0.1,
        },
        {
          resolution: '720p',
          audio: true,
          rate: 0.15,
        },
        {
          resolution: '1080p',
          audio: false,
          rate: 0.1,
        },
        {
          resolution: '1080p',
          audio: true,
          rate: 0.15,
        },
        {
          resolution: '4k',
          audio: false,
          rate: 0.3,
        },
        {
          resolution: '4k',
          audio: true,
          rate: 0.35,
        },
      ],
      source: 'https://fal.ai/models/fal-ai/veo3.1/fast',
    },
    {
      provider: 'fal',
      models: ['fal-ai/veo3.1', 'fal-ai/veo3.1/first-last-frame-to-video'],
      region: 'any',
      unit: 'second',
      tiers: [
        {
          resolution: '720p',
          audio: false,
          rate: 0.2,
        },
        {
          resolution: '720p',
          audio: true,
          rate: 0.4,
        },
        {
          resolution: '1080p',
          audio: false,
          rate: 0.2,
        },
        {
          resolution: '1080p',
          audio: true,
          rate: 0.4,
        },
        {
          resolution: '4k',
          audio: false,
          rate: 0.4,
        },
        {
          resolution: '4k',
          audio: true,
          rate: 0.6,
        },
      ],
      source: 'https://fal.ai/models/fal-ai/veo3.1',
    },
    {
      provider: 'fal',
      models: ['fal-ai/veo3.1/lite', 'fal-ai/veo3.1/lite/first-last-frame-to-video'],
      region: 'any',
      unit: 'second',
      tiers: [
        {
          resolution: '720p',
          audio: false,
          rate: 0.03,
        },
        {
          resolution: '720p',
          audio: true,
          rate: 0.05,
        },
        {
          resolution: '1080p',
          audio: false,
          rate: 0.05,
        },
        {
          resolution: '1080p',
          audio: true,
          rate: 0.08,
        },
      ],
      source: 'https://fal.ai/learn/tools/grok-imagine-vs-veo-3-1',
    },
    {
      provider: 'fal',
      models: ['fal-ai/sync-lipsync/v3'],
      region: 'any',
      unit: 'second',
      tiers: [
        {
          rate: 0.13333333333333333,
        },
      ],
      source: 'https://fal.ai/models/fal-ai/sync-lipsync/v3',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['wan2.2-animate-mix'],
      region: 'cn',
      unit: 'second',
      tiers: [
        {
          mode: 'wan-std',
          rate: 0.09,
        },
        {
          mode: 'wan-pro',
          rate: 0.13,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'alibaba-model-studio',
      models: ['wan2.2-animate-mix'],
      region: 'intl',
      unit: 'second',
      tiers: [
        {
          mode: 'wan-std',
          rate: 0.18,
        },
        {
          mode: 'wan-pro',
          rate: 0.26,
        },
      ],
      source: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    },
    {
      provider: 'fal',
      models: ['fal-ai/nano-banana-2', 'fal-ai/nano-banana-2/edit'],
      region: 'any',
      unit: 'image',
      tiers: [
        {
          resolution: '0.5K',
          rate: 0.06,
        },
        {
          resolution: '1K',
          rate: 0.08,
        },
        {
          resolution: '2K',
          rate: 0.12,
        },
        {
          resolution: '4K',
          rate: 0.16,
        },
      ],
      source: 'https://fal.ai/models/fal-ai/nano-banana-2',
    },
  ],
};
