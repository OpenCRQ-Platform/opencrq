import { describe, expect, it } from 'vitest';
import { rankOutcomesForThreat } from './threat-attack-outcomes-utils';

const outcome = (name: string, score: number) => ({ attackOutcomeId: `id-${name}`, outcomeName: name, score });

describe('rankOutcomesForThreat', () => {
  it('should list the highest percentage first, ties by name', () => {
    const ranked = rankOutcomesForThreat([outcome('Espionage', 0.2), outcome('Ransomware', 0.7), outcome('Data theft', 0.2)]);

    expect(ranked.map((entry) => entry.outcomeName)).toEqual(['Ransomware', 'Data theft', 'Espionage']);
  });

  it('should mark the outcomes above 50% and only those', () => {
    const ranked = rankOutcomesForThreat([outcome('A', 0.51), outcome('B', 0.5), outcome('C', 0.1)]);

    expect(ranked.map((entry) => entry.weighsOn)).toEqual([true, false, false]);
  });

  it('should not mutate its input', () => {
    const input = [outcome('A', 0.1), outcome('B', 0.9)];
    rankOutcomesForThreat(input);

    expect(input.map((entry) => entry.outcomeName)).toEqual(['A', 'B']);
  });
});
