import { newError } from '@app/utils';
import { defineService } from '../../registry';
import { lossDriversRepository } from './repository';

/** A cell of the activation matrix, named, that justifies recommending a driver. */
export interface RecommendationCell {
  attackOutcomeId: string,
  attackOutcomeName: string,
  businessValueCategoryId: string,
  businessValueCategoryCode: string,
  businessValueCategoryName: string,
}

export interface ScenarioDriverRecommendation {
  /**
   * How many cells of the matrix the scenario activates. Zero alone distinguishes "this outcome and
   * these resources have nothing in common" from "this scenario declares no loss scope yet": an
   * empty recommendation list cannot say which.
   */
  compatibleCellCount: number,
  recommendations: Array<{ lossDriverId: string, viaCells: Array<RecommendationCell> }>,
}

/** Read-only catalog: the nineteen drivers are seeded, never tenant-authored. */
export const lossDriversService = defineService(
  'lossDrivers',
  lossDriversRepository,
).implement({
  getLossDriver: async ({ repo }, id: string) => await repo.findLossDriverById(id),
  getLossDrivers: async ({ repo }) => await repo.findAllLossDrivers(),
  getCompatibleBusinessValueCategoryIds: async ({ repo }, attackOutcomeId: string) =>
    await repo.findCompatibleBusinessValueCategoryIds(attackOutcomeId),
  /**
   * The drivers the matrix recommends for a scenario, each carrying the cells that justify it.
   * The recommendation is a rendering of this read: nothing materializes as an estimate row, and
   * nothing here may ever refuse a driver the analyst wants to price.
   */
  getScenarioDriverRecommendation: async ({ repo }, riskScenarioId: string): Promise<ScenarioDriverRecommendation> => {
    const rows = await repo.findRecommendedDriversForScenario(riskScenarioId);

    const byDriver = new Map<string, Array<RecommendationCell>>();
    const cells = new Set<string>();
    for (const row of rows) {
      cells.add(`${row.attackOutcomeId}/${row.businessValueCategoryId}`);
      const viaCells = byDriver.get(row.lossDriverId) ?? [];
      viaCells.push({
        attackOutcomeId: row.attackOutcomeId,
        attackOutcomeName: row.attackOutcomeName,
        businessValueCategoryId: row.businessValueCategoryId,
        businessValueCategoryCode: row.businessValueCategoryCode,
        businessValueCategoryName: row.businessValueCategoryName,
      });
      byDriver.set(row.lossDriverId, viaCells);
    }

    return {
      compatibleCellCount: cells.size,
      recommendations: [...byDriver].map(([lossDriverId, viaCells]) => ({ lossDriverId, viaCells })),
    };
  },
  getLossDriverActivations: async ({ repo }, lossDriverId: string) => {
    const driver = await repo.findLossDriverById(lossDriverId);
    if (!driver) {
      throw newError('Loss driver not found');
    }
    return await repo.findLossDriverActivations(lossDriverId);
  },
});
