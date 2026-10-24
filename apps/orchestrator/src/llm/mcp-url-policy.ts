/**
 * Bailian MCP endpoints receive our DashScope key as a Bearer token, so the
 * host must be Alibaba Cloud Model Studio — never a third-party server.
 * Exact hosts plus two Alibaba-owned subdomain families; port 443 only.
 */
const EXACT_HOSTS = new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com']);
const SUFFIXES = ['.dashscope.aliyuncs.com', '.maas.aliyuncs.com'];

export function isAllowedMcpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || SUFFIXES.some((suffix) => host.endsWith(suffix));
}
