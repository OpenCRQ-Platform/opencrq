import { describe, expect, it } from 'vitest';
import { clockSkewMs, runDisplayName, runProgressPercent, runPulse, runRetryWait, runStartInstant } from './run-utils';

describe('runProgressPercent', () => {
  it('draws no bar when the run announced no total', () => {
    expect(runProgressPercent(847, null)).toBeNull();
  });

  it('draws no bar when the announced total is zero', () => {
    expect(runProgressPercent(0, 0)).toBeNull();
  });

  it('reads a run that overran its estimate as complete rather than as an error', () => {
    expect(runProgressPercent(1300, 1240)).toBe(100);
  });

  it('never renders past completion', () => {
    expect(runProgressPercent(12400, 1240)).toBe(100);
  });

  it('holds short of complete while anything is left', () => {
    expect(runProgressPercent(1680, 1685)).toBe(99);
  });

  it('reports how far a run got against its own total', () => {
    expect(runProgressPercent(847, 1240)).toBe(68);
    expect(runProgressPercent(0, 1240)).toBe(0);
    expect(runProgressPercent(1240, 1240)).toBe(100);
  });
});

describe('runStartInstant', () => {
  it('is when the run started', () => {
    expect(runStartInstant({ startedAt: '2026-08-28T14:02:11Z', enqueuedAt: '2026-08-28T14:02:00Z' }))
      .toBe('2026-08-28T14:02:11Z');
  });

  it('falls back to when it was queued, a run that has not started having no start', () => {
    expect(runStartInstant({ startedAt: null, enqueuedAt: '2026-08-28T14:02:00Z' }))
      .toBe('2026-08-28T14:02:00Z');
  });
});

describe('runDisplayName', () => {
  it('names a run by its job kind and its instant', () => {
    const name = runDisplayName('drata-sync', { startedAt: null, enqueuedAt: '2026-08-28T14:02:00Z' });

    expect(name.startsWith('drata-sync @')).toBe(true);
    expect(name).toContain('2026');
  });
});

describe('runPulse', () => {
  const heartbeatAt = '2026-09-01T14:02:40.000Z';
  const leaseExpiresAt = '2026-09-01T14:03:10.000Z';

  it('has nothing to say about a run no worker holds', () => {
    expect(runPulse({ status: 'queued', heartbeatAt: null, leaseExpiresAt: null }, Date.parse('2026-09-01T14:02:44Z'))).toBeNull();
    expect(runPulse({ status: 'succeeded', heartbeatAt: null, leaseExpiresAt: null }, Date.parse('2026-09-01T14:02:44Z'))).toBeNull();
  });

  it('reads alive while the lease holds, counting from the last renewal', () => {
    expect(runPulse({ status: 'running', heartbeatAt, leaseExpiresAt }, Date.parse('2026-09-01T14:02:44.900Z')))
      .toEqual({ state: 'alive', secondsSinceHeartbeat: 4 });
  });

  it('reads stale once the lease has lapsed', () => {
    expect(runPulse({ status: 'running', heartbeatAt, leaseExpiresAt }, Date.parse('2026-09-01T14:03:28Z')))
      .toEqual({ state: 'stale', secondsSinceHeartbeat: 48 });
  });

  it('never counts backwards when the browser clock trails the database', () => {
    expect(runPulse({ status: 'running', heartbeatAt, leaseExpiresAt }, Date.parse('2026-09-01T14:02:39Z')))
      .toEqual({ state: 'alive', secondsSinceHeartbeat: 0 });
  });
});

describe('clockSkewMs', () => {
  const serverNow = '2026-09-01T14:02:40.000Z';

  it('measures how far the browser runs ahead of the server', () => {
    expect(clockSkewMs(serverNow, Date.parse('2026-09-01T14:03:05.000Z'))).toBe(25_000);
  });

  it('is negative when the browser trails the server', () => {
    expect(clockSkewMs(serverNow, Date.parse('2026-09-01T14:02:30.000Z'))).toBe(-10_000);
  });

  it('keeps a run alive on a browser 25 s ahead once the skew is taken out', () => {
    const run = { status: 'running', heartbeatAt: '2026-09-01T14:02:40.000Z', leaseExpiresAt: '2026-09-01T14:03:10.000Z' };
    const browserNow = Date.parse('2026-09-01T14:03:12.000Z');
    const skew = clockSkewMs(serverNow, Date.parse('2026-09-01T14:03:05.000Z'));
    expect(runPulse(run, browserNow)).toEqual({ state: 'stale', secondsSinceHeartbeat: 32 });
    expect(runPulse(run, browserNow - skew)).toEqual({ state: 'alive', secondsSinceHeartbeat: 7 });
  });
});

describe('runRetryWait', () => {
  it('names the attempt a failed run is waiting for and when it comes', () => {
    expect(runRetryWait({ status: 'queued', attempt: 1, maxAttempts: 3, runAfter: '2026-09-01T14:03:12Z' }))
      .toEqual({ attempt: 2, maxAttempts: 3, at: '2026-09-01T14:03:12Z' });
  });

  it('says nothing of a run that has not run yet', () => {
    expect(runRetryWait({ status: 'queued', attempt: 0, maxAttempts: 3, runAfter: '2026-09-01T14:03:12Z' })).toBeNull();
  });

  it('says nothing of a run that is not waiting', () => {
    expect(runRetryWait({ status: 'running', attempt: 2, maxAttempts: 3, runAfter: '2026-09-01T14:03:12Z' })).toBeNull();
    expect(runRetryWait({ status: 'dlq', attempt: 3, maxAttempts: 3, runAfter: '2026-09-01T14:03:12Z' })).toBeNull();
  });
});
