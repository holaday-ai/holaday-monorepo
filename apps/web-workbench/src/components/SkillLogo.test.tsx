import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkillLogo } from './SkillLogo';

describe('SkillLogo', () => {
  it('renders an original app-logo shell for known skills', () => {
    const html = renderToStaticMarkup(
      <SkillLogo logoId="douyin-live-ops" label="抖音直播与运营" />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="抖音直播与运营"');
    expect(html).toContain('data-logo-id="douyin-live-ops"');
    expect(html).toContain('data-logo-known="true"');
  });

  it('renders a stable fallback for unknown logo ids', () => {
    const html = renderToStaticMarkup(
      <SkillLogo logoId="future-skill" label="未来技能" size="sm" />,
    );

    expect(html).toContain('aria-label="未来技能"');
    expect(html).toContain('data-logo-id="future-skill"');
    expect(html).toContain('data-logo-known="false"');
  });
});
