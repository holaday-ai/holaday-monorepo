import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load order (later overrides earlier — we explicitly do NOT override
// already-set process.env values so CI / docker-compose env vars win):
//   1. .env                          (committed defaults — may be empty)
//   2. .env.local                    (developer secrets, gitignored)
//   3. apps/orchestrator/.env.local  (per-app override, gitignored)
//
// Empty-string values in process.env are treated as unset. Some parent
// processes (e.g. Claude Code) scrub secrets by exporting them as '' to
// child processes; without this, dotenv's `override: false` would keep
// the empty string and mask the .env.local value.
function loadDotenvAllowingEmpty(path: string) {
  const result = loadDotenv({ path, override: false });
  if (result.parsed) {
    for (const [key, value] of Object.entries(result.parsed)) {
      if (process.env[key] === '') process.env[key] = value;
    }
  }
}
const repoRoot = resolve(process.cwd(), '../..');
loadDotenvAllowingEmpty(resolve(repoRoot, '.env'));
loadDotenvAllowingEmpty(resolve(repoRoot, '.env.local'));
loadDotenvAllowingEmpty(resolve(process.cwd(), '.env.local'));

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
