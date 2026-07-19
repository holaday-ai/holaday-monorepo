import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { CDPSession } from 'playwright';
import { CdpInputHandler } from './cdp-input.js';

function handlerWithSend() {
  const send = vi.fn().mockResolvedValue(undefined);
  const session = { send } as unknown as CDPSession;
  return {
    send,
    handler: new CdpInputHandler(() => session, pino({ level: 'silent' })),
  };
}

describe('CdpInputHandler responsive viewport', () => {
  it('reflows the remote page to the visible browser workspace', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({ type: 'viewport', width: 612, height: 844 });

    expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', {
      width: 612,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 612,
      screenHeight: 844,
    });
  });

  it('drops invalid or abusive viewport messages', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({ type: 'viewport', width: 0, height: 844 });
    await handler.handle({ type: 'viewport', width: 10_000, height: 844 });
    await handler.handle({ type: 'viewport', width: 612, height: Number.NaN });

    expect(send).not.toHaveBeenCalled();
  });
});
