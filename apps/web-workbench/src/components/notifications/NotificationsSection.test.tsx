import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyBriefingToggle, NotificationToggle } from './NotificationsSection.js';

describe('DailyBriefingToggle', () => {
  it('keeps a stable accessible name while exposing the checked state', () => {
    const enabled = renderToStaticMarkup(
      <DailyBriefingToggle enabled pending={false} onToggle={() => undefined} />,
    );
    const disabled = renderToStaticMarkup(
      <DailyBriefingToggle enabled={false} pending={false} onToggle={() => undefined} />,
    );

    expect(enabled).toContain('aria-label="每日 A股简报"');
    expect(enabled).toContain('checked=""');
    expect(enabled).toContain('title="关闭每日 A股简报"');
    expect(enabled).not.toContain('aria-label="关闭每日 A股简报"');

    expect(disabled).toContain('aria-label="每日 A股简报"');
    expect(disabled).not.toContain('checked=""');
    expect(disabled).toContain('title="开启每日 A股简报"');
    expect(disabled).not.toContain('aria-label="开启每日 A股简报"');
  });

  it('announces the pending state without changing the control name', () => {
    const html = renderToStaticMarkup(
      <DailyBriefingToggle enabled pending onToggle={() => undefined} />,
    );

    expect(html).toContain('aria-label="每日 A股简报"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('title="正在更新每日 A股简报"');
  });

  it('uses the same stable switch semantics for external notification channels', () => {
    const html = renderToStaticMarkup(
      <NotificationToggle
        accessibleName="企业微信通知渠道"
        enabled
        pending={false}
        onToggle={() => undefined}
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="企业微信通知渠道"');
    expect(html).toContain('checked=""');
    expect(html).toContain('title="关闭企业微信通知渠道"');
    expect(html).not.toContain('aria-label="关闭企业微信通知渠道"');
  });
});
