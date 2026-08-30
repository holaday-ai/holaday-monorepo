import { describe, expect, it } from 'vitest';
import { isExternalId, newExternalId } from '../../../../packages/shared-types/src/ids.js';

describe('team workspace external IDs', () => {
  it('uses distinct prefixes for organization and membership kinds', () => {
    expect(isExternalId(newExternalId('organization'), 'organization')).toBe(true);
    expect(isExternalId(newExternalId('organizationMember'), 'organizationMember')).toBe(true);
    expect(isExternalId(newExternalId('organizationInvitation'), 'organizationInvitation')).toBe(
      true,
    );
    expect(isExternalId(newExternalId('projectMember'), 'projectMember')).toBe(true);
  });
});
