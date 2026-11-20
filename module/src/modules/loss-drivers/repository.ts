import { and, asc, eq, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';

/** Closed catalog: the loss model is seeded, so the repository is read-only. */
export const lossDriversRepository = defineRepository({
  findLossDriverById: async ({ db, views }, id: string) => (await db
    .select({
      id: views.lossDrivers.id,
      name: views.lossDrivers.name,
      description: views.lossDrivers.description,
      displayOrder: views.lossDrivers.displayOrder,
      lossCategoryId: views.lossDrivers.lossCategoryId,
      lossCategoryName: views.lossCategories.name,
      lossCategoryDisplayOrder: views.lossCategories.displayOrder,
      dwellSensitivity: views.lossDrivers.dwellSensitivity,
      scalingVariable: views.lossDrivers.scalingVariable,
    })
    .from(views.lossDrivers)
    .innerJoin(views.lossCategories, eq(views.lossDrivers.lossCategoryId, views.lossCategories.id))
    .where(eq(views.lossDrivers.id, id))
    .limit(1)).at(0),
  findAllLossDrivers: ({ db, views }) => db
    .select({
      id: views.lossDrivers.id,
      name: views.lossDrivers.name,
      description: views.lossDrivers.description,
      displayOrder: views.lossDrivers.displayOrder,
      lossCategoryId: views.lossDrivers.lossCategoryId,
      lossCategoryName: views.lossCategories.name,
      lossCategoryDisplayOrder: views.lossCategories.displayOrder,
      dwellSensitivity: views.lossDrivers.dwellSensitivity,
      scalingVariable: views.lossDrivers.scalingVariable,
    })
    .from(views.lossDrivers)
    .innerJoin(views.lossCategories, eq(views.lossDrivers.lossCategoryId, views.lossCategories.id))
    .orderBy(asc(views.lossCategories.displayOrder), asc(views.lossDrivers.displayOrder)),

  /**
   * The business-value categories an attack outcome can touch.
   * Compatibility is the existence of an activation row for the pair, so the distinct categories of
   * the outcome's rows are the answer; nothing stores it a second time.
   */
  findCompatibleBusinessValueCategoryIds: async ({ db, views }, attackOutcomeId: string) => (await db
    .selectDistinct({ businessValueCategoryId: views.lossDriverActivations.businessValueCategoryId })
    .from(views.lossDriverActivations)
    .where(eq(views.lossDriverActivations.attackOutcomeId, attackOutcomeId)))
    .map((row) => row.businessValueCategoryId),

  /**
   * One row per (loss driver, justifying cell) for a scenario: the activation rows of its attack
   * outcome, restricted to the business resources the scenario declares as its loss scope.
   * `selectDistinct` is the union rule: the scenario's resources open the union of their columns.
   */
  findRecommendedDriversForScenario: ({ db, views }, riskScenarioId: string) => db
    .selectDistinct({
      lossDriverId: views.lossDriverActivations.lossDriverId,
      attackOutcomeId: views.lossDriverActivations.attackOutcomeId,
      attackOutcomeName: views.attackOutcomes.name,
      businessValueCategoryId: views.lossDriverActivations.businessValueCategoryId,
      businessValueCategoryCode: views.businessValueCategories.code,
      businessValueCategoryName: views.businessValueCategories.name,
      lossCategoryDisplayOrder: views.lossCategories.displayOrder,
      lossDriverDisplayOrder: views.lossDrivers.displayOrder,
    })
    .from(views.riskScenarios)
    .innerJoin(views.riskScenarioBusinessValueCategories, eq(views.riskScenarioBusinessValueCategories.riskScenarioId, views.riskScenarios.id))
    .innerJoin(views.lossDriverActivations, and(
      eq(views.lossDriverActivations.attackOutcomeId, views.riskScenarios.attackOutcomeId),
      eq(views.lossDriverActivations.businessValueCategoryId, views.riskScenarioBusinessValueCategories.businessValueCategoryId),
    ))
    .innerJoin(views.attackOutcomes, eq(views.attackOutcomes.id, views.lossDriverActivations.attackOutcomeId))
    .innerJoin(views.businessValueCategories, eq(views.businessValueCategories.id, views.lossDriverActivations.businessValueCategoryId))
    .innerJoin(views.lossDrivers, eq(views.lossDrivers.id, views.lossDriverActivations.lossDriverId))
    .innerJoin(views.lossCategories, eq(views.lossCategories.id, views.lossDrivers.lossCategoryId))
    .where(eq(views.riskScenarios.id, riskScenarioId))
    .orderBy(asc(views.lossCategories.displayOrder), asc(views.lossDrivers.displayOrder)),

  /**
   * Every compatible (outcome, category) pairing, names joined, flagged with whether a single driver
   * applies to it. The pairings absent from the result are the ones the model holds unrealistic, and
   * a page that only knew where the driver applies could not tell those two cases apart.
   */
  findLossDriverActivations: ({ db, views }, lossDriverId: string) => db
    .select({
      attackOutcomeId: views.attackOutcomes.id,
      attackOutcomeName: views.attackOutcomes.name,
      businessValueCategoryId: views.businessValueCategories.id,
      businessValueCategoryCode: views.businessValueCategories.code,
      businessValueCategoryName: views.businessValueCategories.name,
      businessValueCategoryDisplayOrder: views.businessValueCategories.displayOrder,
      applies: sql<boolean>`bool_or(${views.lossDriverActivations.lossDriverId} = ${lossDriverId})`,
    })
    .from(views.lossDriverActivations)
    .innerJoin(views.attackOutcomes, eq(views.attackOutcomes.id, views.lossDriverActivations.attackOutcomeId))
    .innerJoin(views.businessValueCategories, eq(views.businessValueCategories.id, views.lossDriverActivations.businessValueCategoryId))
    .groupBy(views.attackOutcomes.id, views.attackOutcomes.name, views.businessValueCategories.id, views.businessValueCategories.code, views.businessValueCategories.name, views.businessValueCategories.displayOrder)
    .orderBy(asc(views.attackOutcomes.name), asc(views.businessValueCategories.displayOrder)),
});
