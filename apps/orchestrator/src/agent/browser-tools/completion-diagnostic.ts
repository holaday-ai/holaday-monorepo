import { TEXT_URL_RE } from '../../execution/text-urls.js';
import { safeObservationUrl } from './cloud-observation.js';

/** Never persist raw model finish arguments; redact before truncating. */
export function completionDiagnostic(event: { summary: string; evidence: string; reason: string }) {
  const safe = (value: string, limit: number) =>
    value
      .replace(TEXT_URL_RE, (url) => safeObservationUrl(url))
      .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(
        /((?:api[_-]?key|password|passwd|token|secret|密码|验证码)\s*[=:：]\s*)[^\s,;；，]+/gi,
        '$1[redacted]',
      )
      .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[redacted]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/\b(?:\d[ -]?){11,19}\b/g, '[redacted-number]')
      .slice(0, limit);
  return {
    summary: safe(event.summary, 2400),
    evidence: safe(event.evidence, 1200),
    reason: safe(event.reason, 1600),
  };
}
