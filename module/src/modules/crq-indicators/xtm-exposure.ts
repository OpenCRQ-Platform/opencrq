/** One object's quantified exposure, as another XTM product's "In OpenCRQ" card reads it. */
export interface XtmExposure {
  scenarioCount: number,
  /** Summed over the priced scenarios; `null` when none is priced. */
  aleMean: number | null,
  /** A CVE's fix value summed over its scenarios; `null` for other kinds or when none is priced. */
  aleReductionMean: number | null,
}

export interface XtmExposureRow {
  objectId: string | null,
  riskScenarioId: string,
  aleMean: number | null,
  aleReductionMean?: number | null,
}

const addNullable = (total: number | null, value: number | null | undefined): number | null =>
  (value === null || value === undefined ? total : (total ?? 0) + value);

/** Folds the exposure rows of several objects, one row per (object, scenario), into one figure per object. */
export const summariseXtmExposure = (rows: ReadonlyArray<XtmExposureRow>): Map<string, XtmExposure> => {
  const out = new Map<string, XtmExposure>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.objectId === null || seen.has(`${row.objectId}|${row.riskScenarioId}`)) {
      continue;
    }
    seen.add(`${row.objectId}|${row.riskScenarioId}`);
    const entry = out.get(row.objectId) ?? { scenarioCount: 0, aleMean: null, aleReductionMean: null };
    out.set(row.objectId, {
      scenarioCount: entry.scenarioCount + 1,
      aleMean: addNullable(entry.aleMean, row.aleMean),
      aleReductionMean: addNullable(entry.aleReductionMean, row.aleReductionMean),
    });
  }
  return out;
};
