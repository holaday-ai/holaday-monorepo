import { createRelationalDeleteHandler, directUserRows } from '../handler-contract.js';

export const stockPreferenceProfileClosureHandler = createRelationalDeleteHandler({
  categoryId: 'stock_preference_profile',
  targets: [
    directUserRows('stock_risk_monitors'),
    directUserRows('stock_preference_signals'),
    directUserRows('stock_preference_profiles'),
    directUserRows('stock_dashboard_snapshots'),
    directUserRows('watchlists'),
  ],
});
