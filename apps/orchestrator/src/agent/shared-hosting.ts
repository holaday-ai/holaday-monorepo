/**
 * FIX-32 (FIX-30 review): on shared hosting every subdomain is someone else's site —
 * alice.github.io and bob.github.io are two sites, not one "github.io".
 */
const SHARED_HOSTING_SUFFIXES = [
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'onrender.com',
  'fly.dev',
  'surge.sh',
  'glitch.me',
  'repl.co',
  'readthedocs.io',
  'blogspot.com',
  'wordpress.com',
  'substack.com',
  'notion.site',
  'azurewebsites.net',
  'appspot.com',
];

/** The site on shared hosting (`alice.github.io` from `docs.alice.github.io`), or null. */
export function sharedHostingSite(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const suffix = SHARED_HOSTING_SUFFIXES.find((s) => host.endsWith(`.${s}`));
  if (!suffix) return null;
  const owner = host
    .slice(0, -suffix.length - 1)
    .split('.')
    .at(-1);
  return owner ? `${owner}.${suffix}` : null;
}
