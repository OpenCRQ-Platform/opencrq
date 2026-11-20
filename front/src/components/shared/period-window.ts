export type PeriodWindowId = '90d' | '6m' | '12m';

export const PERIOD_WINDOWS: ReadonlyArray<PeriodWindowId> = ['90d', '6m', '12m'];

export const DEFAULT_PERIOD_WINDOW: PeriodWindowId = '90d';

const PERIOD_WINDOW_DAYS: Record<PeriodWindowId, number> = { '90d': 90, '6m': 183, '12m': 365 };

export const periodWindowDays = (id: PeriodWindowId): number => PERIOD_WINDOW_DAYS[id];

export const isPeriodWindow = (value: string): value is PeriodWindowId =>
  (PERIOD_WINDOWS as ReadonlyArray<string>).includes(value);
