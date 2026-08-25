import { dataCategories } from './data-categories.js';
import { processors } from './processors.js';
import { publicDisclosures } from './public-disclosure-map.js';
import { retentionPolicies } from './retention-policies.js';
import { rightsCapabilities } from './rights-capabilities.js';
import type { GovernanceRegistryBundle } from './types.js';

export const governanceRegistry = {
  categories: dataCategories,
  processors,
  retentionPolicies,
  rightsCapabilities,
  publicDisclosures,
} satisfies GovernanceRegistryBundle;

export * from './types.js';
export { auditGovernanceRegistry } from './audit.js';
