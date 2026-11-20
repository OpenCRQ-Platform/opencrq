import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SecuredSchema } from '../../security';
import { LATERAL_ON } from '../../db/lateral';
import { defineRepository } from '../../registry';
import { familyRunsQuery } from '../crq-indicators/family-runs';
import { latestRunOf } from '../crq-indicators/latest-run';
import { familyRunOwnership } from '../crq-indicators/run-profile';
import { treatmentPlanMoves, treatmentPlans } from './schema';

export type TreatmentPlanUpdate = Partial<Omit<typeof treatmentPlans.$inferInsert, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>;

/**
 * Every column of the plan plus the two names a row cannot resolve on its own. Drizzle nulls a
 * nested group from its first column alone, so each group leads with an id a real row always
 * carries.
 */
const planSelection = (views: SecuredSchema) => ({
  id: views.treatmentPlans.id,
  organizationId: views.treatmentPlans.organizationId,
  name: views.treatmentPlans.name,
  status: views.treatmentPlans.status,
  ownerId: views.treatmentPlans.ownerId,
  startDate: views.treatmentPlans.startDate,
  endDate: views.treatmentPlans.endDate,
  rationale: views.treatmentPlans.rationale,
  costOneOff: views.treatmentPlans.costOneOff,
  costRecurringAnnual: views.treatmentPlans.costRecurringAnnual,
  promisedAleReduction: views.treatmentPlans.promisedAleReduction,
  promisedAt: views.treatmentPlans.promisedAt,
  scopeVersion: views.treatmentPlans.scopeVersion,
  createdAt: views.treatmentPlans.createdAt,
  updatedAt: views.treatmentPlans.updatedAt,
  organization: { id: views.organizations.id, name: views.organizations.name },
  owner: { id: views.users.id, name: views.users.name },
});

