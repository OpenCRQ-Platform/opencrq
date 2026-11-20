import type { SeverityBand } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';

export type RemediationPacePayload = inferRouterOutputs<TRPCRouter>['dashboard']['getRemediationPace'];

/** From here the wait before a fix has grown tenfold. */
export const OCCUPANCY_ALERT = 0.9;
export const OCCUPANCY_WARNING = 0.8;

export type OccupancyLevel = 'over' | 'near' | 'within';

export interface PaceFiguresLike {
  newInWindow: number,
  closedInWindow: number,
  newPerMonth: number,
  occupancy: number | null,
  openCount: number,
  openAtWindowStart: number,
}

/** A band that receives findings and never closed one has no capacity: it is over, not unmeasured. */
export const occupancyLevel = ({ occupancy, newPerMonth }: Pick<PaceFiguresLike, 'occupancy' | 'newPerMonth'>): OccupancyLevel => {
  if (occupancy === null) {
    return newPerMonth > 0 ? 'over' : 'within';
  }
  if (occupancy >= OCCUPANCY_ALERT) {
    return 'over';
  }
  return occupancy >= OCCUPANCY_WARNING ? 'near' : 'within';
};

export const occupancyBarRatio = (figures: Pick<PaceFiguresLike, 'occupancy' | 'newPerMonth'>): number => {
  if (figures.occupancy === null) {
    return occupancyLevel(figures) === 'over' ? 1 : 0;
  }
  return Math.min(Math.max(figures.occupancy, 0), 1);
};

/** Capped at full like the bar, so a month above capacity stays inside the row it is drawn in. */
export const occupancySparkline = (history: ReadonlyArray<number | null>): Array<number | null> =>
  history.map((value) => (value === null ? null : Math.min(Math.max(value, 0), 1)));

export const bandsFallingBehind = <T extends { band: SeverityBand } & Pick<PaceFiguresLike, 'occupancy' | 'newPerMonth'>>(
  bands: ReadonlyArray<T>,
): Array<SeverityBand> => bands.filter((band) => occupancyLevel(band) === 'over').map((band) => band.band);

export type PaceDirection = 'behind' | 'clearing' | 'level';

const DAYS_PER_WEEK = 7;

/** A drift that rounds to zero at one decimal reads as level. */
export const paceVerdict = (
  { newInWindow, closedInWindow }: Pick<PaceFiguresLike, 'newInWindow' | 'closedInWindow'>,
  windowDays: number,
): { direction: PaceDirection, perWeek: number } => {
  const perWeek = Math.round((Math.abs(newInWindow - closedInWindow) / windowDays) * DAYS_PER_WEEK * 10) / 10;
  if (perWeek === 0) {
    return { direction: 'level', perWeek };
  }
  return { direction: newInWindow > closedInWindow ? 'behind' : 'clearing', perWeek };
};

export const relativeChange = (from: number, to: number): number | null => (from === 0 ? null : (to - from) / from);

export const openChangeOverWindow = ({ openAtWindowStart, openCount }: Pick<PaceFiguresLike, 'openAtWindowStart' | 'openCount'>): number | null =>
  relativeChange(openAtWindowStart, openCount);

/** Whole units from ten up, one decimal below, so a quiet band does not read as zero. */
export const roundRate = (value: number): number => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);

export const roundDays = (days: number | null): number | null => (days === null ? null : Math.round(days));

export type PaceBandFilter = SeverityBand | 'all';

export const monthStartTimestamp = (month: string): number => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);

export const openChangeOverMonths = (openAtEnd: ReadonlyArray<number>, months: number): number | null => {
  const last = openAtEnd.at(-1);
  const reference = openAtEnd.at(-1 - months);
  return last === undefined || reference === undefined ? null : relativeChange(reference, last);
};
