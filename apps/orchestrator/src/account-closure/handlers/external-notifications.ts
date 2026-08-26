import { createRelationalDeleteHandler, directUserRows } from '../handler-contract.js';

export const externalNotificationsClosureHandler = createRelationalDeleteHandler({
  categoryId: 'external_notifications',
  targets: [directUserRows('notifications'), directUserRows('notification_channels')],
});
