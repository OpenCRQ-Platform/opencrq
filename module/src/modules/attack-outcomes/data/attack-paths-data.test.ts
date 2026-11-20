import { describe, expect, it } from 'vitest';
import { mitreTechniquesData, TACTIC_TA0040 } from '../../mitre-attack/data';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_DestructiveAttack,
  AttackOutcome_Espionage,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
} from './attack-outcomes-ids';
import { PATHS_WITHOUT_INITIAL_ACCESS } from './attack-paths-data';

describe('PATHS_WITHOUT_INITIAL_ACCESS', () => {
  it('holds a share in [0, 1] and Impact parent techniques only', () => {
    const impactParents = new Set(
      mitreTechniquesData
        .filter((technique) => !technique.isSubtechnique && technique.tacticIds.includes(TACTIC_TA0040))
        .map((technique) => technique.externalId),
    );
    for (const [outcomeId, path] of Object.entries(PATHS_WITHOUT_INITIAL_ACCESS)) {
      expect(path.share, outcomeId).toBeGreaterThanOrEqual(0);
      expect(path.share, outcomeId).toBeLessThanOrEqual(1);
      expect(path.techniqueExternalIds.length, outcomeId).toBeGreaterThan(0);
      expect(path.techniqueExternalIds.filter((id) => !impactParents.has(id)), outcomeId).toEqual([]);
    }
  });

  it('gives only Service Disruption and Financial Fraud a path around initial access', () => {
    expect(PATHS_WITHOUT_INITIAL_ACCESS).toEqual({
      [AttackOutcome_ServiceDisruption]: { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1498', 'T1499'] },
      [AttackOutcome_FinancialFraudFundsTheft]: { key: 'access_held_or_outside_perimeter', share: 0.05, techniqueExternalIds: ['T1657'] },
    });
    for (const outcomeId of [
      AttackOutcome_Ransomware,
      AttackOutcome_DataTheftExtortion,
      AttackOutcome_DataBreachResale,
      AttackOutcome_Espionage,
      AttackOutcome_DestructiveAttack,
    ]) {
      expect(PATHS_WITHOUT_INITIAL_ACCESS[outcomeId], outcomeId).toBeUndefined();
    }
  });
});
