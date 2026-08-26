import { z } from 'zod';

/**
 * Env schema for the CN payment gateway. Every credential is optional
 * at the type level so the service can boot in "scaffold" mode (e.g.
 * before BOSS hands over WX certs) and surface clear /healthz output
 * without crashing. Each adapter (wechat-pay.ts / alipay.ts) checks
 * its own creds at request time and returns a typed
 * `provider_not_configured` error when missing.
 */
const EnvBase = z.object({
  NODE_ENV: z.string().default('production'),
  PORT: z.coerce.number().default(4010),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_ORIGIN: z.string().url().default('https://hd-pay.orangebench.tech'),
  APP_ORIGIN: z.string().url().default('https://hd-app.orangebench.tech'),

  VULTR_INTERNAL_URL: z.string().url(),
  INTERNAL_SHARED_SECRET: z.string().min(16),

  // WeChat — every value optional so missing creds just disable the lane
  WX_APPID: z.string().optional(),
  WX_MCHID: z.string().optional(),
  WX_API_V3_KEY: z.string().optional(),
  WX_CERT_PATH: z.string().optional(),
  WX_KEY_PATH: z.string().optional(),
  WX_PLATFORM_CERT_PATH: z.string().optional(),
  WX_PUBLIC_KEY_ID: z.string().optional(),
  WX_PUBLIC_KEY_PATH: z.string().optional(),

  // Alipay
  ALIPAY_APPID: z.string().optional(),
  ALIPAY_PRIVATE_KEY: z.string().optional(),
  ALIPAY_PUBLIC_KEY: z.string().optional(),
  ALIPAY_SELLER_ID: z.string().optional(),
  ALIPAY_MODE: z.enum(['sandbox', 'production']).default('production'),

  VULTR_SYNC_TIMEOUT_MS: z.coerce.number().int().positive().max(10_000).default(3_500),

  // Phase 12 — Aliyun SMS. All four required for the SMS lane to
  // boot; if any are missing, /api/sms/send returns a typed
  // sms_not_configured 503 instead of crashing.
  ALIYUN_ACCESS_KEY_ID: z.string().optional(),
  ALIYUN_ACCESS_KEY_SECRET: z.string().optional(),
  ALIYUN_SMS_SIGN_NAME: z.string().optional(),
  ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
  ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE: z.string().optional(),
  ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE: z.string().optional(),
});

const Env = EnvBase.superRefine((value, context) => {
  if (value.NODE_ENV !== 'production' || !value.ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED) return;
  for (const key of [
    'ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE',
    'ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE',
  ] as const) {
    if (!value[key]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when production Aliyun SMS is enabled`,
      });
    }
  }
});

type ParsedEnv = z.infer<typeof Env>;
export type Env = Omit<ParsedEnv, 'ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED'> & {
  ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED?: boolean;
};

let cached: ParsedEnv | null = null;

/**
 * Lazy parse so a misformatted env file doesn't block the test
 * harness from importing modules. Called by index.ts at boot.
 */
export function loadEnv(): ParsedEnv {
  if (cached) return cached;
  cached = Env.parse(process.env);
  return cached;
}
