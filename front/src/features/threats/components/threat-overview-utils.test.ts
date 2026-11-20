import { describe, expect, it } from 'vitest';
import { buildAttributionRows, pickSectorTiles, selectOutcomeRows } from './threat-overview-utils';

const sector = (name: string, matchesOrganization = false) => ({ id: name, name, matchesOrganization });

describe('pickSectorTiles', () => {
  it('puts the sectors that concern the tenant first, then orders by name', () => {
    const { shown, hiddenCount } = pickSectorTiles([sector('Media'), sector('Finance', true), sector('Defense'), sector('Energy', true)], 8);

    expect(shown.map((tile) => tile.name)).toEqual(['Energy', 'Finance', 'Defense', 'Media']);
    expect(hiddenCount).toBe(0);
  });

  it('shows every sector when they fit exactly', () => {
    const { shown, hiddenCount } = pickSectorTiles(['A', 'B', 'C'].map((name) => sector(name)), 3);

    expect(shown).toHaveLength(3);
    expect(hiddenCount).toBe(0);
  });

  it('keeps the last tile for the count of the sectors left out', () => {
    const { shown, hiddenCount } = pickSectorTiles(['A', 'B', 'C', 'D', 'E'].map((name) => sector(name)), 3);

    expect(shown.map((tile) => tile.name)).toEqual(['A', 'B']);
    expect(hiddenCount).toBe(3);
  });
});

describe('buildAttributionRows', () => {
  it('lists both sides of the relation, a threat on both sides once per side', () => {
    const apt = { id: 't1', name: 'APT28', entityType: 'intrusion-set' as const };
    const rows = buildAttributionRows([apt], [apt, { id: 't2', name: 'Pawn Storm', entityType: 'campaign' as const }]);

    expect(rows.map((row) => [row.id, row.threatId, row.relation])).toEqual([
      ['to:t1', 't1', 'attributed-to'],
      ['from:t1', 't1', 'attributed-from'],
      ['from:t2', 't2', 'attributed-from'],
    ]);
  });
});

describe('selectOutcomeRows', () => {
  const outcomes = [
    { attackOutcomeId: 'o1', outcomeName: 'Ransomware', score: 0.27 },
    { attackOutcomeId: 'o2', outcomeName: 'Données clients exfiltrées', score: 0.82 },
    { attackOutcomeId: 'o3', outcomeName: 'OT sabotage', score: 0 },
    { attackOutcomeId: 'o4', outcomeName: 'Wire fraud', score: 0 },
  ];

  it('orders by best match and holds back the outcomes matched not at all', () => {
    const { rows, unmatchedCount } = selectOutcomeRows(outcomes, '', false);

    expect(rows.map((row) => row.attackOutcomeId)).toEqual(['o2', 'o1']);
    expect(unmatchedCount).toBe(2);
  });

  it('adds the unmatched outcomes after the matched ones when asked', () => {
    const { rows } = selectOutcomeRows(outcomes, '', true);

    expect(rows.map((row) => row.attackOutcomeId)).toEqual(['o2', 'o1', 'o3', 'o4']);
  });

  it('searches the names without case or accents, and counts only the unmatched it keeps', () => {
    const { rows, unmatchedCount } = selectOutcomeRows(outcomes, 'DONNEES', false);

    expect(rows.map((row) => row.attackOutcomeId)).toEqual(['o2']);
    expect(unmatchedCount).toBe(0);
  });
});
