import { governanceRegistry } from './index.js';

function assertGovernanceRegistryBundleIsReadonly(): void {
  // @ts-expect-error The exported fact bundle must not allow consumer reassignment.
  governanceRegistry.categories = [];
}

void assertGovernanceRegistryBundleIsReadonly;
