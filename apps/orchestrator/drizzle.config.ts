import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
