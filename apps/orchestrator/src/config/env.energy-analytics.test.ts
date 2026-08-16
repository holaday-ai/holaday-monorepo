import { describe, expect, it } from 'vitest';
import * as envModule from './env.js';

interface ParseableSchema {
  parse: (input: Record<string, unknown>) => Record<string, unknown>;
}

const BASE_ENV = {
  DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
};

function schema(): ParseableSchema | undefined {
  return (envModule as Record<string, unknown>).envSchema as ParseableSchema | undefined;
}

describe('energy analytics environment contract', () => {
  it('defaults analytics writes off with bounded retention', () => {
    const parser = schema();
    expect(parser).toBeDefined();
    if (!parser) return;

    expect(parser.parse(BASE_ENV)).toMatchObject({
      ENERGY_ANALYTICS_ENABLED: false,
      ENERGY_ANALYTICS_HMAC_SECRET: '',
      ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS: 30,
      ENERGY_ANALYTICS_METRIC_RETENTION_DAYS: 400,
      ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS: 48,
    });
  });

  it.each([
    ['ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS', 31],
    ['ENERGY_ANALYTICS_METRIC_RETENTION_DAYS', 401],
    ['ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS', 49],
    ['ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS', 0],
  ])('rejects unsafe %s value %s', (name, value) => {
    const parser = schema();
    expect(parser).toBeDefined();
    if (!parser) return;

    expect(() => parser.parse({ ...BASE_ENV, [name]: value })).toThrow();
  });

  it('rejects a non-empty HMAC secret shorter than 32 characters', () => {
    const parser = schema();
    expect(parser).toBeDefined();
    if (!parser) return;

    expect(() =>
      parser.parse({ ...BASE_ENV, ENERGY_ANALYTICS_HMAC_SECRET: 'too-short' }),
    ).toThrow(/at least 32/i);
  });

  it('accepts shorter privacy retention and a dedicated high-entropy secret', () => {
    const parser = schema();
    expect(parser).toBeDefined();
    if (!parser) return;

    expect(
      parser.parse({
        ...BASE_ENV,
        ENERGY_ANALYTICS_ENABLED: 'true',
        ENERGY_ANALYTICS_HMAC_SECRET: '0123456789abcdef0123456789abcdef',
        ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS: 14,
        ENERGY_ANALYTICS_METRIC_RETENTION_DAYS: 365,
        ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS: 24,
      }),
    ).toMatchObject({
      ENERGY_ANALYTICS_ENABLED: true,
      ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS: 14,
      ENERGY_ANALYTICS_METRIC_RETENTION_DAYS: 365,
      ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS: 24,
    });
  });
});
