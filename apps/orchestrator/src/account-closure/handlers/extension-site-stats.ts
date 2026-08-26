import { createRelationalDeleteHandler, directUserRows } from '../handler-contract.js';

export const extensionSiteStatsClosureHandler = createRelationalDeleteHandler({
  categoryId: 'extension_site_stats',
  targets: [directUserRows('user_site_stats')],
});
