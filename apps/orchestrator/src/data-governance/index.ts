import { dataCategories } from './data-categories.js';
import { processors } from './processors.js';
import { publicDisclosures } from './public-disclosure-map.js';
import { retentionPolicies } from './retention-policies.js';
import { rightsCapabilities } from './rights-capabilities.js';
import type { GovernanceRegistryBundle } from './types.js';

export const governanceRegistry: GovernanceRegistryBundle = {
  categories: dataCategories,
  processors,
  retentionPolicies,
  rightsCapabilities,
  publicDisclosures,
};

export * from './types.js';
export { auditGovernanceRegistry } from './audit.js';
