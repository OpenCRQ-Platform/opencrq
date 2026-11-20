import { describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { deriveSeedId } from '../../seed-ids';
import { ATTACK_OUTCOMES } from './data/attack-outcomes-data';
import { AttackOutcome_DataBreachResale, AttackOutcome_Ransomware } from './data/attack-outcomes-ids';
import { resolveCatalogueAttackOutcomeId } from './tenant-attack-outcome-id-utils';

describe('resolveCatalogueAttackOutcomeId', () => {
  it('inverts deriveSeedId for every catalog outcome', () => {
    const tenantId = uuidv7();
    for (const outcome of ATTACK_OUTCOMES) {
      const tenantRowId = deriveSeedId(tenantId, outcome.id);
      expect(resolveCatalogueAttackOutcomeId(tenantId, tenantRowId)).toBe(outcome.id);
    }
  });

  it('differs per tenant for the same catalogue outcome', () => {
    const tenantAId = uuidv7();
    const tenantBId = uuidv7();
    const rowIdForA = deriveSeedId(tenantAId, AttackOutcome_DataBreachResale);
    expect(resolveCatalogueAttackOutcomeId(tenantBId, rowIdForA)).toBeUndefined();
    expect(resolveCatalogueAttackOutcomeId(tenantAId, rowIdForA)).toBe(AttackOutcome_DataBreachResale);
  });

  it('returns undefined for an id that is not a derived row of this tenant', () => {
    expect(resolveCatalogueAttackOutcomeId(uuidv7(), uuidv7())).toBeUndefined();
  });

  it('resolves a different outcome to a different catalogue id', () => {
    const tenantId = uuidv7();
    expect(resolveCatalogueAttackOutcomeId(tenantId, deriveSeedId(tenantId, AttackOutcome_Ransomware))).toBe(AttackOutcome_Ransomware);
  });
});
