import { describe, expect, it } from 'vitest';
import { deriveSeedId } from '../../../seed-ids';
import { resolveCatalogAttackOutcomeRowIds } from './catalog-outcome-rows';
import { OUTCOME_COUNTER_OUTCOMES } from './outcome-counter';

const TENANT_ID = '0196a4a0-0000-7000-8000-000000000001';

describe('resolveCatalogAttackOutcomeRowIds', () => {
  it('should map a tenant row derived from a counter outcome to its catalogue id', () => {
    const [catalogId] = OUTCOME_COUNTER_OUTCOMES;
    const rowId = deriveSeedId(TENANT_ID, catalogId);

    expect(resolveCatalogAttackOutcomeRowIds([{ id: rowId, tenantId: TENANT_ID }])).toEqual(new Map([[rowId, catalogId]]));
  });

  it('should leave out a tenant row that derives from no counter outcome', () => {
    const customRowId = '0196a4a0-0000-7000-8000-0000000000aa';

    expect(resolveCatalogAttackOutcomeRowIds([{ id: customRowId, tenantId: TENANT_ID }]).size).toBe(0);
  });
});
