/**
 * Skill manifests declare `allowedOrigins` (e.g. `*.jinritemai.com`).
 * The adapter uses this to refuse `goto` to anything outside the list —
 * a defence-in-depth check so a compromised / mis-planned Skill can't
 * drive the user's Chrome to arbitrary URLs.
 *
 * Wildcard form:  "*.example.com"  matches foo.example.com and
 *                                   example.com but NOT evilexample.com
 * Plain form:     "example.com"     matches example.com only
 * Port form:      "api.example.com:8443"  exact host:port match
 */
export function isOriginAllowed(url: string, allowedOrigins: readonly string[]): boolean {
  if (allowedOrigins.length === 0) return true; // no list = no restriction
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.host.toLowerCase(); // includes port when non-default
  const bareHost = parsed.hostname.toLowerCase();
  for (const rule of allowedOrigins) {
    const r = rule.toLowerCase();
    if (r.startsWith('*.')) {
      const suffix = r.slice(2); // "example.com"
      if (bareHost === suffix) return true;
      if (bareHost.endsWith(`.${suffix}`)) return true;
    } else if (r === host || r === bareHost) {
      return true;
    }
  }
  return false;
}
