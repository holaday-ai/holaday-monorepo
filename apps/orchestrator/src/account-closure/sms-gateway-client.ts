import type { AccountClosureChallengeAction } from './types.js';

export interface SmsGatewayClientOptions {
  baseUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
}

export class SmsGatewayClient {
  private readonly baseUrl: string;
  private readonly internalSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SmsGatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalSecret = options.internalSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendAccountClosureCode(
    rawPhone: string,
    code: string,
    action: AccountClosureChallengeAction,
  ): Promise<void> {
    await this.send('/api/internal/account-closure/code', {
      phone: rawPhone,
      code,
      action,
    });
  }

  async sendAccountClosureComplete(
    rawPhone: string,
    receiptNumber: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    await this.send(
      '/api/internal/account-closure/complete',
      {
        phone: rawPhone,
        receiptNumber,
      },
      options,
    );
  }

  private async send(
    path: string,
    body: Record<string, string>,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.internalSecret,
        },
        body: JSON.stringify(body),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Account closure SMS delivery failed');
    }
    if (!response.ok) {
      throw new Error('Account closure SMS delivery failed');
    }
  }
}
