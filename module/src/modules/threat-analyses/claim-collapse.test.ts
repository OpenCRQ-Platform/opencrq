import { describe, expect, it } from 'vitest';
import { collapseClaimsByTarget } from './claim-collapse';

interface TechniqueRow {
  id: string,
  mitreExternalId: string,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
}

let nextRowId = 0;

// Ids ascend in creation order, so a tie resolves to the first row built.
const row = (overrides: Partial<TechniqueRow> = {}): TechniqueRow => ({
  id: `row-${String(nextRowId++).padStart(4, '0')}`,
  mitreExternalId: 'T1078',
  relCreated: null,
  relStartTime: null,
  relStopTime: null,
  ...overrides,
});

const byKey = (entry: TechniqueRow): string => entry.mitreExternalId;

describe('collapseClaimsByTarget', () => {
  it('should keep unrelated rows apart and preserve input order', () => {
    const collapsed = collapseClaimsByTarget([row({ mitreExternalId: 'T1566' }), row()], byKey);

    expect(collapsed.map((entry) => entry.mitreExternalId)).toEqual(['T1566', 'T1078']);
  });

  it('should show one row when the same target is stated twice', () => {
    const collapsed = collapseClaimsByTarget([row(), row()], byKey);

    expect(collapsed).toHaveLength(1);
  });

  // The displayed dates must be the ones driving the activity score in the header above them.
  it('should keep the row with the most recent activity anchor', () => {
    const collapsed = collapseClaimsByTarget([
      row({ relCreated: new Date('2023-01-01T00:00:00.000Z') }),
      row({ relCreated: new Date('2025-01-01T00:00:00.000Z') }),
    ], byKey);

    expect(collapsed[0].relCreated).toEqual(new Date('2025-01-01T00:00:00.000Z'));
  });

  it('should prefer an observed anchor over an authored one dated the same day', () => {
    const sameDay = new Date('2025-01-01T00:00:00.000Z');
    const collapsed = collapseClaimsByTarget([
      row({ relCreated: sameDay }),
      row({ relStartTime: sameDay }),
    ], byKey);

    expect(collapsed[0].relStartTime).toEqual(sameDay);
    expect(collapsed[0].relCreated).toBeNull();
  });

  it('should fall back to the claim id when neither row carries a date', () => {
    const first = row();
    const second = row();

    expect(collapseClaimsByTarget([second, first], byKey)[0].id).toBe(first.id);
  });
});
