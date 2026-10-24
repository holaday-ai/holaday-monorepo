import { stripToolCallMarkup } from '@holaday/shared-types';
import {
  MODEL_TASK_FAILURE_COPY,
  type ModelTaskUnavailableReason,
} from '../llm/model-runtime-wiring.js';
import { friendlyBrowserFailureReason } from './browser-failure-copy.js';

export function modelTaskFailureReason(reason: ModelTaskUnavailableReason): string {
  return MODEL_TASK_FAILURE_COPY[reason];
}

/**
 * Where a failure came from (see SupercarOutcome.failureSource). `user_wall`: a captcha /
 * verification handover the user timed out on or gave up (FIX-35).
 */
export type TaskFailureSource = 'model' | 'page' | 'tool' | 'user_wall' | 'not_started' | 'task';

const MODEL_UNAVAILABLE = '模型服务暂时不可用，可稍后重试。';
// No "登录" wording: the UI would turn any mention into a login prompt.
const NOT_STARTED_COPY = '执行未开始或中途退出：浏览器还没有打开目标页面就结束了。请重试。';
/** Text that names the model service itself, not a web page. */
const MODEL_SIGNAL =
  /anthropic|openai|qwen|dashscope|x-api-key|api[ _-]?key|authentication_error|rate_limit_error|overloaded_error|模型服务|ai 服务/;

/**
 * FAILURE-COPY-1: the copy depends on where the failure came from. Only a
 * model call can be an AI-service credential problem (a page's HTTP 401 is
 * the page asking for a login), and only a wall that was met is a login.
 */
export function friendlyTaskFailureReason(
  status: string,
  raw: string | null | undefined,
  source?: TaskFailureSource,
): string {
  const r = (raw ?? '').toLowerCase();
  if (source === 'model')
    // The browser loop already words model failures (modelFailureReason).
    return raw?.trim().startsWith('模型服务') ? raw.trim() : MODEL_UNAVAILABLE;
  if (source === 'not_started' || r.includes('about:blank') || raw?.startsWith('执行未开始'))
    return NOT_STARTED_COPY;
  // The model's own account of what it could not do is shown as written:
  // keyword rules would turn "没有遇到登录墙" into a login prompt.
  if (source === 'task') return plainFailure(raw);
  const fromModel = !source && MODEL_SIGNAL.test(r);
  const unsupportedFile = /^FILE_FORMAT_UNSUPPORTED:([a-z0-9]+(?:,[a-z0-9]+)*)$/i.exec(raw ?? '');
  if (unsupportedFile?.[1]) {
    const formats = unsupportedFile[1].toUpperCase().split(',').join('、');
    return `任务未完成：当前文件生成工具不支持 ${formats} 格式，升级套餐无法解决。请确认是否接受其他可用格式，或使用支持该格式的工具。`;
  }
  const browserFailure = friendlyBrowserFailureReason(raw);
  if (browserFailure) return browserFailure;
  if (status === 'timeout' || /timeout|elapsed|time ?out|超时|时间过长|处理时间过长/.test(r)) {
    return '任务超时。可能原因：目标网站响应缓慢或被反爬拦截。建议：重试，或把任务描述简化后再试。';
  }
  if (/429|rate ?limit|too many requests/.test(r)) {
    return source === 'page'
      ? '目标网站限制了访问频率（429），请稍后重试。'
      : 'AI 服务当前繁忙（限速），请稍后再试。';
  }
  if (source !== 'page' && /529|overloaded|overload/.test(r)) {
    return 'AI 服务暂时过载，请几秒后重试。';
  }
  if (source !== 'page' && /credit|balance|insufficient|payment required|402/.test(r)) {
    return 'API 额度不足。请联系管理员续费或等下一计费周期。';
  }
  if (/401|unauthorized|invalid api key|authentication/.test(r)) {
    return fromModel
      ? 'AI 服务认证失败，请联系管理员检查 API key。'
      : '该网页要求登录或认证（如 HTTP 401），任务没有读取受保护的内容。如需继续，请在右侧 Panel 中登录后重试。';
  }
  if (/captcha|recaptcha|人机验证|滑块|verify/.test(r)) {
    return '遇到验证码。建议：在右侧 Panel 中手动完成验证，登录态会保存，下次无需重复。';
  }
  if (
    source !== 'tool' &&
    source !== 'user_wall' &&
    /login|signin|sign ?in|passport|oauth|需要登录|登录墙/.test(r)
  ) {
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
  return plainFailure(raw);
}

function plainFailure(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed) {
    if (looksLikeInternalError(trimmed)) {
      return '任务执行出错。请重试；如果反复出现，请联系 support@holaday.ai。';
    }
    // Strip a trailing sentence terminator so we don't double up on the
    // "。建议…" we append — a raw reason like "请求处理时间过长，正在重试。"
    // otherwise renders "…正在重试。。建议…".
    // FIX-35 复审 #1 (BENCH d03): the model's own account carries the browser's element
    // refs (「（ref=e11）」) — page handles, not something the user can read.
    const cleaned = stripToolCallMarkup(trimmed).replace(/[。.!！?？;；,，、\s]+$/u, '');
    return `任务执行失败：${cleaned}。建议：简化任务描述后重试。`;
  }
  return '任务执行失败。建议：简化任务描述后重试。';
}

function looksLikeInternalError(text: string): boolean {
  if (text.length === 0) return false;
  if (
    /(\n\s*at\s+|\bat\s+file:|stack trace|traceback|error:|exception|typeerror|referenceerror)/i.test(
      text,
    )
  ) {
    return true;
  }
  let ascii = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128) ascii += 1;
  }
  return ascii / text.length > 0.85;
}
