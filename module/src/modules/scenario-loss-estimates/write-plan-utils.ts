import type { Provenance } from './schema';

export type EstimateWriteEntry =
  | { lossDriverId: string, action: 'set', minValue: number | null, likelyValue: number | null, maxValue: number | null }
  | { lossDriverId: string, action: 'clear' };

export interface ExistingEstimateRow {
  id: string,
  lossDriverId: string,
  minValue: number | null,
  likelyValue: number | null,
  maxValue: number | null,
  provenance: Provenance,
  modelVersion: string | null,
  lowConfidence: boolean,
  isPosture: boolean,
}

export type WriteStep =
  | { kind: 'skip' }
  | { kind: 'delete', lossDriverId: string }
  | {
    kind: 'upsert',
    id: string,
    lossDriverId: string,
    minValue: number | null,
    likelyValue: number | null,
    maxValue: number | null,
    provenance: Provenance,
    modelVersion: string | null,
    lowConfidence: boolean,
    isPosture: boolean,
  };

/**
 * A manual write's per-row decision: a tombstone deletes an existing row and is a no-op otherwise;
 * an unchanged triplet is left alone so provenance and `updated_at` survive untouched; anything
 * else becomes `manual` with no `model_version`, keeping the existing row's id on update or minting
 * a fresh one on first insert.
 */
export const planManualWrite = (
  entry: EstimateWriteEntry,
  existing: ExistingEstimateRow | undefined,
  mintId: () => string,
): WriteStep => {
  if (entry.action === 'clear') {
    return existing ? { kind: 'delete', lossDriverId: entry.lossDriverId } : { kind: 'skip' };
  }

  const identical = existing != null
    && existing.minValue === entry.minValue
    && existing.likelyValue === entry.likelyValue
    && existing.maxValue === entry.maxValue;
  if (identical) {
    return { kind: 'skip' };
  }

  return {
    kind: 'upsert',
    id: existing?.id ?? mintId(),
    lossDriverId: entry.lossDriverId,
    minValue: entry.minValue,
    likelyValue: entry.likelyValue,
    maxValue: entry.maxValue,
    provenance: 'manual',
    modelVersion: null,
    lowConfidence: false,
    // A person's own entry, whatever it holds, is never the refusal posture.
    isPosture: false,
  };
};

/**
 * Whether the payload's `updatedAt` still matches the scenario's current state (optimistic
 * concurrency). Compared by timestamp value, not identity, and `null` on both sides (no row has
 * ever existed) counts as a match.
 */
export interface ScenarioEstimatesFingerprint {
  maxUpdatedAt: Date | null,
  rowCount: number,
}

export const isStaleWrite = (expected: ScenarioEstimatesFingerprint, current: ScenarioEstimatesFingerprint): boolean =>
  (expected.maxUpdatedAt?.getTime() ?? null) !== (current.maxUpdatedAt?.getTime() ?? null)
  || expected.rowCount !== current.rowCount;

export interface RecomputedDriverValue {
  lossDriverId: string,
  minValue: number | null,
  likelyValue: number | null,
  maxValue: number | null,
  lowConfidence: boolean,
  isPosture: boolean,
}

/**
 * A recompute or revert's per-row decision: with `overwriteManual` false (every sweep/cron/trigger
 * run), a manual row is never planned for a write here, whatever the newly derived value is; with
 * it true (the one caller allowed to overwrite `manual` — a revert), a provenance change from
 * `manual` to `questionnaire` is a real change on its own. Either way, an existing questionnaire
 * row already at the target model version, with a triplet identical to the newly derived one, is
 * left alone — otherwise every run would bump `updated_at` even when nothing actually changed,
 * defeating optimistic concurrency for a concurrent manual save on the same scenario.
 */
export const planRecomputeWrite = (
  driverEstimate: RecomputedDriverValue,
  existing: ExistingEstimateRow | undefined,
  coefficientSetVersion: string,
  overwriteManual: boolean,
  mintId: () => string,
): WriteStep => {
  if (!overwriteManual && existing?.provenance === 'manual') {
    return { kind: 'skip' };
  }
  const unchanged = existing?.provenance === 'questionnaire'
    && existing.modelVersion === coefficientSetVersion
    && existing.minValue === driverEstimate.minValue
    && existing.likelyValue === driverEstimate.likelyValue
    && existing.maxValue === driverEstimate.maxValue
    && existing.isPosture === driverEstimate.isPosture;
  if (unchanged) {
    return { kind: 'skip' };
  }
  return {
    kind: 'upsert',
    id: existing?.id ?? mintId(),
    lossDriverId: driverEstimate.lossDriverId,
    minValue: driverEstimate.minValue,
    likelyValue: driverEstimate.likelyValue,
    maxValue: driverEstimate.maxValue,
    provenance: 'questionnaire',
    modelVersion: coefficientSetVersion,
    lowConfidence: driverEstimate.lowConfidence,
    isPosture: driverEstimate.isPosture,
  };
};

/**
 * A background/scheduled run's per-row decision: unlike `planRecomputeWrite`, a driver with any
 * existing row — `manual` or `questionnaire`, at any model version — is always left alone. Only a
 * driver with no row at all is written. This is what lets a periodic or boot-time catch-up run
 * safely: it can never promote an already-derived row onto a newer coefficient set, which is
 * reserved for an explicit, single-scenario recompute.
 */
export const planBackfillWrite = (
  driverEstimate: RecomputedDriverValue,
  existing: ExistingEstimateRow | undefined,
  coefficientSetVersion: string,
  mintId: () => string,
): WriteStep => {
  if (existing) {
    return { kind: 'skip' };
  }
  return {
    kind: 'upsert',
    id: mintId(),
    lossDriverId: driverEstimate.lossDriverId,
    minValue: driverEstimate.minValue,
    likelyValue: driverEstimate.likelyValue,
    maxValue: driverEstimate.maxValue,
    provenance: 'questionnaire',
    modelVersion: coefficientSetVersion,
    lowConfidence: driverEstimate.lowConfidence,
    isPosture: driverEstimate.isPosture,
  };
};

/**
 * `questionnaire` rows a recompute no longer emits (e.g. the answer behind that driver was
 * cleared): stale, since keeping them would misrepresent an underived driver as derived. A
 * `manual` row is never in this list — manual is never touched by a recompute.
 */
export const planStaleQuestionnaireDeletes = (
  existingRows: ReadonlyArray<ExistingEstimateRow>,
  emittedLossDriverIds: ReadonlySet<string>,
): ReadonlyArray<string> => existingRows
  .filter((row) => row.provenance === 'questionnaire' && !emittedLossDriverIds.has(row.lossDriverId))
  .map((row) => row.lossDriverId);
