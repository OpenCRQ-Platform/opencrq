import { deriveSeedId } from '../../../seed-ids';
import { OUTCOME_COUNTER_OUTCOMES } from './outcome-counter';

/**
 * Resolves the counter's catalogue attack-outcome identifiers to a tenant's own rows, through the
 * platform's `(tenantId, catalogId)` derivation. A tenant row that does not derive from one of the
 * counter's outcomes (a customer's own attack outcome) carries no entry in the returned map, and that
 * is not an error: the counter never scored it.
 */
export const resolveCatalogAttackOutcomeRowIds = (
  tenantOutcomeRows: Array<{ id: string, tenantId: string }>,
): Map<string, string> => {
  const catalogIdByRowId = new Map<string, string>();
  for (const row of tenantOutcomeRows) {
    for (const catalogId of OUTCOME_COUNTER_OUTCOMES) {
      if (deriveSeedId(row.tenantId, catalogId) === row.id) {
        catalogIdByRowId.set(row.id, catalogId);
        break;
      }
    }
  }
  return catalogIdByRowId;
};
