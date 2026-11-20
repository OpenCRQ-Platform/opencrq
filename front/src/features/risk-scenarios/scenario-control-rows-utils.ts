import type {
  CoverageBucket, CrqControlWhatIfDimension, CrqControlWhatIfKind, CrqControlWhatIfZeroReason, StrengthRung,
} from '@app/module/client';

export interface LeverStep {
  dimension: CrqControlWhatIfDimension,
  currentStrength: StrengthRung,
  upgradedStrength: StrengthRung,
  currentCoverage: CoverageBucket,
  upgradedCoverage: CoverageBucket,
}

/** One lever of one control, as the run priced it: the mean delta ALE and its spread over the worlds. */
export interface WhatIfEntry extends LeverStep {
  controlKind: CrqControlWhatIfKind,
  aleReductionMean: number | null,
  aleReductionP10: number | null,
  aleReductionP90: number | null,
  zeroReason: CrqControlWhatIfZeroReason | null,
}

export interface TopControlToImprove extends LeverStep {
  controlId: string,
  externalId: string,
  name: string,
  controlKind: CrqControlWhatIfKind,
  aleReduction: number,
}

export interface ScenarioControlPosture {
  id: string,
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

/** Deploy first, then the two axes: the order every table and card reads. */
const DIMENSION_ORDER: Record<CrqControlWhatIfDimension, number> = { deploy: 0, strength: 1, coverage: 2 };

/**
 * Groups the run's what-if rows by control, keeping only the controls the caller knows, in the
 * shared dimension order. `hasWhatIfData` is true once one row carries a priced delta: a run
 * without TEF or loss estimates writes rows with no euro on them.
 */
export const groupWhatIfByControl = (
  rows: ReadonlyArray<WhatIfEntry & { controlId: string }>,
  knownControlIds: ReadonlySet<string>,
): { whatIfByControl: Map<string, Array<WhatIfEntry>>, hasWhatIfData: boolean } => {
  const whatIfByControl = new Map<string, Array<WhatIfEntry>>();
  let hasWhatIfData = false;
  for (const row of rows) {
    if (!knownControlIds.has(row.controlId)) {
      continue;
    }
    if (row.aleReductionMean !== null) {
      hasWhatIfData = true;
    }
    const { controlId, ...entry } = row;
    const held = whatIfByControl.get(controlId);
    if (held) {
      held.push(entry);
    } else {
      whatIfByControl.set(controlId, [entry]);
    }
  }
  for (const entries of whatIfByControl.values()) {
    entries.sort((a, b) => DIMENSION_ORDER[a.dimension] - DIMENSION_ORDER[b.dimension]);
  }
  return { whatIfByControl, hasWhatIfData };
};

/** The best priced lever of a control, zero when none is priced or none reduces anything. */
export const bestAleReduction = (entries: ReadonlyArray<WhatIfEntry> | undefined): number =>
  Math.max(0, ...(entries ?? []).map((entry) => entry.aleReductionMean ?? 0));

/**
 * A what-if is stale once a control's declared state moved since the run priced it: the rows
 * still describe the move from the old state.
 */
export const isWhatIfStale = (
  controls: ReadonlyArray<ScenarioControlPosture>,
  whatIfByControl: ReadonlyMap<string, ReadonlyArray<WhatIfEntry>>,
): boolean => controls.some((control) =>
  whatIfByControl.get(control.id)?.some((entry) =>
    entry.currentStrength !== control.strengthRung
    || entry.currentCoverage !== control.coverageBucket) === true);

export const isControlAtMaximum = (control: ScenarioControlPosture): boolean =>
  control.strengthRung === 'L3'
  && control.coverageBucket === 'L3';

/** Read from the stored step, since a lever with no gain for another reason carries that reason instead of `already-maximal`. */
export const isMaximalStep = (step: LeverStep): boolean => {
  switch (step.dimension) {
    case 'strength':
      return step.currentStrength === step.upgradedStrength;
    case 'coverage':
      return step.currentCoverage === step.upgradedCoverage;
    case 'deploy':
      return false;
  }
};

/** One entry per priced lever that reduces the loss, best first, capped. */
export const selectTopControls = (
  whatIfByControl: ReadonlyMap<string, ReadonlyArray<WhatIfEntry>>,
  controlById: ReadonlyMap<string, { externalId: string, name: string }>,
  limit: number,
): Array<TopControlToImprove> => [...whatIfByControl.entries()]
  .flatMap(([controlId, entries]) => entries
    .filter((entry) => entry.aleReductionMean !== null && entry.aleReductionMean > 0 && controlById.has(controlId))
    .map((entry) => ({
      controlId,
      externalId: controlById.get(controlId)!.externalId,
      name: controlById.get(controlId)!.name,
      controlKind: entry.controlKind,
      dimension: entry.dimension,
      currentStrength: entry.currentStrength,
      upgradedStrength: entry.upgradedStrength,
      currentCoverage: entry.currentCoverage,
      upgradedCoverage: entry.upgradedCoverage,
      aleReduction: entry.aleReductionMean!,
    })))
  .sort((a, b) => b.aleReduction - a.aleReduction)
  .slice(0, limit);
