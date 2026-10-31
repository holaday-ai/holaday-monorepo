import { describe, expect, it } from 'vitest';
import { friendlyTaskFailureReason, modelTaskFailureReason } from './task-failure-copy.js';

describe('friendlyTaskFailureReason', () => {
  it('explains unsupported file formats without suggesting an ineffective retry or upgrade', () => {
    const reason = friendlyTaskFailureReason('failed', 'FILE_FORMAT_UNSUPPORTED:zip,rar');
    expect(reason).toContain('不支持 ZIP、RAR');
    expect(reason).toContain('升级套餐无法解决');
    expect(reason).not.toMatch(/简化|重试|请升级/);
  });
  it('uses stable Qwen migration reason codes without provider details', () => {
    expect(modelTaskFailureReason('MODEL_DATA_REGION_UNASSIGNED')).toBe(
      '请先选择模型数据区域，再开始任务。',
    );
    expect(modelTaskFailureReason('MODEL_MIGRATION_IN_PROGRESS')).toBe(
      '这项能力正在迁移到千问，暂时不可用。',
    );
  });
  it('keeps known browser failures specific', () => {
    expect(
      friendlyTaskFailureReason(
        'failed',
        'Cannot access contents of url. Extension manifest must request permission.',
      ),
    ).toBe('浏览器扩展缺少当前网站权限。请在扩展里允许访问该网站后重试。');
  });

  it('keeps known quota and auth failures actionable', () => {
    expect(friendlyTaskFailureReason('failed', 'Anthropic API error: 429 too many requests')).toBe(
      'AI 服务当前繁忙（限速），请稍后再试。',
    );
    expect(friendlyTaskFailureReason('failed', 'missing ANTHROPIC_API_KEY')).toBe(
      'AI 服务未配置。请联系管理员检查部署。',
    );
  });

  it('does not leak raw English stack-like failures', () => {
    expect(
      friendlyTaskFailureReason(
        'failed',
        'TypeError: Cannot read properties of undefined\n    at runTask (file:///app/runner.js:10:2)',
      ),
    ).toBe('任务执行出错。请重试；如果反复出现，请联系 support@holaday.ai。');
  });

  it('turns supercar timeout sentinels into user-facing copy', () => {
    expect(friendlyTaskFailureReason('failed', 'VISION_GAVE_UP task timeout (600s) elapsed')).toBe(
      '任务超时。可能原因：目标网站响应缓慢或被反爬拦截。建议：重试，或把任务描述简化后再试。',
    );
  });

  it('does not leak unknown English technical failures', () => {
    expect(friendlyTaskFailureReason('failed', 'Unexpected protocol invariant violation')).toBe(
      '任务执行出错。请重试；如果反复出现，请联系 support@holaday.ai。',
    );
  });

  it('preserves non-technical localized reasons', () => {
    expect(friendlyTaskFailureReason('failed', '输入内容缺少店铺名称')).toBe(
      '任务执行失败：输入内容缺少店铺名称。建议：简化任务描述后重试。',
    );
  });

  // Travel QA 2026-06-09 — Google Hotels/Maps timed out and the agent
  // loop's "请求处理时间过长，正在重试。" sentinel fell through to the
  // generic branch, surfacing a double period and a vague reason.
  it('classifies the "时间过长" deadline sentinel as a timeout', () => {
    expect(friendlyTaskFailureReason('failed', '请求处理时间过长，正在重试。')).toBe(
      '任务超时。可能原因：目标网站响应缓慢或被反爬拦截。建议：重试，或把任务描述简化后再试。',
    );
  });

  it('does not double the trailing period when a raw reason ends in 。', () => {
    expect(friendlyTaskFailureReason('failed', '输入内容缺少店铺名称。')).toBe(
      '任务执行失败：输入内容缺少店铺名称。建议：简化任务描述后重试。',
    );
    // The exact QA sentinel — would have rendered "…正在重试。。建议…"
    // before the fix; now it's classified as a timeout (above), but the
    // generic path must still never double up.
    expect(friendlyTaskFailureReason('failed', '操作未完成，请稍后再试。')).toBe(
      '任务执行失败：操作未完成，请稍后再试。建议：简化任务描述后重试。',
    );
  });
  it('never reports a login wall from a blank browser or a negated login diagnosis', () => {
    expect(friendlyTaskFailureReason('failed', 'about:blank；无法确认是否需要登录')).not.toContain(
      '该网站需要登录',
    );
  });
});

