/** Compiled host policy, never a model/tool argument or page-supplied allowlist. */
export interface NativeDownloadResponseSources {
  readonly patterns: readonly string[];
  accepts(url: string): boolean;
}

/** Selected sites serve native exports from a separate download host.
 * Authorize only the selected immutable GitHub file or exact spreadsheet CSV,
 * without granting page/DOM access or using an account identifier as authority.
 */
export function nativeDownloadResponseSourcesForPage(
  pageUrl: string,
): NativeDownloadResponseSources | undefined {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return undefined;
  }
  if (page.username || page.password) return undefined;
  if (page.origin === 'https://github.com') {
    const file = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/blob\/([a-f0-9]{40})\/(.+)$/.exec(
      page.pathname,
    );
    if (!file) return undefined;
    const path = `/${file[1]}/${file[2]}/${file[3]}/${file[4]}`;
    return {
      patterns: ['https://raw.githubusercontent.com/*'],
      accepts(value) {
        try {
          const url = new URL(value);
          return (
            url.origin === 'https://raw.githubusercontent.com' &&
            !url.username &&
            !url.password &&
            !url.hash &&
            url.pathname === path
          );
        } catch {
          return false;
        }
      },
    };
  }
  const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})\/(?:edit|view|preview)\/?$/.exec(
    page.pathname,
  )?.[1];
  if (page.origin !== 'https://docs.google.com' || page.username || page.password || !id)
    return undefined;
  const gids = [
    ...page.searchParams.getAll('gid'),
    ...new URLSearchParams(page.hash.slice(1)).getAll('gid'),
  ];
  if (new Set(gids).size > 1) return undefined;
  const gid = gids[0];
  return {
    patterns: ['https://doc-*-sheets.googleusercontent.com/export/*'],
    accepts(value) {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.port &&
          /^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(url.hostname) &&
          url.pathname.startsWith('/export/') &&
          url.pathname.endsWith(`/${id}`) &&
          !url.hash &&
          url.searchParams.getAll('id').length === 1 &&
          url.searchParams.get('id') === id &&
          (gid === undefined ||
            (url.searchParams.getAll('gid').length === 1 && url.searchParams.get('gid') === gid)) &&
          url.searchParams.getAll('format').length === 1 &&
          url.searchParams.get('format') === 'csv'
        );
      } catch {
        return false;
      }
    },
  };
}
