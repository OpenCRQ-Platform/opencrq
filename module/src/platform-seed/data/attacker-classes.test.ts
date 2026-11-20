import type { SeededAttacker } from './attacker-classes';
import { describe, expect, it } from 'vitest';
import { ATTACK_RUN_DAYS_BY_CLASS } from '../../modules/crq-indicators/engine/attack-run-constants';
import { foldAttackersByClass } from './attacker-classes';

const attacker = (overrides: Partial<SeededAttacker>): SeededAttacker => ({
  actorClass: 'default',
  share: 0.5,
  vulnerabilityMean: 0.2,
  vulnerabilityP5: 0.05,
  vulnerabilityP50: 0.15,
  vulnerabilityP95: 0.4,
  reactionTimeExceededShare: 0,
  ...overrides,
});

describe('foldAttackersByClass', () => {
  it('folds the actors of one class into a single row holding their summed share', () => {
    const rows = foldAttackersByClass([
      attacker({ actorClass: 'ransomware_operator', share: 0.3 }),
      attacker({ actorClass: 'state_sponsored', share: 0.6 }),
      attacker({ actorClass: 'ransomware_operator', share: 0.1 }),
    ]);

    expect(rows.map((row) => row.actorClass)).toEqual(['ransomware_operator', 'state_sponsored']);
    expect(rows[0].share).toBeCloseTo(0.4, 12);
    expect(rows[1].share).toBeCloseTo(0.6, 12);
  });

  it('weights the means of a class by the share of each of its actors', () => {
    const [row] = foldAttackersByClass([
      attacker({ share: 0.3, vulnerabilityMean: 0.1, vulnerabilityP5: 0.02, vulnerabilityP50: 0.08, vulnerabilityP95: 0.2, reactionTimeExceededShare: 0.1 }),
      attacker({ share: 0.1, vulnerabilityMean: 0.3, vulnerabilityP5: 0.06, vulnerabilityP50: 0.24, vulnerabilityP95: 0.6, reactionTimeExceededShare: 0.3 }),
    ]);

    expect(row.vulnerabilityMean).toBeCloseTo(0.15, 12);
    expect(row.vulnerabilityP5).toBeCloseTo(0.03, 12);
    expect(row.vulnerabilityP50).toBeCloseTo(0.12, 12);
    expect(row.vulnerabilityP95).toBeCloseTo(0.3, 12);
    expect(row.reactionTimeExceededShare).toBeCloseTo(0.15, 12);
  });

  it('gives each row the attack run days of its class', () => {
    const rows = foldAttackersByClass([
      attacker({ actorClass: 'state_sponsored', share: 0.5 }),
      attacker({ actorClass: 'hacktivist', share: 0.5 }),
    ]);

    for (const row of rows) {
      expect(row.attackRunDays).toBe(ATTACK_RUN_DAYS_BY_CLASS[row.actorClass]);
    }
  });

  it('keeps the total share and the share-weighted vulnerability the run recomposes from', () => {
    const attackers = [
      attacker({ actorClass: 'ransomware_operator', share: 0.2, vulnerabilityMean: 0.11 }),
      attacker({ actorClass: 'default', share: 0.25, vulnerabilityMean: 0.31 }),
      attacker({ actorClass: 'ransomware_operator', share: 0.35, vulnerabilityMean: 0.07 }),
      attacker({ actorClass: 'state_sponsored', share: 0.2, vulnerabilityMean: 0.23 }),
    ];
    const folded = foldAttackersByClass(attackers);

    const total = (rows: ReadonlyArray<SeededAttacker>, value: (row: SeededAttacker) => number): number =>
      rows.reduce((sum, row) => sum + value(row), 0);
    expect(total(folded, (row) => row.share)).toBeCloseTo(total(attackers, (row) => row.share), 12);
    expect(total(folded, (row) => row.share * row.vulnerabilityMean))
      .toBeCloseTo(total(attackers, (row) => row.share * row.vulnerabilityMean), 12);
  });

  it('orders the rows by actor class, not by input order', () => {
    const rows = foldAttackersByClass([
      attacker({ actorClass: 'default' }),
      attacker({ actorClass: 'opportunistic_crime' }),
    ]);

    expect(rows.map((row) => row.actorClass)).toEqual(['opportunistic_crime', 'default']);
  });

  it('gives no row to a class whose total share is zero', () => {
    const rows = foldAttackersByClass([
      attacker({ actorClass: 'hacktivist', share: 0 }),
      attacker({ actorClass: 'default', share: 1 }),
    ]);

    expect(rows.map((row) => row.actorClass)).toEqual(['default']);
  });

  it('gives no row for no attacker', () => {
    expect(foldAttackersByClass([])).toEqual([]);
  });
});
