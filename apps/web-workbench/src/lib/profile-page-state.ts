export interface ProfileSnapshot {
  readonly email: string;
  readonly displayName: string;
}

export function normalizeProfileSnapshot(value: unknown): ProfileSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('个人资料数据格式异常，请稍后重试。');
  }
  const raw = value as Record<string, unknown>;
  return {
    email: profileSafeText(raw.email),
    displayName: profileSafeText(raw.displayName),
  };
}

export function profileDisplayName(options: {
  readonly displayName: unknown;
  readonly email: unknown;
}): string {
  const name = profileSafeText(options.displayName);
  if (name) return name;
  const email = profileSafeText(options.email);
  return email || '未命名';
}

export function profileInitial(options: {
  readonly displayName: unknown;
  readonly email: unknown;
}): string {
  return profileDisplayName(options).slice(0, 1).toUpperCase();
}

export function profilePageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly email: unknown;
}): string {
  if (options.loading) return '资料加载中…';
  if (options.error) return '资料加载失败';
  return profileSafeText(options.email) ? '账号资料已加载' : '资料待完善';
}

export function profileUpdateMailBody(email: unknown): string {
  return `请协助更新我的 HOLA DAY 个人资料。\n\n注册邮箱：${profileSafeText(email)}\n需要更新的内容：`;
}

export function profileLoadErrorMessage(
  err: unknown,
  fallback = '个人资料暂时无法加载，请稍后重试。',
): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

function profileSafeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
