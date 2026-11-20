import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';
import type { SecuredSchema } from '../../security';
import { defineRepository } from '../../registry';
import { LATERAL_ON } from '../../db/lateral';
import { latestRunFirst, latestRunOf } from '../crq-indicators/latest-run';
import {
  budgetReviewClosedFigures,
  budgetReviewClosedPostures,
  budgetReviewClosedTolerances,
  budgetReviewLineControls,
  budgetReviewLines,
  budgetReviews,
} from './schema';

export type BudgetReviewUpdate = Partial<Pick<typeof budgetReviews.$inferInsert, 'name' | 'ownerId' | 'context' | 'periodStart'>>;
export type BudgetReviewLineUpdate = Partial<Pick<typeof budgetReviewLines.$inferInsert, 'name' | 'nature' | 'amountSpent' | 'amortizationYears'>>;

/**
 * Every column of the review plus the two names a row cannot resolve on its own. Drizzle nulls a
 * nested group from its first column alone, so each group leads with an id a real row always
 * carries.
 */
const reviewSelection = (views: SecuredSchema) => ({
  id: views.budgetReviews.id,
  organizationId: views.budgetReviews.organizationId,
  name: views.budgetReviews.name,
  ownerId: views.budgetReviews.ownerId,
  periodStart: views.budgetReviews.periodStart,
  context: views.budgetReviews.context,
  status: views.budgetReviews.status,
  version: views.budgetReviews.version,
  closedAt: views.budgetReviews.closedAt,
  createdAt: views.budgetReviews.createdAt,
  updatedAt: views.budgetReviews.updatedAt,
  organization: { id: views.organizations.id, name: views.organizations.name },
  owner: { id: views.users.id, name: views.users.name },
});

/**
 * For each named review, the latest run of every scenario, optionally of one scope, that stored
 * figures for it. A run that did not price the reviews stores none, so it never hides the one that
 * did.
 *
 * bounded-by: restricted inside to the named reviews' result rows
 */
const pricingRunsOf = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>, reviewIds: Array<string>, organizationId?: string) => db
  .selectDistinctOn([views.crqBudgetReviewResults.reviewId, views.crqIndicatorRuns.riskScenarioId], {
    reviewId: views.crqBudgetReviewResults.reviewId,
    runId: views.crqIndicatorRuns.id,
    riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
    createdAt: views.crqIndicatorRuns.createdAt,
  })
  .from(views.crqBudgetReviewResults)
  .innerJoin(views.crqIndicatorRuns, eq(views.crqBudgetReviewResults.runId, views.crqIndicatorRuns.id))
  .innerJoin(views.riskScenarios, eq(views.crqIndicatorRuns.riskScenarioId, views.riskScenarios.id))
  .where(and(
    inArray(views.crqBudgetReviewResults.reviewId, reviewIds),
    organizationId === undefined ? undefined : eq(views.riskScenarios.organizationId, organizationId),
  ))
  .orderBy(
    views.crqBudgetReviewResults.reviewId,
    views.crqIndicatorRuns.riskScenarioId,
    ...latestRunFirst(views),
  )
  .as('pricing_run');