export const treatmentPlansRepository = defineRepository({
  insertTreatmentPlan: ({ db }, values: typeof treatmentPlans.$inferInsert) =>
    db.insert(treatmentPlans).values([values]),

  findTreatmentPlans: ({ db, views }, organizationId?: string) =>
    db.select(planSelection(views))
      .from(views.treatmentPlans)
      .innerJoin(views.organizations, eq(views.treatmentPlans.organizationId, views.organizations.id))
      .leftJoin(views.users, eq(views.treatmentPlans.ownerId, views.users.id))
      .where(organizationId ? eq(views.treatmentPlans.organizationId, organizationId) : undefined)
      .orderBy(desc(views.treatmentPlans.createdAt)),

  findTreatmentPlanById: ({ db, views }, id: string) =>
    db.select(planSelection(views))
      .from(views.treatmentPlans)
      .innerJoin(views.organizations, eq(views.treatmentPlans.organizationId, views.organizations.id))
      .leftJoin(views.users, eq(views.treatmentPlans.ownerId, views.users.id))
      .where(eq(views.treatmentPlans.id, id))
      .limit(1)
      .then((rows) => rows.at(0)),

  findOrganizationById: ({ db, views }, organizationId: string) =>
    db.select({ id: views.organizations.id })
      .from(views.organizations)
      .where(eq(views.organizations.id, organizationId))
      .limit(1)
      .then((rows) => rows.at(0)),

  findMovesByPlanIds: ({ db, views }, planIds: Array<string>) =>
    db.select().from(views.treatmentPlanMoves).where(inArray(views.treatmentPlanMoves.planId, planIds)),

  updateTreatmentPlan: ({ db }, id: string, values: TreatmentPlanUpdate) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    return db.update(treatmentPlans).set({ ...values, updatedAt }).where(eq(treatmentPlans.id, id));
  },

  deleteTreatmentPlans: ({ db }, ids: Array<string>) =>
    db.delete(treatmentPlans).where(inArray(treatmentPlans.id, ids)),

  // One move per (plan, capability) is a database constraint, so two concurrent first-saves for the
  // same pair cannot both insert. ON CONFLICT turns the loser into an update, and `returning()`
  // hands back the row now in the table, whose id is the one it already had.
  upsertTreatmentPlanMove: ({ db }, values: typeof treatmentPlanMoves.$inferInsert) =>
    db.insert(treatmentPlanMoves).values([values]).onConflictDoUpdate({
      target: [treatmentPlanMoves.planId, treatmentPlanMoves.capabilityId],
      set: {
        targetStrengthRung: values.targetStrengthRung ?? null,
        targetCoverageBucket: values.targetCoverageBucket ?? null,
      },
    }).returning(),

  deleteTreatmentPlanMoves: ({ db }, ids: Array<string>) =>
    db.delete(treatmentPlanMoves).where(inArray(treatmentPlanMoves.id, ids)),

  /**
   * Locks the named plans for the rest of the transaction, so every write of their moves is
   * serialized. It closes the window **only because the caller runs inside `atomic`**: outside a
   * transaction the lock ends with the select that took it. The rows are taken in id order, since
   * two callers locking the same pair of plans the other way round would deadlock.
   */
  lockTreatmentPlansForUpdate: ({ db, views }, planIds: Array<string>) =>
    db.select({ id: views.treatmentPlans.id })
      .from(views.treatmentPlans)
      .where(inArray(views.treatmentPlans.id, planIds))
      .orderBy(views.treatmentPlans.id)
      .for('update'),

  /**
   * Invalidates every figure priced against the plan's previous set of moves. It runs in the same
   * transaction as the move write it accompanies: a run reading the targets between the two would
   * otherwise store a figure under a version that never described anything.
   */
  bumpTreatmentPlanScopeVersion: ({ db }, planIds: Array<string>) =>
    db.update(treatmentPlans)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to number for integer columns
      .set({ scopeVersion: sql`scope_version + 1` as unknown as number })
      .where(inArray(treatmentPlans.id, planIds)),

  /**
   * What the engine priced for one plan, per scenario, from the scenario's latest run that priced
   * it, with that run's own ALE, which is the baseline its reduction is measured from. A scenario
   * whose runs never priced the plan reads its latest run, the plan's columns null: a run the plan
   * has no row on is absent rather than zero, so the join has to start from the runs.
   *
   * `olderThanHeadline` compares run ids, never dates: a timestamp read back into JavaScript loses
   * its microseconds.
   */
  findPlanProjectionRows: async ({ db, views }, planId: string, organizationId: string) => {
    const inScope = eq(views.riskScenarios.organizationId, organizationId);
    const latestRun = latestRunOf({ db, views }, { runId: views.crqIndicatorRuns.id });
    const [planRuns, latestRuns] = await Promise.all([
      familyRunsQuery({ db, views }, 'plans', inScope),
      db
        .select({ runId: latestRun.runId, riskScenarioId: views.riskScenarios.id })
        .from(views.riskScenarios)
        .innerJoinLateral(latestRun, LATERAL_ON)
        .where(inScope),
    ]);
    if (latestRuns.length === 0) {
      return [];
    }
    const { owns } = familyRunOwnership(planRuns, 'plans');
    const pricingRunByScenario = new Map(planRuns
      .filter((run) => owns(run.runId, planId))
      .map((run) => [run.riskScenarioId, run.runId]));

    const latestRunByScenario = new Map(latestRuns.map((run) => [run.riskScenarioId, run.runId]));
    const rows = await db
      .select({
        riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
        runId: views.crqIndicatorRuns.id,
        runCreatedAt: views.crqIndicatorRuns.createdAt,
        aleMean: views.crqIndicatorRuns.aleMean,
        lefMean: views.crqIndicatorRuns.lefMean,
        planScopeVersion: views.crqPlanWhatIfResults.planScopeVersion,
        aleReductionMean: views.crqPlanWhatIfResults.aleReductionMean,
        aleReductionP10: views.crqPlanWhatIfResults.aleReductionP10,
        aleReductionP90: views.crqPlanWhatIfResults.aleReductionP90,
      })
      .from(views.crqIndicatorRuns)
      .leftJoin(views.crqPlanWhatIfResults, and(
        eq(views.crqPlanWhatIfResults.runId, views.crqIndicatorRuns.id),
        eq(views.crqPlanWhatIfResults.planId, planId),
      ))
      .where(inArray(views.crqIndicatorRuns.id, latestRuns.map((run) => pricingRunByScenario.get(run.riskScenarioId) ?? run.runId)));
    return rows.map((row) => ({ ...row, olderThanHeadline: row.runId !== latestRunByScenario.get(row.riskScenarioId) }));
  },

  /**
   * Each listed plan's priced rows, from the latest run of every scenario that priced it. The list
   * needs one figure per plan, so it reads them in a single pass rather than one query per row of
   * the table.
   */
  findPlanTotalRows: async ({ db, views }, planIds: Array<string>) => {
    if (planIds.length === 0) {
      return [];
    }
    const planRuns = await familyRunsQuery({ db, views }, 'plans', inArray(
      views.riskScenarios.organizationId,
      db.select({ organizationId: views.treatmentPlans.organizationId }).from(views.treatmentPlans).where(inArray(views.treatmentPlans.id, planIds)),
    ));
    const { owns, runIds } = familyRunOwnership(planRuns, 'plans');
    if (runIds.length === 0) {
      return [];
    }
    const rows = await db
      .select({
        runId: views.crqPlanWhatIfResults.runId,
        planId: views.crqPlanWhatIfResults.planId,
        riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
        planScopeVersion: views.crqPlanWhatIfResults.planScopeVersion,
        aleReductionMean: views.crqPlanWhatIfResults.aleReductionMean,
        runCreatedAt: views.crqIndicatorRuns.createdAt,
      })
      .from(views.crqPlanWhatIfResults)
      .innerJoin(views.crqIndicatorRuns, eq(views.crqPlanWhatIfResults.runId, views.crqIndicatorRuns.id))
      .where(and(
        inArray(views.crqPlanWhatIfResults.runId, [...runIds]),
        inArray(views.crqPlanWhatIfResults.planId, planIds),
      ));
    return rows.filter((row) => owns(row.runId, row.planId)).map(({ runId: _runId, ...row }) => row);
  },

  /**
   * The single-lever what-if rows of one scope, each control's from the latest run of its scenario
   * that priced its levers, shaped for `aggregateTopControls`. It ranks the picker's candidates and
   * is never a share of a plan: each row prices one control moved one rung or one bucket, alone,
   * against the run's own posture.
   */
  findScopeSingleLeverRows: async ({ db, views }, organizationId: string) => {
    const leverRuns = await familyRunsQuery({ db, views }, 'levers', eq(views.riskScenarios.organizationId, organizationId));
    const { owns, runIds } = familyRunOwnership(leverRuns, 'levers');
    if (runIds.length === 0) {
      return [];
    }
    const rows = await db
      .select({
        runId: views.crqControlWhatIfResults.runId,
        riskScenarioId: views.crqIndicatorRuns.riskScenarioId,
        controlId: views.crqControlWhatIfResults.controlId,
        controlName: views.controlCapabilities.name,
        controlExternalId: views.controlCapabilities.externalId,
        dimension: views.crqControlWhatIfResults.dimension,
        aleReduction: views.crqControlWhatIfResults.aleReductionMean,
      })
      .from(views.crqControlWhatIfResults)
      .innerJoin(views.crqIndicatorRuns, eq(views.crqControlWhatIfResults.runId, views.crqIndicatorRuns.id))
      .innerJoin(views.controlCapabilities, eq(views.crqControlWhatIfResults.controlId, views.controlCapabilities.id))
      .where(inArray(views.crqControlWhatIfResults.runId, [...runIds]));
    return rows.filter((row) => owns(row.runId, row.controlId)).map(({ runId: _runId, ...row }) => row);
  },
});
