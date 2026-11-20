import { formatFixed } from '../../../utils/format-number';

/** Formats a PERT bound for read-only display, in the application language; `undefined` while the query is still loading. */
export const formatEventsPerYear = (value: number | undefined): string | undefined => (value === undefined ? undefined : formatFixed(value, 3));
