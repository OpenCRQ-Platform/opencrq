import { describe, expect, it } from 'vitest';
import { runTimings } from './run-timings';

describe('runTimings', () => {
  it('reads nothing but the wait as null while a run has never been claimed', () => {
    const run = {
      enqueuedAt: '2026-09-10T10:00:00.000Z',
      startedAt: null,
      claimedAt: null,
      finishedAt: null,
      status: 'queued',
    };

    expect(runTimings(run, Date.parse('2026-09-10T10:00:05.000Z'))).toEqual({
      waitedMs: null,
      ranForMs: null,
      totalMs: null,
    });
  });

  it('counts a run in progress against the current instant', () => {
    const run = {
      enqueuedAt: '2026-09-10T10:00:00.000Z',
      startedAt: '2026-09-10T10:00:02.000Z',
      claimedAt: '2026-09-10T10:00:02.000Z',
      finishedAt: null,
      status: 'running',
    };

    expect(runTimings(run, Date.parse('2026-09-10T10:00:12.000Z'))).toEqual({
      waitedMs: 2_000,
      ranForMs: 10_000,
      totalMs: null,
    });
  });

  it('reads all three durations for a run that finished on its first attempt', () => {
    const run = {
      enqueuedAt: '2026-09-10T10:00:00.000Z',
      startedAt: '2026-09-10T10:00:02.000Z',
      claimedAt: '2026-09-10T10:00:02.000Z',
      finishedAt: '2026-09-10T10:00:12.000Z',
      status: 'succeeded',
    };

    expect(runTimings(run, Date.parse('2026-09-10T10:01:00.000Z'))).toEqual({
      waitedMs: 2_000,
      ranForMs: 10_000,
      totalMs: 12_000,
    });
  });

  it('reads a replayed run\'s execution time from its last claim, not its first', () => {
    // Queued at 10:00:00, first claimed 2s later, failed and retried, claimed again after a
    // backoff wait, finally finished 10s after that last claim.
    const run = {
      enqueuedAt: '2026-09-10T10:00:00.000Z',
      startedAt: '2026-09-10T10:00:02.000Z',
      claimedAt: '2026-09-10T10:05:00.000Z',
      finishedAt: '2026-09-10T10:05:10.000Z',
      status: 'succeeded',
    };

    const { ranForMs, totalMs } = runTimings(run, Date.parse('2026-09-10T10:06:00.000Z'));

    expect(ranForMs).toBe(10_000);
    expect(totalMs).toBe(310_000);
    if (ranForMs === null || totalMs === null) {
      throw new Error('expected both ranForMs and totalMs to be resolved');
    }
    expect(ranForMs).toBeLessThan(totalMs / 10);
  });
});
