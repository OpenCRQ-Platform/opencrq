import type { RunSnapshot, RunSummary } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import { toJobKind } from './job-kind';

// run-contract.ts reads app config at import time; only its schemas/helpers are needed here.
vi.mock('../../../config', () => ({ config: () => ({}) }));

const runSnapshot = (status: RunSnapshot['status']): RunSnapshot => ({
  id: '00000000-0000-0000-0000-000000000001',
  kind: 'cve-epss-sync',
  status,
  enqueuedAt: new Date('2025-12-31T23:59:00.000Z'),
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  claimedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: status === 'queued' || status === 'running' ? null : new Date('2026-01-01T00:05:00.000Z'),
  processedTotal: 3,
  expectedTotal: 10,
  attempt: 1,
  maxAttempts: 3,
  triggeredBy: 'system',
  triggeredById: null,
  askedByOthers: false,
});

const summary = (activeRun: RunSnapshot | null, lastTerminalRun: RunSnapshot | null): RunSummary => ({
  kind: 'cve-epss-sync',
  activeRun,
  lastTerminalRun,
});

describe('toJobKind', () => {
  it('reads never_ran with null runs when there is no summary, such as when the origin has no tenant', () => {
    const result = toJobKind({ kind: 'cve-epss-sync', observed: false, daily: false, serialized: false }, undefined);
    expect(result).toEqual({
      kind: 'cve-epss-sync',
      observed: false,
      daily: false,
      health: 'never_ran',
      activeRun: null,
      lastRun: null,
    });
  });

  it('carries observed and daily through from the catalogue entry', () => {
    const result = toJobKind({ kind: 'cve-epss-sync', observed: true, daily: true, serialized: false }, undefined);
    expect(result.observed).toBe(true);
    expect(result.daily).toBe(true);
  });

  it('reads running while a run is active, even if the last terminal run reached the dlq', () => {
    const result = toJobKind(
      { kind: 'cve-epss-sync', observed: false, daily: false, serialized: false },
      summary(runSnapshot('running'), runSnapshot('dlq')),
    );
    expect(result.health).toBe('running');
    expect(result.activeRun?.status).toBe('running');
    expect(result.lastRun?.status).toBe('dlq');
  });

  it('reads failing when the last terminal run reached the dlq and none is active', () => {
    const result = toJobKind({ kind: 'cve-epss-sync', observed: false, daily: false, serialized: false }, summary(null, runSnapshot('dlq')));
    expect(result.health).toBe('failing');
  });

  it('reads healthy when the last terminal run succeeded or was cancelled', () => {
    expect(toJobKind({ kind: 'cve-epss-sync', observed: false, daily: false, serialized: false }, summary(null, runSnapshot('succeeded'))).health).toBe('healthy');
    expect(toJobKind({ kind: 'cve-epss-sync', observed: false, daily: false, serialized: false }, summary(null, runSnapshot('cancelled'))).health).toBe('healthy');
  });
});
