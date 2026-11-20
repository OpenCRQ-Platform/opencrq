import { and, count, eq, inArray, max } from 'drizzle-orm';
import { newError } from '@app/utils';
import type { Provenance } from './schema';
import { defineRepository } from '../../registry';
import { riskScenarios } from '../risk-scenarios/schema';
import { scenarioLossEstimates } from './schema';
import { validEstimateConditions } from './valid-estimate';

export const scenarioLossEstimatesRepository = defineRepository({
  findByScenarioId: async ({ db, views }, riskScenarioId: string, validOnly: boolean) => {
    const conditions = [eq(views.scenarioLossEstimates.riskScenarioId, riskScenarioId)];
    if (validOnly) {
      conditions.push(...validEstimateConditions(views));
    }
    return db
      .select({
        id: views.scenarioLossEstimates.id,
        riskScenarioId: views.scenarioLossEstimates.riskScenarioId,
        lossDriverId: views.scenarioLossEstimates.lossDriverId,
        minValue: views.scenarioLossEstimates.minValue,
        likelyValue: views.scenarioLossEstimates.likelyValue,
        maxValue: views.scenarioLossEstimates.maxValue,
        provenance: views.scenarioLossEstimates.provenance,
        modelVersion: views.scenarioLossEstimates.modelVersion,
        lowConfidence: views.scenarioLossEstimates.lowConfidence,
        isPosture: views.scenarioLossEstimates.isPosture,
        updatedAt: views.scenarioLossEstimates.updatedAt,
        lossDriver: {
          id: views.lossDrivers.id,
          name: views.lossDrivers.name,
          description: views.lossDrivers.description,
          lossCategoryId: views.lossDrivers.lossCategoryId,
          lossCategoryName: views.lossCategories.name,
        },
      })
      .from(views.scenarioLossEstimates)
      .innerJoin(views.lossDrivers, eq(views.scenarioLossEstimates.lossDriverId, views.lossDrivers.id))
      .innerJoin(views.lossCategories, eq(views.lossDrivers.lossCategoryId, views.lossCategories.id))
      .where(and(...conditions));
  },

  // Every estimate of the given scenarios — the attack outcome page's driver split sums across
  // every scenario naming the outcome, since a hand-recorded estimate does not depend on a
  // simulation existing. `validOnly` applies the same rule `findByScenarioId` enforces above.
  findByScenarioIds: async ({ db, views }, riskScenarioIds: Array<string>, validOnly: boolean) => {
    if (riskScenarioIds.length === 0) {
      return [];
    }
    const conditions = [inArray(views.scenarioLossEstimates.riskScenarioId, riskScenarioIds)];
    if (validOnly) {
      conditions.push(...validEstimateConditions(views));
    }
    return db
      .select({
        riskScenarioId: views.scenarioLossEstimates.riskScenarioId,
        lossDriverId: views.scenarioLossEstimates.lossDriverId,
        lossDriverName: views.lossDrivers.name,
        minValue: views.scenarioLossEstimates.minValue,
        likelyValue: views.scenarioLossEstimates.likelyValue,
        maxValue: views.scenarioLossEstimates.maxValue,
      })
      .from(views.scenarioLossEstimates)
      .innerJoin(views.lossDrivers, eq(views.scenarioLossEstimates.lossDriverId, views.lossDrivers.id))
      .where(and(...conditions));
  },

  /** Every stored row for the scenario, the shape the write path diffs a payload against. */
  findRowsForScenario: async ({ db, views }, riskScenarioId: string) =>
    db
      .select({
        id: views.scenarioLossEstimates.id,
        lossDriverId: views.scenarioLossEstimates.lossDriverId,
        minValue: views.scenarioLossEstimates.minValue,
        likelyValue: views.scenarioLossEstimates.likelyValue,
        maxValue: views.scenarioLossEstimates.maxValue,
        provenance: views.scenarioLossEstimates.provenance,
        modelVersion: views.scenarioLossEstimates.modelVersion,
        lowConfidence: views.scenarioLossEstimates.lowConfidence,
        isPosture: views.scenarioLossEstimates.isPosture,
      })
      .from(views.scenarioLossEstimates)
      .where(eq(views.scenarioLossEstimates.riskScenarioId, riskScenarioId)),

  /**
   * The scenario's optimistic-concurrency fingerprint, over every row and not just the `validOnly`
   * subset `getFinancialSummary` reads — an edit to an incomplete triplet must still be able to
   * fail the check.
   *
   * The count is part of it because the maximum alone cannot see a deletion: every insert and
   * update stamps `updatedAt` with the current time and so raises the maximum, but deleting a row
   * that was not the newest leaves it exactly where it was. A client holding the pre-deletion
   * snapshot would pass the check and, submitting every populated row, resurrect what was cleared.
   */
  findScenarioEstimatesFingerprint: async ({ db, views }, riskScenarioId: string): Promise<{ maxUpdatedAt: Date | null, rowCount: number }> => {
    const [row] = await db
      .select({
        maxUpdatedAt: max(views.scenarioLossEstimates.updatedAt),
        rowCount: count(),
      })
      .from(views.scenarioLossEstimates)
      .where(eq(views.scenarioLossEstimates.riskScenarioId, riskScenarioId));
    return {
      maxUpdatedAt: row.maxUpdatedAt ?? null,
      rowCount: row.rowCount,
    };
  },

  /** Keyed upsert on `(riskScenarioId, lossDriverId)`, never delete-all-then-reinsert. */
  upsertRow: ({ db }, values: {
    id: string,
    riskScenarioId: string,
    lossDriverId: string,
    minValue: number | null,
    likelyValue: number | null,
    maxValue: number | null,
    provenance: Provenance,
    modelVersion: string | null,
    lowConfidence: boolean,
    isPosture: boolean,
    updatedAt: Date,
  }) => db.insert(scenarioLossEstimates).values([values]).onConflictDoUpdate({
    target: [scenarioLossEstimates.riskScenarioId, scenarioLossEstimates.lossDriverId],
    set: {
      minValue: values.minValue,
      likelyValue: values.likelyValue,
      maxValue: values.maxValue,
      provenance: values.provenance,
      modelVersion: values.modelVersion,
      lowConfidence: values.lowConfidence,
      isPosture: values.isPosture,
      updatedAt: values.updatedAt,
    },
  }),

  /**
   * The recompute-only counterpart of `upsertRow`: the conflict update is guarded by
   * `WHERE provenance = 'questionnaire'`, so a manual save that commits between the recompute's
   * own read of existing rows and this statement always wins — the guard fails, the recompute's
   * update is dropped, and the manual row stands untouched.
   *
   * Returns whether the row was actually written, which the guard makes distinct from having been
   * asked for: the caller decides what moved from the write that happened, not the one it planned.
   */
  upsertQuestionnaireRow: async ({ db }, values: {
    id: string,
    riskScenarioId: string,
    lossDriverId: string,
    minValue: number | null,
    likelyValue: number | null,
    maxValue: number | null,
    modelVersion: string | null,
    lowConfidence: boolean,
    isPosture: boolean,
    updatedAt: Date,
  }): Promise<boolean> => (await db.insert(scenarioLossEstimates).values([{ ...values, provenance: 'questionnaire' }]).onConflictDoUpdate({
    target: [scenarioLossEstimates.riskScenarioId, scenarioLossEstimates.lossDriverId],
    set: {
      minValue: values.minValue,
      likelyValue: values.likelyValue,
      maxValue: values.maxValue,
      provenance: 'questionnaire',
      modelVersion: values.modelVersion,
      lowConfidence: values.lowConfidence,
      isPosture: values.isPosture,
      updatedAt: values.updatedAt,
    },
    setWhere: eq(scenarioLossEstimates.provenance, 'questionnaire'),
  }).returning()).length > 0,

  /**
   * Locks the scenario row for the rest of the transaction, so a concurrent manual save on the
   * same scenario serializes behind this one instead of racing the optimistic-concurrency check
   * below: an unlocked read would let two concurrent writers both see the same current state, both
   * pass the check, and the later commit would silently overwrite the earlier one.
   */
  lockScenarioForUpdate: ({ db }, riskScenarioId: string) =>
    // eslint-disable-next-line app/no-raw-table-in-reads -- FOR UPDATE requires a real table, not a secured view (module/src/modules/jobs/repository.ts uses the same idiom); validateRiskScenarioId enforces tenant access via views before this runs
    db.select({ id: riskScenarios.id }).from(riskScenarios).where(eq(riskScenarios.id, riskScenarioId)).for('update'),

  deleteRow: ({ db }, riskScenarioId: string, lossDriverId: string) =>
    db.delete(scenarioLossEstimates).where(and(
      eq(scenarioLossEstimates.riskScenarioId, riskScenarioId),
      eq(scenarioLossEstimates.lossDriverId, lossDriverId),
    )),

  /**
   * Guarded on provenance like `upsertQuestionnaireRow`'s conflict update, so a manual save that
   * took the row over since the caller read it wins the race here too. Returns whether a row was
   * actually removed, which the guard makes distinct from having been asked for.
   */
  deleteQuestionnaireRow: async ({ db }, riskScenarioId: string, lossDriverId: string): Promise<boolean> =>
    (await db.delete(scenarioLossEstimates).where(and(
      eq(scenarioLossEstimates.riskScenarioId, riskScenarioId),
      eq(scenarioLossEstimates.lossDriverId, lossDriverId),
      eq(scenarioLossEstimates.provenance, 'questionnaire'),
    )).returning()).length > 0,

  validateRiskScenarioId: async ({ db, views }, riskScenarioId: string) => {
    const result = await db
      .select({ id: views.riskScenarios.id })
      .from(views.riskScenarios)
      .where(eq(views.riskScenarios.id, riskScenarioId))
      .limit(1);
    if (result.length === 0) {
      throw newError('Access Denied');
    }
  },

  validateLossDriverIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    const found = await db
      .select({ id: views.lossDrivers.id })
      .from(views.lossDrivers)
      .where(inArray(views.lossDrivers.id, ids));
    const foundIds = new Set(found.map((row) => row.id));
    const unknownLossDriverIds = [...new Set(ids)].filter((id) => !foundIds.has(id));
    if (unknownLossDriverIds.length > 0) {
      // A payload naming a driver absent from the catalog is stale, not unauthorised: the
      // offending ids travel with the error so the client can drop them instead of retrying.
      throw newError('Unknown loss driver', { unknownLossDriverIds });
    }
  },
});
