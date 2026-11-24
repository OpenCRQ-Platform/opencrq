import { describe, expect, it } from 'vitest';
import { deriveJobHealth, platformJobHealths } from './health';

describe('deriveJobHealth', () => {
  it('reads running while a run is running, whatever the last terminal run was', () => {
    expect(deriveJobHealth({ activeRunStatus: 'running', lastTerminalRunStatus: null })).toBe('running');
  });

  it('reads queued while a run is queued, whatever the last terminal run was', () => {
    expect(deriveJobHealth({ activeRunStatus: 'queued', lastTerminalRunStatus: null })).toBe('queued');
  });

  it('reads never ran when nothing is active and nothing has ever finished', () => {
    expect(deriveJobHealth({ activeRunStatus: null, lastTerminalRunStatus: null })).toBe('never_ran');
  });

  it('reads healthy when the last run succeeded', () => {
    expect(deriveJobHealth({ activeRunStatus: null, lastTerminalRunStatus: 'succeeded' })).toBe('healthy');
  });

  it('reads healthy when the last run ended partial, having handed the rest to a continuation', () => {
    expect(deriveJobHealth({ activeRunStatus: null, lastTerminalRunStatus: 'partial' })).toBe('healthy');
  });

  it('reads failing when the last run reached the dead-letter queue', () => {
    expect(deriveJobHealth({ activeRunStatus: null, lastTerminalRunStatus: 'dlq' })).toBe('failing');
  });

  it('reads healthy when the last run was cancelled, a cancellation not being a failure', () => {
    expect(deriveJobHealth({ activeRunStatus: null, lastTerminalRunStatus: 'cancelled' })).toBe('healthy');
  });

  it('reads running on a running run even when the last terminal run reached the dead-letter queue', () => {
    expect(deriveJobHealth({ activeRunStatus: 'running', lastTerminalRunStatus: 'dlq' })).toBe('running');
  });

  it('reads queued on a queued run even when the last terminal run reached the dead-letter queue', () => {
    expect(deriveJobHealth({ activeRunStatus: 'queued', lastTerminalRunStatus: 'dlq' })).toBe('queued');
  });
});

describe('platformJobHealths', () => {
  it('reads failing for a kind that fails in one tenant and is healthy in another', () => {
    expect(platformJobHealths([
      { kind: 'recompute', health: 'healthy' },
      { kind: 'recompute', health: 'failing' },
    ])).toEqual([{ kind: 'recompute', health: 'failing' }]);
  });

  it('keeps one row per kind, sorted by kind, the worst health of each', () => {
    expect(platformJobHealths([
      { kind: 'sync', health: 'never_ran' },
      { kind: 'alpha', health: 'healthy' },
      { kind: 'sync', health: 'queued' },
      { kind: 'alpha', health: 'running' },
    ])).toEqual([
      { kind: 'alpha', health: 'running' },
      { kind: 'sync', health: 'queued' },
    ]);
  });

  it('answers nothing for no tenant', () => {
    expect(platformJobHealths([])).toEqual([]);
  });
});
