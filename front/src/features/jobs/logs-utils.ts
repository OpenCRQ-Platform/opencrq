import type { JobLogLevel } from '@app/module/client';
import { foldedMatchRanges, includesFolded } from '@app/utils/text-fold';
import type { JobLogGroup, JobLogLineData } from './run-types';
import { formatLogTimestamp, formatRfc3339 } from '../../utils';

export interface LogFilter {
  search: string,
  levels: Array<JobLogLevel>,
}

/** No level selected reads as every level. */
export const EMPTY_LOG_FILTER: LogFilter = { search: '', levels: [] };

export const LOG_LEVEL_ORDER: Record<JobLogLevel, number> = { error: 0, trace: 1 };

export interface TimedLogLine {
  line: JobLogLineData,
  timestamp: string,
}

export interface LogGroupView {
  group: JobLogGroup,
  lines: Array<TimedLogLine>,
}

export interface LogView {
  groups: Array<LogGroupView>,
  /** The levels this history holds, error first: what the level filter can offer. */
  levels: Array<JobLogLevel>,
}

const matchesFilter = ({ line, timestamp }: TimedLogLine, filter: LogFilter): boolean => {
  if (filter.levels.length > 0 && !filter.levels.includes(line.level)) {
    return false;
  }
  if (filter.search.trim() === '') {
    return true;
  }
  return timestamp.includes(filter.search.trim().toLowerCase())
    || includesFolded(line.message, filter.search)
    || includesFolded(line.detail, filter.search);
};

/**
 * Each line is timestamped here rather than at render, so the search matches the very string the
 * reader sees. The offered levels are read from the whole history, not from the filtered lines, so
 * selecting one never empties the list it was selected from. Both the runs and the lines inside them
 * come back newest first, which is the order they are read in.
 */
export const buildLogView = (
  groups: ReadonlyArray<JobLogGroup>,
  filter: LogFilter,
): LogView => {
  const kept: Array<LogGroupView> = [];
  const levels = new Set<JobLogLevel>();
  for (const group of groups) {
    const lines: Array<TimedLogLine> = [];
    for (const line of group.lines) {
      levels.add(line.level);
      const entry = { line, timestamp: formatLogTimestamp(line.occurredAt) };
      if (matchesFilter(entry, filter)) {
        lines.push(entry);
      }
    }
    if (lines.length > 0) {
      lines.reverse();
      kept.push({ group, lines });
    }
  }
  kept.reverse();
  return {
    groups: kept,
    levels: [...levels].sort((a, b) => LOG_LEVEL_ORDER[a] - LOG_LEVEL_ORDER[b]),
  };
};

export interface TextFragment {
  text: string,
  hit: boolean,
}

/** Splits on every occurrence of the search term, accents, case and ligatures aside; the empty term matches nothing. */
export const splitOnSearch = (text: string, search: string): Array<TextFragment> => {
  const fragments: Array<TextFragment> = [];
  let cursor = 0;
  for (const [start, end] of foldedMatchRanges(text, search)) {
    if (start > cursor) {
      fragments.push({ text: text.slice(cursor, start), hit: false });
    }
    fragments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length || fragments.length === 0) {
    fragments.push({ text: text.slice(cursor), hit: false });
  }
  return fragments;
};

const JSON_INDENT = 2;

/** The clipboard form of a line, read by a machine or a stranger: nothing translated goes in. */
const logLineJson = (line: JobLogLineData) => ({
  date: formatRfc3339(line.occurredAt),
  level: line.level,
  message: line.message,
  ...(line.detail === null ? {} : { detail: line.detail }),
});

export const logLineText = (line: JobLogLineData): string =>
  JSON.stringify(logLineJson(line), null, JSON_INDENT);

/** Every line the run produced, oldest first: the panel reads newest first, a pasted log does not. */
export const logGroupText = (group: JobLogGroup): string => JSON.stringify({
  runId: group.runId,
  status: group.status,
  startedAt: group.startedAt === null ? null : formatRfc3339(group.startedAt),
  lines: group.lines.map(logLineJson),
}, null, JSON_INDENT);
