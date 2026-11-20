import { describe, expect, it } from 'vitest';
import type { JobLogGroup, JobLogLineData } from './run-types';
import {
  buildLogView,
  EMPTY_LOG_FILTER,
  logGroupText,
  logLineText,
  splitOnSearch,
} from './logs-utils';

const line = (overrides: Partial<JobLogLineData> & Pick<JobLogLineData, 'message'>): JobLogLineData => ({
  id: overrides.message,
  level: 'trace',
  detail: null,
  occurredAt: '2026-09-01T09:12:04.117Z',
  ...overrides,
});

const group = (runId: string, lines: Array<JobLogLineData>): JobLogGroup => ({
  runId,
  status: 'succeeded',
  startedAt: '2026-09-01T09:12:04.000Z',
  lines,
});

describe('buildLogView', () => {
  it('returns the runs and their lines newest first', () => {
    const view = buildLogView([
      group('a', [line({ message: 'first' }), line({ message: 'second' })]),
      group('b', [line({ message: 'third' })]),
    ], EMPTY_LOG_FILTER);

    expect(view.groups.map((g) => g.group.runId)).toEqual(['b', 'a']);
    expect(view.groups.map((g) => g.lines.map((l) => l.line.message))).toEqual([
      ['third'],
      ['second', 'first'],
    ]);
  });

  it('keeps a line whose level is one of those selected', () => {
    const view = buildLogView([
      group('a', [
        line({ message: 'connected' }),
        line({ message: 'request failed', level: 'error' }),
      ]),
    ], { search: '', levels: ['error', 'trace'] });

    expect(view.groups[0].lines.map((l) => l.line.message)).toEqual(['request failed', 'connected']);
  });

  it('offers every level the history holds, error first', () => {
    const view = buildLogView([
      group('a', [
        line({ message: 'connected' }),
        line({ message: 'request failed', level: 'error' }),
        line({ message: 'retrying' }),
      ]),
    ], { search: 'nothing matches this', levels: [] });

    expect(view.levels).toEqual(['error', 'trace']);
  });

  it('searches the cause chain as well as the message', () => {
    const view = buildLogView([
      group('a', [line({ message: 'request failed', level: 'error', detail: 'connect ETIMEDOUT' })]),
    ], { search: 'etimedout', levels: [] });

    expect(view.groups[0].lines.map((l) => l.line.message)).toEqual(['request failed']);
  });

  it('searches the timestamp the reader sees', () => {
    const atNoon = new Date(2026, 8, 1, 12, 30, 0, 0).toISOString();
    const view = buildLogView([
      group('a', [
        line({ message: 'connected', occurredAt: atNoon }),
        line({ message: 'retrying', occurredAt: new Date(2026, 8, 1, 14, 5, 0, 0).toISOString() }),
      ]),
    ], { search: '12:30', levels: [] });

    expect(view.groups[0].lines.map((l) => l.line.message)).toEqual(['connected']);
  });

  it('drops a run whose every line is filtered out', () => {
    const view = buildLogView([
      group('a', [line({ message: 'connected' })]),
      group('b', [line({ message: 'request failed', level: 'error' })]),
    ], { search: '', levels: ['error'] });

    expect(view.groups.map((g) => g.group.runId)).toEqual(['b']);
  });
});

describe('buildLogView accents', () => {
  it('finds an accented message or cause from its plain spelling, and the reverse', () => {
    const groups = [group('a', [line({ message: 'École Straße' }), line({ message: 'plain', detail: 'ecole détail' })])];

    expect(buildLogView(groups, { search: 'strasse', levels: [] }).groups[0].lines).toHaveLength(1);
    expect(buildLogView(groups, { search: 'detail', levels: [] }).groups[0].lines).toHaveLength(1);
    expect(buildLogView(groups, { search: 'éco', levels: [] }).groups[0].lines).toHaveLength(2);
  });
});

describe('splitOnSearch', () => {
  it('leaves the text whole when nothing is searched', () => {
    expect(splitOnSearch('Fetched 218 results', '  ')).toEqual([{ text: 'Fetched 218 results', hit: false }]);
  });

  it('marks every occurrence, whatever its case', () => {
    expect(splitOnSearch('Failed, then failed again', 'FAILED')).toEqual([
      { text: 'Failed', hit: true },
      { text: ', then ', hit: false },
      { text: 'failed', hit: true },
      { text: ' again', hit: false },
    ]);
  });

  it('marks a match that opens the text', () => {
    expect(splitOnSearch('502 received', '502')).toEqual([
      { text: '502', hit: true },
      { text: ' received', hit: false },
    ]);
  });

  it('marks an accented word from its plain spelling, offsets staying in the original text', () => {
    expect(splitOnSearch('Fetch École done', 'ecole')).toEqual([
      { text: 'Fetch ', hit: false },
      { text: 'École', hit: true },
      { text: ' done', hit: false },
    ]);
  });

  it('marks across ß and œ, whose folds are two letters long', () => {
    expect(splitOnSearch('Straße Œuvre', 'sse')).toEqual([
      { text: 'Stra', hit: false },
      { text: 'ße', hit: true },
      { text: ' Œuvre', hit: false },
    ]);
    expect(splitOnSearch('Straße Œuvre', 'oeu')).toEqual([
      { text: 'Straße ', hit: false },
      { text: 'Œu', hit: true },
      { text: 'vre', hit: false },
    ]);
  });
});

describe('logLineText', () => {
  it('writes one JSON object, with the stored level rather than its translation', () => {
    const at = new Date(2026, 8, 1, 9, 12, 4, 117).toISOString();
    const copied = JSON.parse(logLineText(line({ message: 'Executing claimed job', occurredAt: at })));

    expect(copied).toEqual({
      date: expect.any(String),
      level: 'trace',
      message: 'Executing claimed job',
    });
    expect(new Date(copied.date).toISOString()).toBe(at);
  });

  it('carries the cause chain, and only on the lines that have one', () => {
    const failed = line({ message: 'Request failed', level: 'error', detail: 'fetch failed\nETIMEDOUT' });

    expect(JSON.parse(logLineText(failed)).detail).toBe('fetch failed\nETIMEDOUT');
    expect(JSON.parse(logLineText(line({ message: 'connected' }))).detail).toBeUndefined();
  });
});

describe('logGroupText', () => {
  it('names the run by its stored status and lists its lines oldest first', () => {
    const copied = JSON.parse(logGroupText(group('a', [
      line({ message: 'Attempt 1 of 3 started' }),
      line({ message: 'Job completed successfully' }),
    ])));

    expect(copied.runId).toBe('a');
    expect(copied.status).toBe('succeeded');
    expect(copied.lines.map((entry: { message: string }) => entry.message)).toEqual([
      'Attempt 1 of 3 started',
      'Job completed successfully',
    ]);
  });

  it('leaves a stream without any run identity', () => {
    const copied = JSON.parse(logGroupText({
      runId: null,
      status: null,
      startedAt: null,
      lines: [line({ message: 'OpenCTI stream connected' })],
    }));

    expect(copied).toMatchObject({ runId: null, status: null, startedAt: null });
  });
});
