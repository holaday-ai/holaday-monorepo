export interface NormalizedAuthMeProfile {
  readonly userId: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly displayName: string | null;
  readonly plan: string;
  readonly multiUser: boolean;
  readonly selectedRoles: string[];
  readonly role: 'user' | 'admin';
  /** Phase 1 #4 — video-creation reachable for this user (flag on + in
   *  allowlist). Gates the「视频任务」sidebar entry + /video route. */
  readonly videoEnabled: boolean;
  readonly teamProjectsEnabled: boolean;
}

export function normalizeAuthMeProfile(value: unknown): NormalizedAuthMeProfile {
  const raw = isRecord(value) ? value : {};
  return {
    userId: authSafeText(raw.userId),
    email: authNullableText(raw.email),
    phone: authNullableText(raw.phone),
    displayName: authNullableText(raw.displayName),
    plan: authSafeText(raw.plan) || 'free',
    multiUser: Boolean(raw.multiUser),
    selectedRoles: normalizeSelectedRoles(raw.selectedRoles),
    role: raw.role === 'admin' ? 'admin' : 'user',
    videoEnabled: Boolean(raw.videoEnabled),
    teamProjectsEnabled: raw.teamProjectsEnabled === true,
  };
}

export function preferredAuthDisplayName(
  me: {
    readonly displayName?: unknown;
    readonly phone?: unknown;
    readonly email?: unknown;
  } | null,
): string {
  if (!me) return '';
  const raw = authSafeText(me.displayName);
  const looksMasked = raw ? /\d{3}\**\d{4}/.test(raw) : false;
  if (raw && !looksMasked) return raw;
  const phone = authSafeText(me.phone);
  if (phone) return `用户_${phone.slice(-4)}`;
  const email = authSafeText(me.email);
  if (email) {
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : email;
  }
  return '用户';
}

function normalizeSelectedRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(authSafeText).filter(Boolean);
}

function authNullableText(value: unknown): string | null {
  const text = authSafeText(value);
  return text || null;
}

function authSafeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
