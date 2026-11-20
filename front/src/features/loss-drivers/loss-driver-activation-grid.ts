/** One compatible pairing of the activation matrix, flagged for the driver being looked at. */
export interface ActivationCell {
  attackOutcomeId: string,
  attackOutcomeName: string,
  businessValueCategoryId: string,
  businessValueCategoryCode: string,
  businessValueCategoryName: string,
  businessValueCategoryDisplayOrder: number,
  applies: boolean,
}

/**
 * Three states, because two would lie: a pairing where the driver is absent is not the same thing
 * as a pairing the model holds unrealistic, and merging them would suggest the driver was merely
 * not selected there.
 */
export type ActivationCellState = 'applies' | 'compatible' | 'incompatible';

export interface ActivationGrid {
  outcomes: Array<{ id: string, name: string }>,
  categories: Array<{ id: string, code: string, name: string }>,
  /** Row per outcome, column per category, in the order of `outcomes` and `categories`. */
  states: Array<Array<ActivationCellState>>,
}

/**
 * Builds the outcome-by-category grid from the compatible cells of the matrix.
 *
 * The axes are read off the cells themselves: an outcome or a category that no compatible pairing
 * mentions has nothing to show and gets no row or column.
 */
export const buildActivationGrid = (cells: Array<ActivationCell>): ActivationGrid => {
  const outcomeById = new Map<string, string>();
  const categoryById = new Map<string, { code: string, name: string, displayOrder: number }>();
  const cellState = new Map<string, ActivationCellState>();

  for (const cell of cells) {
    outcomeById.set(cell.attackOutcomeId, cell.attackOutcomeName);
    categoryById.set(cell.businessValueCategoryId, {
      code: cell.businessValueCategoryCode,
      name: cell.businessValueCategoryName,
      displayOrder: cell.businessValueCategoryDisplayOrder,
    });
    cellState.set(
      `${cell.attackOutcomeId}/${cell.businessValueCategoryId}`,
      cell.applies ? 'applies' : 'compatible',
    );
  }

  // Outcomes carry no display order in the catalog, so the stored name is the only stable ranking.
  const outcomes = [...outcomeById]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const categories = [...categoryById]
    .map(([id, category]) => ({ id, code: category.code, name: category.name, displayOrder: category.displayOrder }))
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map(({ id, code, name }) => ({ id, code, name }));

  const states = outcomes.map((outcome) => categories.map((category) =>
    cellState.get(`${outcome.id}/${category.id}`) ?? 'incompatible'));

  return { outcomes, categories, states };
};
