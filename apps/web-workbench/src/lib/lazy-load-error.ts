export interface LazyLoadErrorCopy {
  readonly kind: 'stale_version' | 'load_failure';
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string;
}

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /loading chunk \d+ failed/i,
  /chunkloaderror/i,
  /unable to preload css/i,
  /failed to load module script/i,
];

export function isLazyLoadError(error: unknown): boolean {
  const message = lazyLoadErrorText(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function lazyLoadErrorCopy(
  error: unknown,
  surfaceLabel = '页面',
): LazyLoadErrorCopy {
  if (isLazyLoadError(error)) {
    return {
      kind: 'stale_version',
      title: `${surfaceLabel}资源已更新`,
      body: '当前打开的版本和服务器上的最新资源不一致。下方仍可查看已加载的任务摘要；提交追问或继续操作前请先刷新页面。',
      actionLabel: '刷新页面',
    };
  }
  return {
    kind: 'load_failure',
    title: `${surfaceLabel}暂时无法加载`,
    body: '这个页面刚才没有打开成功。刷新后仍然失败的话，请稍后再试或联系支持。',
    actionLabel: '刷新重试',
  };
}

function lazyLoadErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return '';
}
