const LOCAL_HOST_SUFFIXES = ['.local', '.lan', '.home', '.internal', '.localhost'];
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isIPv4Host(host: string): boolean {
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return n >= 0 && n <= 255;
    })
  );
}

function isLocalHostName(host: string): boolean {
  return LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function normalizePublicDomain(value: string): string | null {
  let host = value.trim().toLowerCase().replace(/\.+$/, '').replace(/^\.+/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host || host.length > 253 || !host.includes('.')) return null;
  if (isIPv4Host(host) || isLocalHostName(host)) return null;

  const labels = host.split('.');
  if (labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))) return null;
  return host;
}

export function isPublicDomain(value: string | null): value is string {
  return value !== null;
}
