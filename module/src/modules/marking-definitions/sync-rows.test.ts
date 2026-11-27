import { describe, expect, it } from 'vitest';
import type { SyncedMarkingDefinition } from './service';
import { markingStixId } from './marking-stix-id';
import { markingRowsToSync } from './sync-rows';

const TLP_RED = markingStixId('TLP', 'TLP:RED');
const CUSTOM = markingStixId('CUSTOM', 'CUSTOM:SECRET');
const TENANT = 'tenant-1';

const synced = (overrides: Partial<SyncedMarkingDefinition> & Pick<SyncedMarkingDefinition, 'stixId'>): SyncedMarkingDefinition => ({
  definitionType: 'CUSTOM',
  definition: 'CUSTOM:SECRET',
  color: null,
  order: null,
  ...overrides,
});

const rowsOf = (markings: Array<SyncedMarkingDefinition>) => {
  let counter = 0;
  return markingRowsToSync(TENANT, markings, () => `row-${(counter += 1)}`);
};

describe('markingRowsToSync', () => {
  it('should give a known marking its OpenCTI rank whatever the peer states', () => {
    const { rows } = rowsOf([synced({ stixId: TLP_RED, definitionType: 'TLP', definition: 'TLP:RED', order: 0 })]);

    expect(rows).toEqual([{ id: 'row-1', tenantId: TENANT, stixId: TLP_RED, definitionType: 'TLP', definition: 'TLP:RED', color: null, order: 5 }]);
  });

  it('should keep the rank of a marking nobody ranks, and no rank when the peer gave none', () => {
    expect(rowsOf([synced({ stixId: CUSTOM, order: 7 })]).rows[0].order).toBe(7);
    expect(rowsOf([synced({ stixId: CUSTOM, order: null })]).rows[0].order).toBeNull();
  });

  it('should read a rank that is not an integer as no rank', () => {
    expect(rowsOf([synced({ stixId: CUSTOM, order: 2.5 })]).rows[0].order).toBeNull();
  });

  it('should skip and count a marking without a STIX id, a type or a definition', () => {
    const { rows, skipped } = rowsOf([
      synced({ stixId: 'not-a-stix-id' }),
      synced({ stixId: CUSTOM, definitionType: '  ' }),
      synced({ stixId: CUSTOM, definition: '' }),
      synced({ stixId: CUSTOM }),
    ]);

    expect(skipped).toBe(3);
    expect(rows).toHaveLength(1);
  });

  it('should keep the last occurrence of a marking stated twice', () => {
    const { rows, skipped } = rowsOf([synced({ stixId: CUSTOM, color: '#111111' }), synced({ stixId: CUSTOM, color: '#222222' })]);

    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].color).toBe('#222222');
  });
});
