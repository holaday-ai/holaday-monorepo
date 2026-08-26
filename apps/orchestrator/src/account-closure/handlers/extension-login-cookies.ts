import { createRelationalDeleteHandler, directUserRows } from '../handler-contract.js';

export const extensionLoginCookiesClosureHandler = createRelationalDeleteHandler({
  categoryId: 'extension_login_cookies',
  targets: [directUserRows('pending_cookies')],
});
