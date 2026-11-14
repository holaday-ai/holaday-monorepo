/** Allowlisted diagnostic fields only. Never retain a provider message/body or request. */
export interface ProviderErrorDiagnostics {
  httpStatus: number | null;
  providerCode: string | null;
  providerType: string | null;
  requestId: string | null;
  elapsedMs: number;
  retryCount: number;
}

function identifier(value: unknown, limit: number): string | null {
  return typeof value === 'string' &&
    value.length <= limit &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) &&
    !/^(?:sk-|Bearer|key-|token-)/i.test(value) &&
    !/[a-f0-9]{48,}/i.test(value)
    ? value
    : null;
}

export function safeProviderDiagnostics(
  value: Partial<ProviderErrorDiagnostics>,
): ProviderErrorDiagnostics {
  return {
    httpStatus:
      typeof value.httpStatus === 'number' &&
      Number.isInteger(value.httpStatus) &&
      value.httpStatus >= 100 &&
      value.httpStatus <= 599
        ? value.httpStatus
        : null,
    providerCode: identifier(value.providerCode, 64),
    providerType: identifier(value.providerType, 64),
    requestId: identifier(value.requestId, 128),
    elapsedMs:
      typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs)
        ? Math.max(0, Math.round(value.elapsedMs))
        : 0,
    retryCount:
      typeof value.retryCount === 'number' && Number.isInteger(value.retryCount)
        ? Math.min(2, Math.max(0, value.retryCount))
        : 0,
  };
}

/** Bounded error-body read; neither raw JSON nor provider prose escapes this function. */
export async function responseErrorDiagnostics(
  response: Response,
  elapsedMs: number,
  retryCount: number,
  cleanup: (action: () => Promise<unknown>) => void = (action) => {
    void action().catch(() => {});
  },
  redactions: readonly string[] = [],
): Promise<ProviderErrorDiagnostics> {
  let body: Record<string, unknown> = {};
  const reader = response.body?.getReader();
  if (reader) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        (async () => {
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 8192) return '';
            chunks.push(chunk.value);
          }
          return new TextDecoder().decode(Buffer.concat(chunks));
        })(),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve(''), 500);
        }),
      ]);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        body = parsed as Record<string, unknown>;
    } catch {
      /* malformed or stalled diagnostics never mask the HTTP status */
    } finally {
      clearTimeout(timer);
      cleanup(async () => {
        try {
          await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      });
    }
  }
  const error =
    body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>) : body;
  const redact = (value: unknown) =>
    typeof value === 'string' && redactions.some((secret) => secret && value.includes(secret))
      ? null
      : value;
  return safeProviderDiagnostics({
    httpStatus: response.status,
    elapsedMs,
    retryCount,
    providerCode: redact(error.code) as string,
    providerType: redact(error.type) as string,
    requestId: redact(
      response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? body.request_id,
    ) as string,
  });
}

export function modelProviderFailureMessage(status: number | null): string {
  if (status === 401) return '模型服务认证失败，请联系管理员检查服务配置。';
  if (status === 403) return '模型服务拒绝访问，请联系管理员检查工作空间和模型权限。';
  if (status === 400 || status === 404 || status === 422)
    return '模型服务配置或请求不受支持，请联系管理员检查。';
  if (status === 429) return '模型服务请求过于频繁，请稍后重试。';
  if (status !== null && status >= 500) return '模型服务暂时不可用，有限重试后仍失败，请稍后重试。';
  return '模型服务请求失败，请稍后重试；管理员可查看调用诊断。';
}
