import type { LifelineDirection } from '../../components/shared/lifeline-utils';

export interface AleSortableLike {
  latestRun: { aleMean: number | null } | null,
  noMappedAsset?: boolean,
}

/**
 * The run a figure may still be read from. A scope measured over its mapped assets and holding none
 * has no estate left to price, so the run on file answers about an estate it no longer has: the
 * surfaces read it as unpriced, and a total that still summed it would contradict them.
 */
const currentRun = <T>(summary: { latestRun: T | null, noMappedAsset?: boolean }): T | null =>
  (summary.noMappedAsset === true ? null : summary.latestRun);

/**
 * `YYYY-MM-DD` to epoch ms at UTC midnight: the x value of every day-keyed dashboard series.
 *
 * Kept in one place because it is the contract between the day keys the backend emits and the
 * datetime axis the charts draw: parsing the same key as a local date would shift every point by
 * the viewer's offset, and only for viewers west of GMT.
 */
export const utcDayToTimestamp = (date: string): number =>
  // eslint-disable-next-line lingui/no-unlocalized-strings
  Date.parse(`${date}T00:00:00Z`);

export interface ChangeChipReading {
  label: string,
  sign: -1 | 0 | 1,
  direction: LifelineDirection,
}

/** A change whose label rounds to zero reads as no change, whatever its raw sign or its relative size. */
export const readChangeChip = (
  reading: { change: number, direction: LifelineDirection },
  formatChange: (change: number) => string,
): ChangeChipReading => {
  const label = formatChange(reading.change);
  if (label === formatChange(0)) {
    return { label, sign: 0, direction: 'flat' };
  }
  return { label, sign: reading.change > 0 ? 1 : -1, direction: reading.direction };
};

export const sortSummariesByAle = <T extends AleSortableLike>(summaries: Array<T>): Array<T> =>
  summaries.toSorted((a, b) =>
    (currentRun(b)?.aleMean ?? Number.NEGATIVE_INFINITY) - (currentRun(a)?.aleMean ?? Number.NEGATIVE_INFINITY));

export const PERFORMERS_WINDOW_DAYS = 30;
const PERFORMERS_COUNT = 3;

export interface LikelihoodMoverLike {
  likelihoodChange: number | null,
  noMappedAsset?: boolean,
}

/**
 * To a tenth of a point: a scenario's likelihood is often a few percent, so whole points would read
 * most of its moves as zero.
 */
export const toTenthsOfPoints = (change: number): number => Math.round(change * 1000) / 10;

/** A change shown as 0 points would list a scenario as having moved while showing that it did not. */
const movedLikelihood = (summary: LikelihoodMoverLike): number | null => {
  const change = summary.noMappedAsset === true ? null : summary.likelihoodChange;
  return change !== null && toTenthsOfPoints(change) !== 0 ? change : null;
};

export const selectWorstLikelihoodMovers = <T extends LikelihoodMoverLike>(summaries: Array<T>): Array<T> =>
  summaries
    .filter((summary) => (movedLikelihood(summary) ?? 0) > 0)
    .toSorted((a, b) => (movedLikelihood(b) ?? 0) - (movedLikelihood(a) ?? 0))
    .slice(0, PERFORMERS_COUNT);

export const selectBestLikelihoodMovers = <T extends LikelihoodMoverLike>(summaries: Array<T>): Array<T> =>
  summaries
    .filter((summary) => (movedLikelihood(summary) ?? 0) < 0)
    .toSorted((a, b) => (movedLikelihood(a) ?? 0) - (movedLikelihood(b) ?? 0))
    .slice(0, PERFORMERS_COUNT);

export const resolveDashboardScope = (organizationId: string | undefined, riskScope: string): string | undefined =>
  organizationId ?? (riskScope === 'all' ? undefined : riskScope);

export const RISK_SCOPE_CARD_MIN_WIDTH = 200;
export const RISK_SCOPE_CARD_GAP = 16;

export interface RiskScopeSlots {
  columns: number,
  shownCount: number,
  hasOther: boolean,
}

/** Never fewer than two columns, so a narrow group still ranks one scope beside the rest. */
export const fitRiskScopeSlots = (width: number, scopeCount: number): RiskScopeSlots => {
  const columns = Math.max(2, Math.floor((width + RISK_SCOPE_CARD_GAP) / (RISK_SCOPE_CARD_MIN_WIDTH + RISK_SCOPE_CARD_GAP)));
  return scopeCount <= columns
    ? { columns, shownCount: scopeCount, hasOther: false }
    : { columns, shownCount: columns - 1, hasOther: true };
};

export interface RiskScopeFiguresLike {
  scenarioCount: number,
  ale: number | null,
  aleChange: number | null,
  aleBaseline: { date: string, ale: number } | null,
}

export interface OtherRiskScopes {
  scopeCount: number,
  scenarioCount: number,
  ale: number | null,
  aleChange: number | null,
  /** The day `aleChange` is measured from, the earliest baseline of the scopes. */
  aleSince: string | null,
  /** Of the tenant's annual loss exposure, null while the tenant has none. */
  share: number | null,
}

const sumMeasured = (values: Array<number | null>): number | null =>
  values.reduce<number | null>((sum, value) => (value === null ? sum : (sum ?? 0) + value), null);

const earliestBaselineDate = (scopes: Array<RiskScopeFiguresLike>): string | null =>
  scopes.flatMap((scope) => (scope.aleBaseline === null ? [] : [scope.aleBaseline.date])).toSorted()[0] ?? null;

/**
 * The change of the scopes' summed series, as "Aggregate risk" reads its own: a scope first priced later in the
 * window counts whole, since the sum carried nothing for it on the first day.
 */
const changeOfSum = (scopes: Array<RiskScopeFiguresLike>, ale: number | null): number | null => {
  if (ale === null || scopes.every((scope) => scope.aleChange === null)) {
    return null;
  }
  const baselines = scopes.flatMap((scope) => (scope.aleBaseline === null ? [] : [scope.aleBaseline]));
  const firstDate = earliestBaselineDate(scopes);
  return ale - baselines.filter((baseline) => baseline.date === firstDate).reduce((sum, baseline) => sum + baseline.ale, 0);
};

export const summarizeOtherRiskScopes = (scopes: Array<RiskScopeFiguresLike>, shownCount: number): OtherRiskScopes => {
  const others = scopes.slice(shownCount);
  const ale = sumMeasured(others.map((scope) => scope.ale));
  const tenantAle = sumMeasured(scopes.map((scope) => scope.ale));
  return {
    scopeCount: others.length,
    scenarioCount: others.reduce((sum, scope) => sum + scope.scenarioCount, 0),
    ale,
    aleChange: changeOfSum(others, ale),
    aleSince: earliestBaselineDate(others),
    share: ale === null || tenantAle === null || tenantAle <= 0 ? null : ale / tenantAle,
  };
};
