import { describe, expect, it, vi } from 'vitest';
import { SmsGatewayClient } from './sms-gateway-client.js';

describe('SmsGatewayClient', () => {
  it('sends a closure code only through the authenticated internal delivery route', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = new SmsGatewayClient({
      baseUrl: 'https://sms-gateway.test/',
      internalSecret: 'internal-secret-value',
      fetchImpl,
    });

    await client.sendAccountClosureCode('13800138000', '482901', 'cancel');

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://sms-gateway.test/api/internal/account-closure/code');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': 'internal-secret-value',
      },
      body: JSON.stringify({ phone: '13800138000', code: '482901', action: 'cancel' }),
    });
  });

  it('sends completion receipts through their distinct internal route', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = new SmsGatewayClient({
      baseUrl: 'https://sms-gateway.test',
      internalSecret: 'internal-secret-value',
      fetchImpl,
    });

    await client.sendAccountClosureComplete('13900139000', 'ACL-RCPT-7');

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://sms-gateway.test/api/internal/account-closure/complete');
    expect(init?.body).toBe(JSON.stringify({ phone: '13900139000', receiptNumber: 'ACL-RCPT-7' }));
  });

  it('returns a generic delivery error without exposing a rejected response payload', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('provider rejected phone=13800138000 code=482901', { status: 502 }),
    );
    const client = new SmsGatewayClient({
      baseUrl: 'https://sms-gateway.test',
      internalSecret: 'internal-secret-value',
      fetchImpl,
    });

    await expect(client.sendAccountClosureCode('13800138000', '482901', 'begin')).rejects.toThrow(
      'Account closure SMS delivery failed',
    );
  });
});