/** FAILURE-COPY-1: the copy follows where the failure came from. */
describe('failure copy by source', () => {
  it('a model call failure is a model-service problem, never a login', () => {
    expect(
      friendlyTaskFailureReason(
        'failed',
        '模型服务暂时不可用，有限重试后仍失败，请稍后重试。',
        'model',
      ),
    ).toBe('模型服务暂时不可用，有限重试后仍失败，请稍后重试。');
    expect(friendlyTaskFailureReason('failed', 'Qwen transport request failed', 'model')).toBe(
      '模型服务暂时不可用，可稍后重试。',
    );
  });
  it('only a model call can be an AI-service credential failure', () => {
    expect(
      friendlyTaskFailureReason('failed', '模型服务认证失败，请联系管理员检查服务配置。', 'model'),
    ).toContain('模型服务认证失败');
    expect(
      friendlyTaskFailureReason(
        'failed',
        'Anthropic API error: 401 authentication_error invalid x-api-key',
      ),
    ).toBe('AI 服务认证失败，请联系管理员检查 API key。');
    // A page's HTTP 401 (the-internet /basic_auth) asks for a login on that page.
    for (const source of ['page', undefined] as const) {
      const copy = friendlyTaskFailureReason(
        'failed',
        'HTTP 401 Unauthorized at https://the-internet.herokuapp.com/basic_auth',
        source,
      );
      expect(copy, String(source)).toContain('该网页要求登录或认证');
      expect(copy).not.toContain('API key');
    }
  });
  it('a task that ended before opening a page is "not started", with no login wording', () => {
    for (const [raw, source] of [
      ['执行未开始：浏览器还没有打开目标页面就结束了。请重试。', 'not_started'],
      // What Deploy-25 core-06/core-07 persisted.
      [
        '浏览器尚未打开目标页面（about:blank），无法判断站点登录状态。请重试；若持续失败请联系支持。',
        undefined,
      ],
    ] as const) {
      const copy = friendlyTaskFailureReason('failed', raw, source);
      expect(copy).toBe('执行未开始或中途退出：浏览器还没有打开目标页面就结束了。请重试。');
      expect(copy).not.toMatch(/登录/);
    }
  });
  it("the model's own account is shown as written, not keyword-matched", () => {
    const copy = friendlyTaskFailureReason(
      'failed',
      '两个网站都没有日期控件；the-internet 的 /basic_auth 返回 401，没有遇到登录墙以外的阻碍',
      'task',
    );
    expect(copy).toMatch(/^任务执行失败：两个网站都没有日期控件/);
    expect(copy).not.toContain('AI 服务认证失败');
    expect(copy).not.toContain('该网站需要登录');
  });
  it('a real login wall still reads as a login', () => {
    expect(friendlyTaskFailureReason('failed', '页面遇到登录墙，需要登录', 'page')).toContain(
      '该网站需要登录',
    );
  });
  it("a page's 429 is the site's rate limit, a model's 429 is the AI service", () => {
    expect(friendlyTaskFailureReason('failed', 'HTTP 429 Too Many Requests', 'page')).toContain(
      '目标网站限制了访问频率',
    );
    expect(friendlyTaskFailureReason('failed', 'rate_limit_error 429')).toContain(
      'AI 服务当前繁忙',
    );
  });
});
