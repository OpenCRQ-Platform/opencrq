import { describe, expect, it } from 'vitest';
import { filterRequirements, protectedCriteria, requirementFormErrors } from './requirements-utils';

const none = { protectsConfidentiality: false, protectsIntegrity: false, protectsAvailability: false };

describe('protectedCriteria', () => {
  it('should list the ticked criteria in confidentiality, integrity, availability order', () => {
    expect(protectedCriteria({ protectsConfidentiality: true, protectsIntegrity: false, protectsAvailability: true })).toEqual(['confidentiality', 'availability']);
  });

  it('should list nothing when no box is ticked', () => {
    expect(protectedCriteria(none)).toEqual([]);
  });
});

describe('filterRequirements', () => {
  const rows = [
    { name: 'Hosting SLA', description: null, interestedParty: 'Acme Corp' },
    { name: 'PCI DSS', description: 'Card data rules', interestedParty: 'Card schemes' },
  ];

  it('should match the name, the description and the interested party, ignoring accents and case', () => {
    expect(filterRequirements(rows, 'acmé').map((row) => row.name)).toEqual(['Hosting SLA']);
    expect(filterRequirements(rows, 'card DATA').map((row) => row.name)).toEqual(['PCI DSS']);
  });

  it('should keep every row for an empty search', () => {
    expect(filterRequirements(rows, '')).toHaveLength(2);
  });
});

describe('requirementFormErrors', () => {
  it('should flag a requirement that protects, targets and opens nothing', () => {
    expect(requirementFormErrors({ ...none, primaryAssetIds: [], businessValueCategoryIds: [], lossDriverIds: [] }))
      .toEqual({ noCriterion: true, noTarget: true, noLossDriver: true });
  });

  it('should accept a category alone as the target', () => {
    expect(requirementFormErrors({ ...none, protectsAvailability: true, primaryAssetIds: [], businessValueCategoryIds: ['c'], lossDriverIds: ['d'] }))
      .toEqual({ noCriterion: false, noTarget: false, noLossDriver: false });
  });
});
