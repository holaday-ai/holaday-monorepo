// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PrivacyPage } from './PrivacyPage';

function renderPrivacy(): void {
  render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>,
  );
}

function expectText(pattern: RegExp): void {
  expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);
}

afterEach(cleanup);

describe('PrivacyPage truth contract', () => {
  it('separates plan visibility from server deletion and describes sensitive extension data', () => {
    renderPrivacy();

    expectText(/7\/30\/90 天.*可见范围/);
    expectText(/不是服务器删除期限/);
    expectText(/不上传完整 URL、查询参数、网页标题或历史页面正文/);
    expectText(/真实 Cookie 值/);
    expectText(/服务端白名单/);
    expectText(/登录扩展后自动同步/);
    expectText(/服务器连接成功/);
    expectText(/约每 30 分钟/);
    expectText(/固定同步域名清单/);
    expectText(/Cookie 名称、值、域名、路径/);
    expectText(/当前没有逐站点开关/);
    expectText(/退出 HOLA DAY 登录、停用或卸载扩展/);
  });

  it('describes feature-dependent external processing and a mail-based rights request', () => {
    renderPrivacy();

    expectText(/取决于您使用的功能和当时启用的服务/);
    expectText(/可能在中国大陆以外处理/);
    expectText(/Apify/);
    expectText(/网页地址与检索条件/);
    expectText(/Zapier/);
    expectText(/任务指令和任务标识/);
    expectText(/跨平台自动化/);
    const privacyLinks = screen.getAllByRole('link', { name: 'privacy@holaday.ai' });
    expect(privacyLinks.length).toBeGreaterThan(0);
    for (const link of privacyLinks) {
      expect(link.getAttribute('href')).toBe('mailto:privacy@holaday.ai');
    }
    expectText(/邮件是申请入口，不代表即时或自动完成/);
    expectText(/交易、安全、争议或审计记录/);
  });

  it('discloses automatic cross-task memory, retention, reuse, and deletion controls', () => {
    renderPrivacy();

    expectText(/跨任务 AI 记忆/);
    expectText(/任务指令与结果摘要/);
    expectText(/后续相关任务/);
    expectText(/偏好可能长期保留/);
    expectText(/逐条删除或清空全部/);
  });

  it('discloses feedback content and context forwarded through Resend or service logs', () => {
    renderPrivacy();

    expectText(/反馈与支持/);
    expectText(/您主动提交的自由文本/);
    expectText(/账号邮箱、账号标识、User-Agent 与可选的关联任务标识/);
    expectText(/启用 Resend 时转发给 Resend/);
    expectText(/否则可能进入服务日志/);
    expectText(/处理反馈、故障、安全和争议所需/);
  });

  it('discloses external notification webhook configuration and task context transfers', () => {
    renderPrivacy();

    expectText(/外部通知渠道/);
    expectText(/webhook 地址和模板/);
    expectText(/通知标题、正文、状态/);
    expectText(/最多 60 字的定时任务意图/);
    expectText(/企业微信、飞书、钉钉或自定义 webhook/);
    expectText(/修改或删除渠道配置/);
  });

  it('states the implemented account and payment boundaries', () => {
    renderPrivacy();

    expectText(/不可逆单向哈希/);
    expectText(/付款邮箱/);
    expectText(/不直接保存银行卡号、CVV 或第三方支付账户密码/);
    expectText(/每次付款只购买所选周期/);
    expectText(/不会自动扣款/);
  });

  it('does not repeat unsupported privacy promises', () => {
    renderPrivacy();
    const body = document.body.textContent ?? '';

    for (const forbidden of [
      '服务器主要位于中国大陆',
      'Pro 永久',
      '日志默认保留 90 天',
      '密码（加密存储）',
      '持续使用本服务即视为接受',
      '完全合规',
      '按月自动续费',
      '您授权的白名单网站',
      '由您授权的网站 Cookie',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('provides a concise summary, unique section anchors, and a data table', () => {
    renderPrivacy();

    expect(screen.getByRole('heading', { name: '先看重点' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: '隐私政策目录' });
    expect(within(nav).getByRole('link', { name: '我们处理什么' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: '浏览器扩展' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: '第三方与跨境' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: '保存与删除' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'HOLA DAY 个人信息处理说明' })).toBeTruthy();

    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
