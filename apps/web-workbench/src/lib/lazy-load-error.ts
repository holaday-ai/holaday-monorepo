export interface LazyLoadErrorCopy {
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
      title: `${surfaceLabel}资源已更新`,
      body: '当前打开的版本和服务器上的最新资源不一致。刷新后会加载最新版本，已输入的内容请先确认保存。',
      actionLabel: '刷新页面',
    };
  }
  return {
    title: `${surfaceLabel}加载失败`,
    body: '页面渲染时遇到异常。刷新后仍然失败的话，请稍后再试或联系支持。',
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
