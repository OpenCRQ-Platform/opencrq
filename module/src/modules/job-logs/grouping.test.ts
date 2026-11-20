import { describe, expect, it } from 'vitest';
import type { JobLogLine, JobLogRun } from './grouping';
import { groupRunLines } from './grouping';

const run = (id: string, overrides: Partial<JobLogRun> = {}): JobLogRun => ({
  id,
  status: 'succeeded',
  startedAt: new Date('2026-08-28T09:30:02Z'),
  enqueuedAt: new Date('2026-08-28T09:30:00Z'),
  ...overrides,
});

const line = (id: string, jobId: string | null, message = 'a line'): JobLogLine & { jobId: string | null } => ({
  id,
  jobId,
  level: 'trace',
  message,
  detail: null,
  occurredAt: new Date('2026-08-28T09:30:03Z'),
});

describe('groupRunLines', () => {
  it('returns the runs oldest first', () => {
    const groups = groupRunLines([run('newest'), run('middle'), run('oldest')], []);

    expect(groups.map((group) => group.runId)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('files each line under its own run, in the order the rows arrived', () => {
    const groups = groupRunLines(
      [run('b'), run('a')],
      [line('1', 'a', 'first'), line('2', 'b'), line('3', 'a', 'second')],
    );

    expect(groups[0].lines.map((l) => l.message)).toEqual(['first', 'second']);
    expect(groups[1].lines.map((l) => l.id)).toEqual(['2']);
  });

  it('keeps a run that captured nothing, as a group with no lines', () => {
    const groups = groupRunLines([run('a')], []);

    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual([]);
  });

  it('drops a line whose run is not among the ones asked for', () => {
    const groups = groupRunLines([run('a')], [line('1', 'other'), line('2', null)]);

    expect(groups[0].lines).toEqual([]);
  });

  it('carries the run status and start time through', () => {
    const groups = groupRunLines([run('a', { status: 'dlq', startedAt: null })], []);

    expect(groups[0].status).toBe('dlq');
    expect(groups[0].startedAt).toBeNull();
  });
});
