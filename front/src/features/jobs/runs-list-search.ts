import { z } from 'zod';
import { urlSearchText } from '../../utils';

/** Which of a run's three instants the date window filters on. */
export const RUN_DATE_FIELDS = ['enqueuedAt', 'startedAt', 'finishedAt'] as const;
export type RunDateField = (typeof RUN_DATE_FIELDS)[number];

export const RUNS_LIST_SEARCH_DEFAULTS = {
  search: '',
  statuses: '',
  kinds: '',
  triggeredBy: '',
  dateField: 'enqueuedAt',
  dateFrom: '',
  dateTo: '',
} as const;

/**
 * `statuses`, `kinds` and `triggeredBy` carry the `formatUrlList` / `parseUrlList` comma-joined
 * encoding; `dateFrom` / `dateTo` are `yyyy-mm-dd`, the empty string meaning "unset" like `search`.
 */
export const runsListSearchSchema = z.object({
  search: urlSearchText,
  statuses: z.coerce.string().catch('').default(''),
  kinds: z.coerce.string().catch('').default(''),
  triggeredBy: z.coerce.string().catch('').default(''),
  dateField: z.enum(RUN_DATE_FIELDS).catch('enqueuedAt').default('enqueuedAt'),
  dateFrom: z.coerce.string().catch('').default(''),
  dateTo: z.coerce.string().catch('').default(''),
});

export type RunsUrlFilters = z.infer<typeof runsListSearchSchema>;
