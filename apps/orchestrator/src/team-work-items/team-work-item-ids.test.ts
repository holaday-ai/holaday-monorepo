import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, isExternalId, newExternalId } from '@holaday/shared-types';

const teamWorkItemKinds = [
  ['teamMilestone', 'tml'],
  ['teamWorkItem', 'twi'],
  ['teamWorkItemAssignment', 'twa'],
  ['acceptanceContractVersion', 'acv'],
  ['teamSubmission', 'tsb'],
  ['teamReview', 'trv'],
  ['teamAppeal', 'tap'],
  ['teamArbitrationDecision', 'tad'],
  ['teamWorkItemEvent', 'twe'],
  ['teamEvidenceBinding', 'teb'],
  ['teamAiContribution', 'tai'],
] as const;

describe('team work item external ids', () => {
  it.each(teamWorkItemKinds)('%s uses its unique prefix and round-trips', (kind, prefix) => {
    const externalId = newExternalId(kind);

    expect(ID_PREFIXES[kind]).toBe(prefix);
    expect(externalId).toMatch(new RegExp(`^${prefix}_[A-Za-z0-9]{21}$`));
    expect(isExternalId(externalId, kind)).toBe(true);
    expect(isExternalId(externalId, 'task')).toBe(false);
    expect(isExternalId(externalId, 'project')).toBe(false);
  });

  it('does not reuse any existing external-id prefix', () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
