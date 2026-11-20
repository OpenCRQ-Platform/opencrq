import type { EstimateWriteEntry, Provenance } from '@app/module/client';
import { computePert } from '../../utils';

export type { Provenance };

interface EstimateValues {
  minValue: string,
  likelyValue: string,
  maxValue: string,
}

/** A cell of the activation matrix, named, that justifies recommending a driver. */
export interface RecommendationCell {
  attackOutcomeId: string,
  attackOutcomeName: string,
  businessValueCategoryId: string,
  businessValueCategoryCode: string,
  businessValueCategoryName: string,
}

interface PartitionableRow {
  lossDriverId: string,
  minValue: string,
  likelyValue: string,
  maxValue: string,
}

export interface PartitionedRows<T> {
  /** Drivers the matrix recommends, each carrying the cells that justify it. */
  recommended: Array<T & { viaCells: Array<RecommendationCell> }>,
  /** Drivers carrying an estimate the matrix does not recommend for this scenario. */
  notRecommended: Array<T>,
  /** Everything else in the catalog: reachable, but never rendered as empty rows. */
  rest: Array<T>,
}

const hasAnyValue = (row: PartitionableRow) =>
  row.minValue !== '' || row.likelyValue !== '' || row.maxValue !== '';

/**
 * Splits the catalog rows of the estimation surface into the three sections the analyst sees.
 *
 * The recommendation orders, it never filters: a driver that is both recommended and estimated
 * belongs to `recommended` alone, and nothing here can drop a row that carries an amount.
 */
export const partitionEstimateRows = <T extends PartitionableRow>(
  rows: Array<T>,
  recommendations: Array<{ lossDriverId: string, viaCells: Array<RecommendationCell> }>,
  addedDriverIds: Array<string> = [],
): PartitionedRows<T> => {
  const cellsByDriver = new Map(recommendations.map((entry) => [entry.lossDriverId, entry.viaCells]));
  const added = new Set(addedDriverIds);
  const partitioned: PartitionedRows<T> = { recommended: [], notRecommended: [], rest: [] };

  for (const row of rows) {
    const viaCells = cellsByDriver.get(row.lossDriverId);
    if (viaCells) {
      partitioned.recommended.push({ ...row, viaCells });
    } else if (hasAnyValue(row) || added.has(row.lossDriverId)) {
      partitioned.notRecommended.push(row);
    } else {
      partitioned.rest.push(row);
    }
  }

  return partitioned;
};

/**
 * Parses a string to a finite number, returns null for empty or non-finite inputs.
 */
