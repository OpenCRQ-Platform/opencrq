import type {
  crqBudgetReviewAnnualLosses,
  crqBudgetReviewResults,
  crqControlWhatIfResults,
  crqCveWhatIfResults,
  crqIndicatorGroupScores,
  crqIndicatorRunAnnualLosses,
  crqIndicatorRunReachGaps,
  crqIndicatorRuns,
  crqIndicatorRunUnplayableObstacles,
  crqPlanWhatIfResults,
  crqTechniqueWhatIfResults,
} from './schema';
import { fingerprintRunInputs } from './run-fingerprint';

/** Every row one engine run writes, before its result fingerprint is stamped on the run. */
export interface EngineRunRows {
  /** Whether the run carries a TEF and a loss estimate, so euros. */
  readonly priced: boolean,
  readonly run: Omit<typeof crqIndicatorRuns.$inferInsert, 'resultFingerprint'>,
  readonly annualLoss: typeof crqIndicatorRunAnnualLosses.$inferInsert | null,
  readonly groupScores: ReadonlyArray<typeof crqIndicatorGroupScores.$inferInsert>,
  readonly unplayableObstacles: ReadonlyArray<typeof crqIndicatorRunUnplayableObstacles.$inferInsert>,
  readonly reachGaps: ReadonlyArray<typeof crqIndicatorRunReachGaps.$inferInsert>,
  readonly planWhatIfs: ReadonlyArray<typeof crqPlanWhatIfResults.$inferInsert>,
  readonly budgetReviewResults: ReadonlyArray<typeof crqBudgetReviewResults.$inferInsert>,
  readonly budgetReviewAnnualLosses: ReadonlyArray<typeof crqBudgetReviewAnnualLosses.$inferInsert>,
  readonly controlWhatIfs: ReadonlyArray<typeof crqControlWhatIfResults.$inferInsert>,
  readonly cveWhatIfs: ReadonlyArray<typeof crqCveWhatIfResults.$inferInsert>,
  readonly techniqueWhatIfs: ReadonlyArray<typeof crqTechniqueWhatIfResults.$inferInsert>,
}

/** What says when and why the run was computed, never what it answered. */
const RUN_IDENTITY = ['id', 'jobId', 'readAt', 'inputsFingerprint', 'profile'];
const ROW_IDENTITY = ['id', 'runId'];

const without = (row: object, keys: ReadonlyArray<string>) => {
  const left = new Set(keys);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !left.has(key)));
};

/**
 * A digest of what a run answers: equal digests mean a reader of either run sees the same figures.
 *
 * It covers the run's figures and provenance and the rows every profile writes, read without their
 * ids, the job, the read moment and the inputs fingerprint. An attacker's key is a fresh id per run,
 * so its rows enter by the attacker's position. A priced run's what-ifs depend on what it was booked
 * for and are read from the newest run that computed them, so they stay out; a run with no price
 * computes every family whatever it was booked for, and they are part of its answer. The budget
 * review rows stay out: each is read under the review version it priced.
 *
 * The app version enters too: a release may price the what-ifs and the budget review figures read
 * beside a run differently at the same headline, and only a run of the new version dates them older.
 */
export const resultFingerprintOf = (rows: EngineRunRows, appVersion: string | null): string => {
  const attackerOf = new Map(rows.groupScores.map((row, index) => [row.groupKey, index]));
  const plain = (row: object) => without(row, ROW_IDENTITY);
  return fingerprintRunInputs({
    appVersion,
    run: without(rows.run, RUN_IDENTITY),
    annualLoss: rows.annualLoss === null ? null : plain(rows.annualLoss),
    groupScores: rows.groupScores.map((row) => without(row, [...ROW_IDENTITY, 'groupKey'])),
    unplayableObstacles: rows.unplayableObstacles.map((row) => ({ ...without(row, [...ROW_IDENTITY, 'groupKey']), attacker: attackerOf.get(row.groupKey) })),
    reachGaps: rows.reachGaps.map(plain),
    ...(rows.priced ? {} : {
      planWhatIfs: rows.planWhatIfs.map(plain),
      controlWhatIfs: rows.controlWhatIfs.map(plain),
      cveWhatIfs: rows.cveWhatIfs.map(plain),
      techniqueWhatIfs: rows.techniqueWhatIfs.map(plain),
    }),
  });
};
