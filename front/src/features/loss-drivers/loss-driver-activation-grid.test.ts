import { describe, expect, it } from 'vitest';
import type { ActivationCell } from './loss-driver-activation-grid';
import { buildActivationGrid } from './loss-driver-activation-grid';

const OUTCOMES = ['Data breach', 'Espionage', 'Ransomware'];
const CATEGORIES = ['services-under-commitments', 'personal-data', 'payment-card-data'];

/** A compatible matrix of three outcomes by three resources, with `applies` decided per pairing. */
const buildCells = (applies: (outcome: string, category: string) => boolean): Array<ActivationCell> =>
  OUTCOMES.flatMap((outcome) => CATEGORIES.map((category, index) => ({
    attackOutcomeId: `outcome-${outcome}`,
    attackOutcomeName: outcome,
    businessValueCategoryId: `category-${category}`,
    businessValueCategoryCode: category,
    businessValueCategoryName: category,
    businessValueCategoryDisplayOrder: index + 1,
    applies: applies(outcome, category),
  })));

describe('buildActivationGrid', () => {
  it('marks every pairing for a driver that applies everywhere', () => {
    const grid = buildActivationGrid(buildCells(() => true));

    expect(grid.outcomes.map((outcome) => outcome.name)).toEqual(OUTCOMES);
    expect(grid.categories.map((category) => category.code)).toEqual(CATEGORIES);
    expect(grid.states.flat()).toEqual(Array.from({ length: 9 }, () => 'applies'));
  });

  it('marks a single pairing for a driver that applies once, the rest merely compatible', () => {
    const grid = buildActivationGrid(
      buildCells((outcome, category) => outcome === 'Ransomware' && category === 'payment-card-data'),
    );

    expect(grid.states[2][2]).toBe('applies');
    expect(grid.states.flat().filter((state) => state === 'applies')).toHaveLength(1);
    expect(grid.states.flat().filter((state) => state === 'compatible')).toHaveLength(8);
  });

  it('reports a pairing the matrix does not carry as incompatible, not as merely unselected', () => {
    const cells = buildCells(() => false)
      .filter((cell) => !(cell.attackOutcomeName === 'Espionage' && cell.businessValueCategoryCode === 'payment-card-data'));

    const grid = buildActivationGrid(cells);

    expect(grid.states[1][2]).toBe('incompatible');
    expect(grid.states.flat().filter((state) => state === 'incompatible')).toHaveLength(1);
  });

  it('orders outcomes by name and resources by their catalog display order', () => {
    const grid = buildActivationGrid(buildCells(() => false));

    expect(grid.outcomes.map((outcome) => outcome.name)).toEqual(['Data breach', 'Espionage', 'Ransomware']);
    expect(grid.categories.map((category) => category.code)).toEqual(CATEGORIES);
  });
});
