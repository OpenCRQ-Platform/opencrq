import { describe, expect, it } from 'vitest';
import { computeUniqueScore } from './unique-score';
import { explainUniqueScore } from './unique-score-composition';

describe('explainUniqueScore', () => {
  it('gives no composition to a group with no scored finding', () => {
    expect(explainUniqueScore([])).toBeNull();
    expect(explainUniqueScore([{ scores: [], assetCount: 3 }])).toBeNull();
  });

  it('weighs each level as assets at the worst finding exact score', () => {
    const composition = explainUniqueScore([
      { scores: Array.from({ length: 30 }, () => 74), assetCount: 30 },
      { scores: Array.from({ length: 8 }, () => 78), assetCount: 8 },
      { scores: Array.from({ length: 82 }, () => 70), assetCount: 82 },
    ]);

    expect(composition?.levels.map((level) => [level.score, level.band, level.assetCount])).toEqual([
      [78, 'high', 8],
      [74, 'high', 30],
      [70, 'high', 82],
    ]);
    expect(composition?.levels[0]?.equivalent).toBeCloseTo(8, 10);
    expect(composition?.levels[1]?.equivalent).toBeCloseTo(30 * Math.exp(-4), 10);
    expect(composition?.levels[2]?.equivalent).toBeCloseTo(82 * Math.exp(-8), 10);
  });

  it('adds up to the persisted score to the last bit', () => {
    const levels = [
      { scores: [78.62, 78.04], assetCount: 2 },
      { scores: [74.9, 74.31, 74.3], assetCount: 3 },
      { scores: [70.12], assetCount: 1 },
    ];
    const composition = explainUniqueScore(levels);
    const persisted = computeUniqueScore(levels.flatMap((level) => level.scores));

    expect(composition?.worst).toBe(78.62);
    expect(composition?.unrounded).toBe(persisted);
    expect(composition!.worst + Math.log(composition!.equivalentSum)).toBe(persisted);
    expect(composition?.breadth).toBe(Math.log(composition!.equivalentSum));
    expect(composition?.levels.reduce((sum, level) => sum + level.equivalent, 0)).toBeCloseTo(composition!.equivalentSum, 12);
  });

  it('counts a level below the worst one for less than one even at the worst figure', () => {
    const composition = explainUniqueScore([{ scores: [80.9, 80.1], assetCount: 2 }]);

    expect(composition?.levels).toHaveLength(1);
    expect(composition?.levels[0]?.equivalent).toBeCloseTo(1 + Math.exp(-0.8), 10);
  });

  it('keeps the uncapped breadth beside a score held at 100', () => {
    const composition = explainUniqueScore([{ scores: Array.from({ length: 1000 }, () => 97), assetCount: 1000 }]);

    expect(composition?.unrounded).toBe(100);
    expect(composition!.worst + composition!.breadth).toBeGreaterThan(100);
  });

  it('reads a CVE on hundreds of thousands of assets without running past the argument limit', () => {
    const composition = explainUniqueScore([{ scores: Array.from({ length: 300_000 }, () => 60), assetCount: 300_000 }]);

    expect(composition?.worst).toBe(60);
    expect(composition?.levels[0]?.equivalent).toBeCloseTo(300_000, 6);
  });
});
