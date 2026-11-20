import { SEVERITY_BANDS } from '@app/module/client';

/** Spread from the server's own bands, so a band added there widens the filter with it. */
export const SEVERITY_FILTER_VALUES = ['all', ...SEVERITY_BANDS, 'unscored'] as const;

export type FindingsSeverityFilter = (typeof SEVERITY_FILTER_VALUES)[number];

export const isFindingsSeverityFilter = (value: string): value is FindingsSeverityFilter =>
  SEVERITY_FILTER_VALUES.some((candidate) => candidate === value);
