export function profileDisplayName(options: {
  readonly displayName: string | null | undefined;
  readonly email: string | null | undefined;
}): string {
  const name = options.displayName?.trim();
  if (name) return name;
  const email = options.email?.trim();
  return email || '未命名';
}

export function profileInitial(options: {
  readonly displayName: string | null | undefined;
  readonly email: string | null | undefined;
}): string {
  return profileDisplayName(options).slice(0, 1).toUpperCase();
}

export function profilePageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly email: string | null | undefined;
}): string {
  if (options.loading) return '资料加载中…';
  if (options.error) return '资料加载失败';
  return options.email?.trim() ? '账号资料已加载' : '资料待完善';
}

export function profileUpdateMailBody(email: string | null | undefined): string {
  return `请协助更新我的 HOLA DAY 个人资料。\n\n注册邮箱：${email?.trim() ?? ''}\n需要更新的内容：`;
}