export const parseNum = (v: string): number | null => {
  if (v === '') {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Validates that min ≤ likely ≤ max. Returns an error message or null.
 * Note: returns raw strings (not i18n) for testability.
 * The component wraps these with t`` for display.
 */
export const getRowValidationError = (row: EstimateValues): 'NEGATIVE' | 'MIN_GT_LIKELY' | 'LIKELY_GT_MAX' | 'MIN_GT_MAX' | null => {
  const min = parseNum(row.minValue);
  const likely = parseNum(row.likelyValue);
  const max = parseNum(row.maxValue);
  if ([min, likely, max].some((value) => value !== null && value < 0)) {
    return 'NEGATIVE';
  }
  if (min !== null && likely !== null && min > likely) {
    return 'MIN_GT_LIKELY';
  }
  if (likely !== null && max !== null && likely > max) {
    return 'LIKELY_GT_MAX';
  }
  if (min !== null && max !== null && min > max) {
    return 'MIN_GT_MAX';
  }
  return null;
};

/**
 * Returns true if all three values are filled and valid.
 */
export const isRowComplete = (row: EstimateValues): boolean => {
  const hasValues = row.minValue !== '' && row.likelyValue !== '' && row.maxValue !== '';
  return hasValues && getRowValidationError(row) === null;
};

/**
 * Computes the PERT expected value for a row, or null if incomplete/invalid.
 */
export const getRowPert = (row: EstimateValues): number | null => {
  const min = parseNum(row.minValue);
  const likely = parseNum(row.likelyValue);
  const max = parseNum(row.maxValue);
  if (min === null || likely === null || max === null || getRowValidationError(row) !== null) {
    return null;
  }
  return computePert(min, likely, max);
};

interface EstimateRowInput extends EstimateValues {
  lossDriverId: string,
}

const isBlankRow = (row: EstimateValues) =>
  row.minValue === '' && row.likelyValue === '' && row.maxValue === '';

/**
 * Builds the upsert payload from the edited rows. Under the keyed-upsert write contract an omitted
 * driver means "leave untouched," so a row blanked back to empty is the one case that cannot be
 * left out: it becomes an explicit `clear` tombstone when a persisted estimate exists for it, and
 * is dropped entirely only when there was never anything to clear.
 */
export const buildEstimatesPayload = (
  rows: ReadonlyArray<EstimateRowInput>,
  existingLossDriverIds: ReadonlySet<string>,
): Array<EstimateWriteEntry> => rows.flatMap((row): Array<EstimateWriteEntry> => {
  if (!isBlankRow(row)) {
    return [{
      lossDriverId: row.lossDriverId,
      action: 'set',
      minValue: parseNum(row.minValue),
      likelyValue: parseNum(row.likelyValue),
      maxValue: parseNum(row.maxValue),
    }];
  }
  return existingLossDriverIds.has(row.lossDriverId)
    ? [{ lossDriverId: row.lossDriverId, action: 'clear' }]
    : [];
});

/**
 * Two triplet cells read as the same value when both parse to the same number (`"100"` vs
 * `"100.0"`), falling back to raw string equality only when one side is not a plain number (an
 * empty cell, or a still-invalid in-progress keystroke) — parseNum(null) === parseNum(null) would
 * otherwise call an edit from blank to an unparsable string "unchanged".
 */
const cellUnchanged = (edited: string, stored: string): boolean => {
  const editedNum = parseNum(edited);
  const storedNum = parseNum(stored);
  return editedNum !== null && storedNum !== null ? editedNum === storedNum : edited === stored;
};

const tripletUnchanged = (edited: EstimateValues, stored: EstimateValues): boolean =>
  cellUnchanged(edited.minValue, stored.minValue)
  && cellUnchanged(edited.likelyValue, stored.likelyValue)
  && cellUnchanged(edited.maxValue, stored.maxValue);

interface CatalogLossDriver {
  id: string,
  name: string,
  description: string | null,
  lossCategoryId: string,
  lossCategoryName: string,
  lossCategoryDisplayOrder: number,
}

interface StoredEstimate {
  lossDriverId: string,
  minValue: number | null,
  likelyValue: number | null,
  maxValue: number | null,
  provenance: Provenance,
  isPosture: boolean,
  lowConfidence: boolean,
}

export interface LossEstimateRow extends EstimateValues {
  lossDriverId: string,
  lossDriverName: string,
  lossDriverDescription: string | null,
  lossCategoryId: string,
  lossCategoryName: string,
  lossCategoryDisplayOrder: number,
  provenance: Provenance | null,
  isPosture: boolean,
  lowConfidence: boolean,
}

export const buildLossEstimateRows = (
  drivers: ReadonlyArray<CatalogLossDriver>,
  estimates: ReadonlyArray<StoredEstimate>,
): Array<LossEstimateRow> => {
  const estimateByDriverId = new Map(estimates.map((estimate) => [estimate.lossDriverId, estimate]));
  return drivers.map((driver) => {
    const stored = estimateByDriverId.get(driver.id);
    const provenance = stored?.provenance ?? null;
    return {
      lossDriverId: driver.id,
      lossDriverName: driver.name,
      lossDriverDescription: driver.description,
      lossCategoryId: driver.lossCategoryId,
      lossCategoryName: driver.lossCategoryName,
      lossCategoryDisplayOrder: driver.lossCategoryDisplayOrder,
      minValue: toCell(stored?.minValue),
      likelyValue: toCell(stored?.likelyValue),
      maxValue: toCell(stored?.maxValue),
      provenance,
      isPosture: isRefusalPostureRow({ provenance, isPosture: stored?.isPosture ?? false }),
      lowConfidence: provenance === 'questionnaire' && (stored?.lowConfidence ?? false),
    };
  });
};

interface CategorizedRow {
  lossCategoryId: string,
  lossCategoryName: string,
  lossCategoryDisplayOrder: number,
}

export interface LossCategoryGroup<T> {
  lossCategoryId: string,
  lossCategoryName: string,
  rows: Array<T>,
}

export const groupByLossCategory = <T extends CategorizedRow>(rows: ReadonlyArray<T>): Array<LossCategoryGroup<T>> => {
  const groups = new Map<string, LossCategoryGroup<T> & { displayOrder: number }>();
  for (const row of rows) {
    const group = groups.get(row.lossCategoryId);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(row.lossCategoryId, {
        lossCategoryId: row.lossCategoryId,
        lossCategoryName: row.lossCategoryName,
        displayOrder: row.lossCategoryDisplayOrder,
        rows: [row],
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(({ lossCategoryId, lossCategoryName, rows: groupRows }) => ({ lossCategoryId, lossCategoryName, rows: groupRows }));
};

export type EstimateSource = 'auto' | 'manual';

/** In `auto` the three cells only stand in until the automatic figures load. */
export interface DraftEstimateRow extends EstimateValues {
  lossDriverId: string,
  source: EstimateSource,
}

export interface AutomaticEstimate {
  lossDriverId: string,
  minValue: number | null,
  likelyValue: number | null,
  maxValue: number | null,
  lowConfidence: boolean,
  isPosture: boolean,
}

const toCell = (value: number | null | undefined): string => (value == null ? '' : String(value));

export const initialEstimateSource = (provenance: Provenance | null): EstimateSource =>
  provenance === 'questionnaire' ? 'auto' : 'manual';

export const getEffectiveValues = (row: DraftEstimateRow, automatic: AutomaticEstimate | undefined): EstimateValues => {
  if (row.source === 'manual' || !automatic) {
    return { minValue: row.minValue, likelyValue: row.likelyValue, maxValue: row.maxValue };
  }
  return { minValue: toCell(automatic.minValue), likelyValue: toCell(automatic.likelyValue), maxValue: toCell(automatic.maxValue) };
};

interface EstimateTotals {
  min: number,
  likely: number,
  max: number,
  pert: number,
}

/** Complete rows only, as the server's financial summary counts them. */
export const sumEstimateTotals = (rows: ReadonlyArray<EstimateValues>): EstimateTotals => {
  let min = 0;
  let likely = 0;
  let max = 0;
  for (const row of rows) {
    if (isRowComplete(row)) {
      min += parseNum(row.minValue) ?? 0;
      likely += parseNum(row.likelyValue) ?? 0;
      max += parseNum(row.maxValue) ?? 0;
    }
  }
  const pert = min > 0 || likely > 0 || max > 0 ? computePert(min, likely, max) : 0;
  return { min, likely, max, pert };
};

export const sameDraftRow = (a: DraftEstimateRow, b: DraftEstimateRow): boolean =>
  a.source === b.source && tripletUnchanged(a, b);

/**
 * Folds a refetched server snapshot into the rows being edited. A row the analyst has not touched
 * since `base` takes the server's version, a row they changed or added keeps their version, and a
 * row they removed stays removed, so a save never replays a stale figure as their own edit.
 */
export const reconcileDraftRows = (
  base: ReadonlyArray<DraftEstimateRow>,
  draft: ReadonlyArray<DraftEstimateRow>,
  server: ReadonlyArray<DraftEstimateRow>,
): Array<DraftEstimateRow> => {
  const baseById = new Map(base.map((row) => [row.lossDriverId, row]));
  const draftById = new Map(draft.map((row) => [row.lossDriverId, row]));
  const serverIds = new Set(server.map((row) => row.lossDriverId));
  const touched = (row: DraftEstimateRow) => {
    const before = baseById.get(row.lossDriverId);
    return !before || !sameDraftRow(row, before);
  };

  const fromServer = server.flatMap((row) => {
    const edited = draftById.get(row.lossDriverId);
    if (!edited) {
      return baseById.has(row.lossDriverId) ? [] : [row];
    }
    return [touched(edited) ? edited : row];
  });
  const kept = draft.filter((row) => !serverIds.has(row.lossDriverId) && touched(row));
  return [...fromServer, ...kept];
};

/**
 * The server's version of each row `reconcileDraftRows` keeps from the draft although the server
 * changed it too, to another version. A row listed in `previous` stays while the draft still differs
 * from the server, so a later refetch does not drop a conflict the analyst has not settled.
 */
export const conflictingDraftRows = (
  base: ReadonlyArray<DraftEstimateRow>,
  draft: ReadonlyArray<DraftEstimateRow>,
  server: ReadonlyArray<DraftEstimateRow>,
  previous: ReadonlyArray<string>,
): Array<DraftEstimateRow> => {
  const baseById = new Map(base.map((row) => [row.lossDriverId, row]));
  const serverById = new Map(server.map((row) => [row.lossDriverId, row]));
  return draft.flatMap((row) => {
    const stored = serverById.get(row.lossDriverId);
    if (!stored || sameDraftRow(row, stored)) {
      return [];
    }
    const before = baseById.get(row.lossDriverId);
    const bothChanged = !before || (!sameDraftRow(row, before) && !sameDraftRow(stored, before));
    return bothChanged || previous.includes(row.lossDriverId) ? [stored] : [];
  });
};

interface EstimatesSavePlan {
  estimates: Array<EstimateWriteEntry>,
  revertLossDriverIds: Array<string>,
}

/**
 * A row set back to `auto` goes through the revert, the only write the server accepts back to
 * derived figures. A row switched to `manual` with its loaded figures is not sent: the server keeps
 * an identical triplet's provenance, so it would stay automatic anyway.
 */
export const planEstimatesSave = (
  initial: ReadonlyArray<DraftEstimateRow>,
  draft: ReadonlyArray<DraftEstimateRow>,
  storedLossDriverIds: ReadonlySet<string>,
): EstimatesSavePlan => {
  const initialById = new Map(initial.map((row) => [row.lossDriverId, row]));
  const draftIds = new Set(draft.map((row) => row.lossDriverId));
  const revertLossDriverIds: Array<string> = [];
  const edited: Array<DraftEstimateRow> = [];

  for (const row of draft) {
    const before = initialById.get(row.lossDriverId);
    if (row.source === 'auto') {
      if (before?.source !== 'auto') {
        revertLossDriverIds.push(row.lossDriverId);
      }
    } else if (!before || !tripletUnchanged(row, before)) {
      edited.push(row);
    }
  }

  const removed = initial
    .filter((row) => !draftIds.has(row.lossDriverId))
    .map((row) => ({ lossDriverId: row.lossDriverId, minValue: '', likelyValue: '', maxValue: '' }));

  return {
    estimates: buildEstimatesPayload([...edited, ...removed], storedLossDriverIds),
    revertLossDriverIds,
  };
};

interface PostureCheckRow {
  provenance: Provenance | null,
  isPosture: boolean,
}

/**
 * D4.1's explicit "the organization would refuse to pay" posture, persisted on the row itself
 * rather than reconstructed from its values or category. Still gated on the *displayed* provenance:
 * the instant the analyst edits one of the three fields away from the stored triplet, the row reads
 * as manual and the posture styling must fall away with it, before anything is saved.
 */
export const isRefusalPostureRow = (row: PostureCheckRow): boolean =>
  row.isPosture && row.provenance === 'questionnaire';

/**
 * The notice qualifies the figures on screen, and those come from a second query that can resolve
 * after the summary carrying the verdict: while the summary is newer than every row it describes,
 * the table is still showing pre-recompute amounts and the notice stands. Both timestamps are the
 * database's, so an unrelated refetch cannot make them disagree.
 */
export const isRecomputeNoticeStanding = (
  recomputePending: boolean,
  summaryUpdatedAt: Date | string | null | undefined,
  rowsUpdatedAt: Date | string | null | undefined,
): boolean => {
  if (recomputePending) {
    return true;
  }
  if (summaryUpdatedAt == null || rowsUpdatedAt == null) {
    return false;
  }
  return new Date(summaryUpdatedAt).getTime() > new Date(rowsUpdatedAt).getTime();
};
