import type { JobLogLevel } from '@app/module/client';
import { z } from 'zod';
import type { LogFilter } from './logs-utils';
import { formatUrlList, parseUrlList } from '../../utils';
import { LOG_LEVEL_ORDER } from './logs-utils';

export const LOGS_LIST_SEARCH_DEFAULTS = { search: '', level: '' } as const;

/** `level` carries the comma-joined `formatUrlList` / `parseUrlList` encoding, one or several values. */
export const logsListSearchSchema = z.object({
  search: z.coerce.string().catch('').default(''),
  level: z.coerce.string().catch('').default(''),
});

type LogsUrlFilters = z.infer<typeof logsListSearchSchema>;

const isJobLogLevel = (value: string): value is JobLogLevel => Object.hasOwn(LOG_LEVEL_ORDER, value);

/** Parses the comma-joined level field into the shape `buildLogView` expects, dropping a level the app no longer defines. */
export const toLogFilter = (urlFilters: LogsUrlFilters): LogFilter => ({
  search: urlFilters.search,
  levels: parseUrlList(urlFilters.level).filter(isJobLogLevel),
});

/** Inverse of {@link toLogFilter}, for writing a `LogFilter` back to the address. */
export const toLogUrlFilters = (filter: LogFilter): LogsUrlFilters => ({
  search: filter.search,
  level: formatUrlList(filter.levels),
});
