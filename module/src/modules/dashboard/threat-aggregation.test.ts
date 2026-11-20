import { describe, expect, it } from 'vitest';
import type { AdmittedThreat } from '../threat-analyses';
import type { TechniqueValueRow } from './threat-aggregation';
import { aggregateTechniqueGains, rankScopeThreats } from './threat-aggregation';

const threat = (id: string, overrides: Partial<AdmittedThreat> = {}): AdmittedThreat => ({
  id,
  name: id,
  entityType: 'intrusion-set',
  activityScore: 0.5,
  lastObservedAt: new Date('2026-01-01T00:00:00Z'),
  combinedRelevance: 0.5,
  ...overrides,
});

describe('rankScopeThreats', () => {
  it('counts a threat once with the number of scenarios admitting it', () => {
    const lockbit = threat('lockbit');
    const ranked = rankScopeThreats([
      { scenarioId: 's1', threats: [lockbit] },
      { scenarioId: 's2', threats: [lockbit] },
      { scenarioId: 's3', threats: [lockbit] },
    ], 6);

    expect(ranked).toEqual([expect.objectContaining({ id: 'lockbit', scenarioCount: 3 })]);
  });

  it('carries the date a threat was last observed, dated or not', () => {
    const observedAt = new Date('2026-03-01T00:00:00Z');
    const ranked = rankScopeThreats([{
      scenarioId: 's1',
      threats: [
        threat('dated', { activityScore: 0.9, lastObservedAt: observedAt }),
        threat('undated', { activityScore: null, lastObservedAt: null }),
      ],
    }], 6);

    expect(ranked.map((row) => [row.id, row.lastObservedAt])).toEqual([['dated', observedAt], ['undated', null]]);
  });

  it('ranks by activity, then scenario count, then relevance, then name', () => {
    const ranked = rankScopeThreats([
      {
        scenarioId: 's1',
        threats: [
          threat('quiet', { activityScore: 0.1 }),
          threat('wide', { activityScore: 0.5 }),
          threat('relevant', { activityScore: 0.5, combinedRelevance: 0.9 }),
          threat('beta', { activityScore: 0.5 }),
          threat('loud', { activityScore: 0.9 }),
        ],
      },
      { scenarioId: 's2', threats: [threat('wide', { activityScore: 0.5 })] },
    ], 6);

    expect(ranked.map((row) => row.id)).toEqual(['loud', 'wide', 'relevant', 'beta', 'quiet']);
  });

  it('ranks an undated threat after a dated one, however relevant the one and old the other', () => {
    const ranked = rankScopeThreats([{
      scenarioId: 's1',
      threats: [
        threat('undated', { activityScore: null, lastObservedAt: null, combinedRelevance: 1 }),
        threat('ancient', { activityScore: 0.0001, lastObservedAt: new Date('2016-01-01T00:00:00Z'), combinedRelevance: 0.01 }),
      ],
    }, { scenarioId: 's2', threats: [threat('undated', { activityScore: null, lastObservedAt: null, combinedRelevance: 1 })] }], 6);

    expect(ranked.map((row) => row.id)).toEqual(['ancient', 'undated']);
  });

  it('ranks a known zero activity before an unknown one', () => {
    const ranked = rankScopeThreats([{
      scenarioId: 's1',
      threats: [threat('unknown', { activityScore: null, lastObservedAt: null }), threat('zero', { activityScore: 0 })],
    }], 6);

    expect(ranked.map((row) => row.id)).toEqual(['zero', 'unknown']);
  });

  it('separates two undated threats by scenario count, then relevance, then name', () => {
    const undated = (id: string, combinedRelevance: number) => threat(id, { activityScore: null, lastObservedAt: null, combinedRelevance });
    const ranked = rankScopeThreats([
      { scenarioId: 's1', threats: [undated('relevant', 0.9), undated('wide', 0.1), undated('beta', 0.5), undated('alpha', 0.5)] },
      { scenarioId: 's2', threats: [undated('wide', 0.1)] },
    ], 6);

    expect(ranked.map((row) => row.id)).toEqual(['wide', 'relevant', 'alpha', 'beta']);
  });

  it('keeps an undated threat past the limit only while there is room left', () => {
    const threats = [
      threat('known-a', { activityScore: 0.9 }),
      threat('undated', { activityScore: null, lastObservedAt: null, combinedRelevance: 1 }),
      threat('known-b', { activityScore: 0.1 }),
    ];

    expect(rankScopeThreats([{ scenarioId: 's1', threats }], 2).map((row) => row.id)).toEqual(['known-a', 'known-b']);
    expect(rankScopeThreats([{ scenarioId: 's1', threats }], 3).map((row) => row.id)).toEqual(['known-a', 'known-b', 'undated']);
  });

  it('keeps an undated threat unknown over every scenario that admits it', () => {
    const undated = threat('undated', { activityScore: null, lastObservedAt: null });
    const ranked = rankScopeThreats([
      { scenarioId: 's1', threats: [undated] },
      { scenarioId: 's2', threats: [undated] },
    ], 6);

    expect(ranked).toEqual([expect.objectContaining({ id: 'undated', activityScore: null, lastObservedAt: null, scenarioCount: 2 })]);
  });

  it('keeps the best relevance a threat reaches over the scenarios it is admitted to', () => {
    const ranked = rankScopeThreats([
      { scenarioId: 's1', threats: [threat('a', { combinedRelevance: 0.1 }), threat('b', { combinedRelevance: 0.5 })] },
      { scenarioId: 's2', threats: [threat('a', { combinedRelevance: 0.8 }), threat('b', { combinedRelevance: 0.5 })] },
    ], 6);

    expect(ranked.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('keeps at most the limit', () => {
    const threats = Array.from({ length: 8 }, (_, index) => threat(`t${index}`, { activityScore: index / 10 }));
    const ranked = rankScopeThreats([{ scenarioId: 's1', threats }], 6);

    expect(ranked.map((row) => row.id)).toEqual(['t7', 't6', 't5', 't4', 't3', 't2']);
  });

  it('lists nothing when no scenario admits a threat', () => {
    expect(rankScopeThreats([{ scenarioId: 's1', threats: [] }], 6)).toEqual([]);
  });
});

const valueRow = (mitreTechniqueId: string, preventValue: number | null, detectValue: number | null): TechniqueValueRow => ({
  mitreTechniqueId,
  externalId: mitreTechniqueId.toUpperCase(),
  name: `Technique ${mitreTechniqueId}`,
  preventValue,
  detectValue,
});

const tactics = [
  { id: 'initial-access', externalId: 'TA0001', name: 'Initial Access' },
  { id: 'persistence', externalId: 'TA0003', name: 'Persistence' },
  { id: 'impact', externalId: 'TA0040', name: 'Impact' },
];

describe('aggregateTechniqueGains', () => {
  it('sums each lever over the runs and totals them', () => {
    const gains = aggregateTechniqueGains(
      [valueRow('t1566', 100, 40), valueRow('t1566', 20, 5)],
      [{ techniqueId: 't1566', tacticId: 'initial-access' }],
      tactics,
    );

    expect(gains[0].techniques).toEqual([
      { id: 't1566', externalId: 'T1566', name: 'Technique t1566', prevention: 120, detection: 45, total: 165 },
    ]);
  });

  it('files a technique under every tactic it belongs to, tactics in the order given', () => {
    const gains = aggregateTechniqueGains(
      [valueRow('t1078', 10, 10)],
      [{ techniqueId: 't1078', tacticId: 'persistence' }, { techniqueId: 't1078', tacticId: 'initial-access' }],
      tactics,
    );

    expect(gains.map((tactic) => [tactic.externalId, tactic.techniques.map((technique) => technique.externalId)])).toEqual([
      ['TA0001', ['T1078']],
      ['TA0003', ['T1078']],
      ['TA0040', []],
    ]);
  });

  it('orders a tactic largest total first', () => {
    const gains = aggregateTechniqueGains(
      [valueRow('small', 1, 1), valueRow('large', 50, 0), valueRow('zero', 0, 0)],
      ['small', 'large', 'zero'].map((techniqueId) => ({ techniqueId, tacticId: 'impact' })),
      tactics,
    );

    expect(gains[2].techniques.map((technique) => technique.id)).toEqual(['large', 'small', 'zero']);
  });

  it('adds nothing for a row its run did not price', () => {
    const gains = aggregateTechniqueGains(
      [valueRow('t1566', 100, 40), valueRow('t1566', null, 10), valueRow('t1190', 30, null)],
      [{ techniqueId: 't1566', tacticId: 'initial-access' }, { techniqueId: 't1190', tacticId: 'initial-access' }],
      tactics,
    );

    expect(gains[0].techniques).toEqual([expect.objectContaining({ id: 't1566', prevention: 100, detection: 40, total: 140 })]);
  });
});
