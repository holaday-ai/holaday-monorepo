import { describe, expect, it } from 'vitest';
import { SUPPORT_EMAIL, supportMailtoHref } from './support-links';

describe('support links', () => {
  it('builds encoded mailto links for support actions', () => {
    const href = supportMailtoHref({
      subject: '删除 HOLA DAY 账号',
      body: '注册邮箱：user@example.com',
    });

    expect(href).toContain(`mailto:${SUPPORT_EMAIL}?`);
    expect(href).toContain('subject=%E5%88%A0%E9%99%A4+HOLA+DAY+%E8%B4%A6%E5%8F%B7');
    expect(href).toContain('body=%E6%B3%A8%E5%86%8C%E9%82%AE%E7%AE%B1%EF%BC%9Auser%40example.com');
  });

  it('omits an empty body parameter', () => {
    expect(supportMailtoHref({ subject: '取消 HOLA DAY 订阅' })).toBe(
      `mailto:${SUPPORT_EMAIL}?subject=%E5%8F%96%E6%B6%88+HOLA+DAY+%E8%AE%A2%E9%98%85`,
    );
  });
});
