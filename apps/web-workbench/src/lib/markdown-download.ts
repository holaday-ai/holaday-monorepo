interface MarkdownDownloadDeps {
  document?: Document;
  setTimeout?: (fn: () => void, delay: number) => unknown;
  url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export function markdownDownloadFilename(taskId?: string): string {
  const base = (taskId?.trim() || 'holaday-task')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'holaday-task'}.md`;
}

export function downloadMarkdownFile(
  text: string,
  taskId?: string,
  deps: MarkdownDownloadDeps = {},
): boolean {
  const doc = deps.document ?? globalThis.document;
  const urlApi = deps.url ?? globalThis.URL;
  const scheduleRevoke = deps.setTimeout ?? globalThis.setTimeout;
  if (!doc?.body || !urlApi?.createObjectURL || !urlApi.revokeObjectURL) {
    return false;
  }

  let objectUrl: string | null = null;
  try {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    objectUrl = urlApi.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = objectUrl;
    a.download = markdownDownloadFilename(taskId);
    doc.body.appendChild(a);
    a.click();
    a.remove();
    scheduleRevoke(() => {
      if (objectUrl) urlApi.revokeObjectURL(objectUrl);
    }, 5_000);
    return true;
  } catch {
    if (objectUrl) urlApi.revokeObjectURL(objectUrl);
    return false;
  }
}
