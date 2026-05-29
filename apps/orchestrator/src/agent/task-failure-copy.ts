import { friendlyBrowserFailureReason } from './browser-failure-copy.js';

export function friendlyTaskFailureReason(
  status: string,
  raw: string | null | undefined,
): string {
  const r = (raw ?? '').toLowerCase();
  const browserFailure = friendlyBrowserFailureReason(raw);
  if (browserFailure) return browserFailure;
  if (status === 'timeout' || /timeout|elapsed|time ?out|超时/.test(r)) {
    return '任务超时。可能原因：目标网站响应缓慢或被反爬拦截。建议：重试，或把任务描述简化后再试。';
  }
  if (/429|rate ?limit|too many requests/.test(r)) {
    return 'AI 服务当前繁忙（限速），请稍后再试。';
  }
  if (/529|overloaded|overload/.test(r)) {
    return 'AI 服务暂时过载，请几秒后重试。';
  }
  if (/credit|balance|insufficient|payment required|402/.test(r)) {
    return 'API 额度不足。请联系管理员续费或等下一计费周期。';
  }
  if (/401|unauthorized|invalid api key|authentication/.test(r)) {
    return 'AI 服务认证失败，请联系管理员检查 API key。';
  }
  if (/captcha|recaptcha|人机验证|滑块|verify/.test(r)) {
    return '遇到验证码。建议：在右侧 Panel 中手动完成验证，登录态会保存，下次无需重复。';
  }
  if (/login|signin|sign ?in|passport|oauth|需要登录|登录墙/.test(r)) {
    return '该网站需要登录才能继续。建议：在右侧 Panel 中手动登录一次，登录态会保存，然后重试任务。';
  }
  if (/missing anthropic_api_key/.test(r)) {
    return 'AI 服务未配置。请联系管理员检查部署。';
  }
  if (/no browser|no playwright|connectovercdp/.test(r)) {
    return '浏览器暂时不可用，请稍后重试。';
  }
  if (/network|econn|fetch failed|dns/.test(r)) {
    return '网络错误。请检查连接后重试。';
  }
  const trimmed = raw?.trim();
  if (trimmed) {
    if (looksLikeInternalError(trimmed)) {
      return '任务执行出错。请重试；如果反复出现，请联系 support@holaday.ai。';
    }
    return `任务执行失败：${trimmed}。建议：简化任务描述后重试。`;
  }
  return '任务执行失败。建议：简化任务描述后重试。';
}

function looksLikeInternalError(text: string): boolean {
  if (text.length === 0) return false;
  if (/(\n\s*at\s+|\bat\s+file:|stack trace|traceback|error:|exception|typeerror|referenceerror)/i.test(text)) {
    return true;
  }
  let ascii = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128) ascii += 1;
  }
  return ascii / text.length > 0.85;
}
