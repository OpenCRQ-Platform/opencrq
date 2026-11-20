import { describe, expect, it } from 'vitest';
import { compareRelevantThreats, projectOutcomeScoreRows } from './outcome-selection';

const RANSOMWARE = 'outcome-ransomware';
const FRAUD = 'outcome-fraud';
const DISRUPTION = 'outcome-disruption';

const outcomeNameById = new Map([
  [RANSOMWARE, 'Ransomware'],
  [FRAUD, 'Financial Fraud'],
  [DISRUPTION, 'Disruption'],
]);

const project = (rows: Array<{ analysisId: string, attackOutcomeId: string, probability: number }>) =>
  projectOutcomeScoreRows(rows, outcomeNameById, 'tenant-1');

describe('projectOutcomeScoreRows', () => {
  it('should create no row for a probability of exactly 0.5', () => {
    expect(project([{ analysisId: 'a', attackOutcomeId: RANSOMWARE, probability: 0.5 }])).toEqual([]);
  });

  it('should create a row scored at the probability just above 0.5', () => {
    expect(project([{ analysisId: 'a', attackOutcomeId: RANSOMWARE, probability: 0.51 }])).toEqual([
      { analysisId: 'a', attackOutcomeId: RANSOMWARE, tenantId: 'tenant-1', score: 0.51, isTop: true },
    ]);
  });

  it('should flag the highest probability of an analysis as its top outcome', () => {
    const rows = project([
      { analysisId: 'a', attackOutcomeId: RANSOMWARE, probability: 0.6 },
      { analysisId: 'a', attackOutcomeId: FRAUD, probability: 0.9 },
      { analysisId: 'a', attackOutcomeId: DISRUPTION, probability: 0.2 },
    ]);
    expect(rows.map((row) => [row.attackOutcomeId, row.isTop])).toEqual([
      [RANSOMWARE, false],
      [FRAUD, true],
    ]);
  });

  it('should break a tie on the outcome name, ascending', () => {
    const rows = project([
      { analysisId: 'a', attackOutcomeId: RANSOMWARE, probability: 0.7 },
      { analysisId: 'a', attackOutcomeId: FRAUD, probability: 0.7 },
    ]);
    expect(rows.find((row) => row.isTop)?.attackOutcomeId).toBe(FRAUD);
  });

  it('should flag one top outcome per analysis', () => {
    const rows = project([
      { analysisId: 'a', attackOutcomeId: RANSOMWARE, probability: 0.8 },
      { analysisId: 'b', attackOutcomeId: FRAUD, probability: 0.55 },
      { analysisId: 'b', attackOutcomeId: RANSOMWARE, probability: 0.52 },
    ]);
    expect(rows.filter((row) => row.isTop).map((row) => [row.analysisId, row.attackOutcomeId])).toEqual([
      ['a', RANSOMWARE],
      ['b', FRAUD],
    ]);
  });

  it('should drop an analysis whose every probability is at or below 0.5', () => {
    expect(project([
      { analysisId: 'a', attackOutcomeId: RANSOMWARE, probability: 0.5 },
      { analysisId: 'a', attackOutcomeId: FRAUD, probability: 0.1 },
    ])).toEqual([]);
  });
});

describe('compareRelevantThreats', () => {
  const threat = (id: string, name: string, combinedRelevance: number) => ({ id, name, combinedRelevance });

  it('should order by relevance descending', () => {
    const sorted = [threat('1', 'A', 0.1), threat('2', 'B', 0.4)].sort(compareRelevantThreats);
    expect(sorted.map((row) => row.id)).toEqual(['2', '1']);
  });

  it('should order equal relevances by name', () => {
    const sorted = [threat('1', 'Zeta', 0.3), threat('2', 'Alpha', 0.3)].sort(compareRelevantThreats);
    expect(sorted.map((row) => row.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('should order equal relevances and names by id', () => {
    const sorted = [threat('b', 'Same', 0.3), threat('a', 'Same', 0.3)].sort(compareRelevantThreats);
    expect(sorted.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
