// G7 / INBOX Q-8: an avatar never makes the user's browser call another site. A Google
// profile photo goes through HOLA DAY's `/api/avatar` proxy (the backend accepts only these
// URLs); a same-site path is used as it is; any other external address shows the initials
// fallback instead (returns null).
const GOOGLE_AVATAR = /^https:\/\/lh[3-6]\.googleusercontent\.com\/a-?\/[A-Za-z0-9._~=-]{10,400}$/;

export function avatarSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const value = url.trim();
  // 复审 P2-3: a backslash or control character can turn 「/…」 into another host (「/\\evil」).
  if (
    value.includes('\\') ||
    [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
  )
    return null;
  if (GOOGLE_AVATAR.test(value)) return `/api/avatar?url=${encodeURIComponent(value)}`;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^(?:data:image\/|blob:)/.test(value)) return value;
  return null;
}