export const budgetReviewsRepository = defineRepository({
  insertBudgetReview: ({ db }, values: typeof budgetReviews.$inferInsert) =>
    db.insert(budgetReviews).values([values]),

  findBudgetReviews: ({ db, views }, organizationId?: string) =>
    db.select(reviewSelection(views))
      .from(views.budgetReviews)
      .innerJoin(views.organizations, eq(views.budgetReviews.organizationId, views.organizations.id))
      .leftJoin(views.users, eq(views.budgetReviews.ownerId, views.users.id))
      .where(organizationId === undefined ? undefined : eq(views.budgetReviews.organizationId, organizationId))
      .orderBy(desc(views.budgetReviews.periodStart), desc(views.budgetReviews.createdAt)),

  findBudgetReviewById: ({ db, views }, id: string) =>
    db.select(reviewSelection(views))
      .from(views.budgetReviews)
      .innerJoin(views.organizations, eq(views.budgetReviews.organizationId, views.organizations.id))
      .leftJoin(views.users, eq(views.budgetReviews.ownerId, views.users.id))
      .where(eq(views.budgetReviews.id, id))
      .limit(1)
      .then((rows) => rows.at(0)),

  /** The open reviews of one scope, the only ones a run prices. */
  findOpenBudgetReviews: ({ db, views }, organizationId: string) =>
    db.select({ id: views.budgetReviews.id, periodStart: views.budgetReviews.periodStart, version: views.budgetReviews.version })
      .from(views.budgetReviews)
      .where(and(eq(views.budgetReviews.organizationId, organizationId), eq(views.budgetReviews.status, 'open')))
      .orderBy(asc(views.budgetReviews.createdAt), asc(views.budgetReviews.id)),

  findOrganizationById: ({ db, views }, organizationId: string) =>
    db.select({ id: views.organizations.id })
      .from(views.organizations)
      .where(eq(views.organizations.id, organizationId))
      .limit(1)
      .then((rows) => rows.at(0)),

  /** The secured users view holds the caller's tenant members only, and the foreign key would take any user. */
  findTenantMemberById: ({ db, views }, userId: string) =>
    db.select({ id: views.users.id })
      .from(views.users)
      .where(eq(views.users.id, userId))
      .limit(1)
      .then((rows) => rows.at(0)),

  findCapabilities:({ db, views }, capabilityIds?: Array<string>) =>
    db.select({ id: views.controlCapabilities.id, externalId: views.controlCapabilities.externalId, name: views.controlCapabilities.name })
      .from(views.controlCapabilities)
      .where(capabilityIds === undefined ? undefined : inArray(views.controlCapabilities.id, capabilityIds))
      .orderBy(asc(views.controlCapabilities.externalId)),

  updateBudgetReview: ({ db }, id: string, values: BudgetReviewUpdate) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    return db.update(budgetReviews).set({ ...values, updatedAt }).where(eq(budgetReviews.id, id));
  },

  closeBudgetReview: ({ db }, id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const now = sql`now()` as unknown as Date;
    return db.update(budgetReviews).set({ status: 'closed', closedAt: now, updatedAt: now }).where(eq(budgetReviews.id, id));
  },

  reopenBudgetReview: ({ db }, id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const now = sql`now()` as unknown as Date;
    return db.update(budgetReviews).set({ status: 'open', closedAt: null, updatedAt: now }).where(eq(budgetReviews.id, id));
  },

  deleteBudgetReviews: ({ db }, ids: Array<string>) =>
    db.delete(budgetReviews).where(inArray(budgetReviews.id, ids)),

  /**
   * Locks the named reviews for the rest of the transaction, so every write of a review or of its
   * lines (a period edit, a closing, a reopening, a line change) is serialized. It closes the window
   * **only because the caller runs inside `atomic`**. The rows are taken in id order, since two
   * callers locking the same pair the other way round would deadlock.
   */
  lockBudgetReviewsForUpdate: ({ db, views }, reviewIds: Array<string>) =>
    db.select({ id: views.budgetReviews.id, status: views.budgetReviews.status, periodStart: views.budgetReviews.periodStart })
      .from(views.budgetReviews)
      .where(inArray(views.budgetReviews.id, reviewIds))
      .orderBy(views.budgetReviews.id)
      .for('update'),

  /**
   * Expires every figure priced against what the review held before. It runs in the transaction of
   * the write it accompanies: a run reading the review between the two would otherwise store a
   * figure under a version that never described anything.
   */
  bumpBudgetReviewVersion: ({ db }, reviewIds: Array<string>) =>
    db.update(budgetReviews)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to number for integer columns
      .set({ version: sql`version + 1` as unknown as number })
      .where(inArray(budgetReviews.id, reviewIds)),

  findLinesByReviewIds: ({ db, views }, reviewIds: Array<string>) =>
    db.select().from(views.budgetReviewLines)
      .where(inArray(views.budgetReviewLines.reviewId, reviewIds))
      .orderBy(asc(views.budgetReviewLines.createdAt), asc(views.budgetReviewLines.id)),

  findCsfCrosswalk: async ({ db, views }, capabilityIds: Array<string>) => (capabilityIds.length === 0
    ? []
    : await db.select({ capabilityId: views.controlCapabilityCrosswalk.capabilityId, externalId: views.controlCapabilityCrosswalk.externalId })
      .from(views.controlCapabilityCrosswalk)
      .where(and(
        inArray(views.controlCapabilityCrosswalk.capabilityId, capabilityIds),
        eq(views.controlCapabilityCrosswalk.framework, 'csf_2_0'),
      ))),

  findLinesByIds: ({ db, views }, lineIds: Array<string>) =>
    db.select().from(views.budgetReviewLines).where(inArray(views.budgetReviewLines.id, lineIds)),

  findLineControlsByReviewIds: ({ db, views }, reviewIds: Array<string>) =>
    db.select({
      lineId: views.budgetReviewLineControls.lineId,
      reviewId: views.budgetReviewLineControls.reviewId,
      capabilityId: views.budgetReviewLineControls.capabilityId,
    })
      .from(views.budgetReviewLineControls)
      .where(inArray(views.budgetReviewLineControls.reviewId, reviewIds))
      .orderBy(asc(views.budgetReviewLineControls.capabilityId)),

  insertLine: ({ db }, values: typeof budgetReviewLines.$inferInsert) =>
    db.insert(budgetReviewLines).values([values]),

  updateLine: ({ db }, id: string, values: BudgetReviewLineUpdate) =>
    db.update(budgetReviewLines).set(values).where(eq(budgetReviewLines.id, id)),

  deleteLines: ({ db }, ids: Array<string>) =>
    db.delete(budgetReviewLines).where(inArray(budgetReviewLines.id, ids)),

  insertLineControls: async ({ db }, rows: Array<typeof budgetReviewLineControls.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(budgetReviewLineControls).values(rows);
    }
  },

  deleteLineControls: ({ db }, lineId: string) =>
    db.delete(budgetReviewLineControls).where(eq(budgetReviewLineControls.lineId, lineId)),

  /**
   * The stored figures of the named reviews, each scenario's from the latest run that priced the
   * review. `olderThanHeadline` compares that run with the scenario's latest run, read in this same
   * query so that a closing, which reads one query at a time in its transaction, sees a flag
   * consistent with the rows.
   */
  findReviewResultRows: ({ db, views }, reviewIds: Array<string>, organizationId?: string) => {
    const pricingRuns = pricingRunsOf({ db, views }, reviewIds, organizationId);
    const latestRun = latestRunOf({ db, views }, { id: views.crqIndicatorRuns.id }, { riskScenarioId: pricingRuns.riskScenarioId });
    return db
      .select({
        reviewId: views.crqBudgetReviewResults.reviewId,
        runId: pricingRuns.runId,
        riskScenarioId: pricingRuns.riskScenarioId,
        runCreatedAt: pricingRuns.createdAt,
        reviewVersion: views.crqBudgetReviewResults.reviewVersion,
        basket: views.crqBudgetReviewResults.basket,
        lineId: views.crqBudgetReviewResults.lineId,
        aleReductionMean: views.crqBudgetReviewResults.aleReductionMean,
        aleReductionP10: views.crqBudgetReviewResults.aleReductionP10,
        aleReductionP90: views.crqBudgetReviewResults.aleReductionP90,
        olderThanHeadline: sql<boolean>`${pricingRuns.runId} <> ${latestRun.id}`,
      })
      .from(views.crqBudgetReviewResults)
      .innerJoin(pricingRuns, and(
        eq(views.crqBudgetReviewResults.runId, pricingRuns.runId),
        eq(views.crqBudgetReviewResults.reviewId, pricingRuns.reviewId),
      ))
      .innerJoinLateral(latestRun, LATERAL_ON);
  },

  /**
   * The stored annual losses of one review on the runs its figures were read from. Selecting the
   * latest pricing run a second time would let a run committing between the two reads pair one
   * run's figures with another's curves.
   */
  findReviewAnnualLossRows: ({ db, views }, reviewId: string, runIds: Array<string>) => db
    .select({
      riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
      reviewVersion: views.crqBudgetReviewAnnualLosses.reviewVersion,
      posture: views.crqBudgetReviewAnnualLosses.posture,
      lossYearShare: views.crqBudgetReviewAnnualLosses.lossYearShare,
      probabilities: views.crqBudgetReviewAnnualLosses.probabilities,
      losses: views.crqBudgetReviewAnnualLosses.losses,
    })
    .from(views.crqBudgetReviewAnnualLosses)
    .innerJoin(views.crqIndicatorRuns, eq(views.crqBudgetReviewAnnualLosses.runId, views.crqIndicatorRuns.id))
    .where(and(
      eq(views.crqBudgetReviewAnnualLosses.reviewId, reviewId),
      inArray(views.crqBudgetReviewAnnualLosses.runId, runIds),
    )),

  /** The build figure and the curve steps every run stored for one review at one version, oldest run first. */
  findReviewBuildHistoryRows: ({ db, views }, reviewId: string, version: number) =>
    db
      .select({
        runId: views.crqIndicatorRuns.id,
        riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
        runCreatedAt: views.crqIndicatorRuns.createdAt,
        basket: views.crqBudgetReviewResults.basket,
        stepOn: views.crqBudgetReviewResults.stepOn,
        aleReductionMean: views.crqBudgetReviewResults.aleReductionMean,
      })
      .from(views.crqBudgetReviewResults)
      .innerJoin(views.crqIndicatorRuns, eq(views.crqBudgetReviewResults.runId, views.crqIndicatorRuns.id))
      .where(and(
        eq(views.crqBudgetReviewResults.reviewId, reviewId),
        eq(views.crqBudgetReviewResults.reviewVersion, version),
        inArray(views.crqBudgetReviewResults.basket, ['build', 'step', 'step-level']),
      ))
      .orderBy(asc(views.crqIndicatorRuns.createdAt), asc(views.crqIndicatorRuns.id)),

  /** The mean annual loss at the review's reference posture, per run that priced it at one version. */
  findReviewReferenceMeans: ({ db, views }, reviewId: string, version: number) =>
    db
      .select({ runId: views.crqBudgetReviewAnnualLosses.runId, mean: views.crqBudgetReviewAnnualLosses.mean })
      .from(views.crqBudgetReviewAnnualLosses)
      .where(and(
        eq(views.crqBudgetReviewAnnualLosses.reviewId, reviewId),
        eq(views.crqBudgetReviewAnnualLosses.reviewVersion, version),
        eq(views.crqBudgetReviewAnnualLosses.posture, 'reference'),
      )),

  findScenarioRiskTolerances: ({ db, views }, organizationId: string) =>
    db
      .select({
        riskScenarioId: views.riskScenarios.id,
        scope: {
          annualLoss: views.organizationRiskTolerances.annualLoss,
          maxExceedanceProbability: views.organizationRiskTolerances.maxExceedanceProbability,
        },
        own: {
          annualLoss: views.riskScenarioRiskTolerances.annualLoss,
          maxExceedanceProbability: views.riskScenarioRiskTolerances.maxExceedanceProbability,
        },
      })
      .from(views.riskScenarios)
      .leftJoin(views.organizationRiskTolerances, eq(views.organizationRiskTolerances.organizationId, views.riskScenarios.organizationId))
      .leftJoin(views.riskScenarioRiskTolerances, eq(views.riskScenarioRiskTolerances.riskScenarioId, views.riskScenarios.id))
      .where(eq(views.riskScenarios.organizationId, organizationId)),

  insertClosedFigures: async ({ db }, rows: Array<typeof budgetReviewClosedFigures.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(budgetReviewClosedFigures).values(rows);
    }
  },

  insertClosedPostures: async ({ db }, rows: Array<typeof budgetReviewClosedPostures.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(budgetReviewClosedPostures).values(rows);
    }
  },

  insertClosedTolerances: async ({ db }, rows: Array<typeof budgetReviewClosedTolerances.$inferInsert>) => {
    if (rows.length > 0) {
      await db.insert(budgetReviewClosedTolerances).values(rows);
    }
  },

  deleteClosedTolerances: ({ db }, reviewId: string) =>
    db.delete(budgetReviewClosedTolerances).where(eq(budgetReviewClosedTolerances.reviewId, reviewId)),

  findClosedTolerances: ({ db, views }, reviewId: string) =>
    db.select({
      riskScenarioId: views.budgetReviewClosedTolerances.riskScenarioId,
      scenarioName: views.budgetReviewClosedTolerances.scenarioName,
      toleranceAnnualLoss: views.budgetReviewClosedTolerances.toleranceAnnualLoss,
      toleranceMaxExceedanceProbability: views.budgetReviewClosedTolerances.toleranceMaxExceedanceProbability,
      toleranceSource: views.budgetReviewClosedTolerances.toleranceSource,
      referenceLosses: views.budgetReviewClosedTolerances.referenceLosses,
      referenceProbabilities: views.budgetReviewClosedTolerances.referenceProbabilities,
      withoutBuildLosses: views.budgetReviewClosedTolerances.withoutBuildLosses,
      withoutBuildProbabilities: views.budgetReviewClosedTolerances.withoutBuildProbabilities,
    })
      .from(views.budgetReviewClosedTolerances)
      .where(eq(views.budgetReviewClosedTolerances.reviewId, reviewId)),

  deleteClosedFigures: ({ db }, reviewId: string) =>
    db.delete(budgetReviewClosedFigures).where(eq(budgetReviewClosedFigures.reviewId, reviewId)),

  deleteClosedPostures: ({ db }, reviewId: string) =>
    db.delete(budgetReviewClosedPostures).where(eq(budgetReviewClosedPostures.reviewId, reviewId)),

  findClosedFigures: ({ db, views }, reviewIds: Array<string>) =>
    db.select().from(views.budgetReviewClosedFigures).where(inArray(views.budgetReviewClosedFigures.reviewId, reviewIds)),

  findClosedPostures: ({ db, views }, reviewId: string) =>
    db.select().from(views.budgetReviewClosedPostures).where(eq(views.budgetReviewClosedPostures.reviewId, reviewId)),
});
