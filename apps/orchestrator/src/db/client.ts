import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: 20,
  timezone: 'Z',
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
});

export const db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' });

export type DB = typeof db;
