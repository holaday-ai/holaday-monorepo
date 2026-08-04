export function browserUrlForLog(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '[invalid-url]';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[non-http-url]';
  return `${url.protocol}//${url.host}/`;
}
