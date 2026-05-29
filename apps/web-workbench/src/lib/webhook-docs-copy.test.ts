import { describe, expect, it } from 'vitest';
import { webhookCurlExample } from './webhook-docs-copy';

describe('webhook docs copy', () => {
  it('builds a retry-safe curl example for the current webhook URL', () => {
    const example = webhookCurlExample('https://hd-app.orangebench.tech/api/webhooks/tasks');

    expect(example).toContain('curl -X POST https://hd-app.orangebench.tech/api/webhooks/tasks');
    expect(example).toContain('Authorization: Bearer hd_live_xxxxxxxxxxxxxxxxxxxxxxxx');
    expect(example).toContain('Idempotency-Key: my-unique-key-001');
    expect(example).toContain('Content-Type: application/json');
    expect(example).toContain('{"prompt":"帮我查一下今天的科技新闻"}');
  });
});
