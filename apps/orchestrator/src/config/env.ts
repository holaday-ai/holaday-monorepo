import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load order (later overrides earlier — we explicitly do NOT override
// already-set process.env values so CI / docker-compose env vars win):
//   1. .env                          (committed defaults — may be empty)
//   2. .env.local                    (developer secrets, gitignored)
//   3. apps/orchestrator/.env.local  (per-app override, gitignored)
const repoRoot = resolve(process.cwd(), '../..');
loadDotenv({ path: resolve(repoRoot, '.env'), override: false });
loadDotenv({ path: resolve(repoRoot, '.env.local'), override: false });
loadDotenv({ path: resolve(process.cwd(), '.env.local'), override: false });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  HTTP_PORT: z.coerce.number().int().positive().default(3001),
  WS_PORT: z.coerce.number().int().positive().default(3002),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),

  ANTHROPIC_API_KEY: z.string().optional().default(''),

  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
