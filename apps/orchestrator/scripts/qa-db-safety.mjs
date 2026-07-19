const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const QA_DATABASE_NAME = /(?:^|[_-])(?:qa|test|ci)(?:$|[_-])/i;

export function assertSafeQaDatabase(databaseUrl, options = {}) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('QA DATABASE_URL is invalid.');
  }
  if (parsed.protocol !== 'mysql:') {
    throw new Error('QA DATABASE_URL must use the mysql protocol.');
  }

  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return;
  if (!options.allowRemote) {
    throw new Error(
      'QA is refusing remote database access. Use a loopback database for local UI checks.',
    );
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!QA_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      'Remote QA requires a dedicated QA database whose name contains qa, test, or ci.',
    );
  }
}
