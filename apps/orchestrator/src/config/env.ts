import 'dotenv/config';
import { z } from 'zod';

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
