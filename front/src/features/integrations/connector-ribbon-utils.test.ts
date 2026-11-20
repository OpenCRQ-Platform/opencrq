import { describe, expect, it } from 'vitest';
import type { PipelineSnapshot, SampleWindow } from './connector-ribbon-utils';
import {
  advanceSampleWindow,
  buildRibbonValues,
  deriveIngestionRate,
  EMPTY_SAMPLE_WINDOW,
  formatRatePerSecond,
  isRibbonFlowing,
  shouldWarnNoWorker,
} from './connector-ribbon-utils';

const snapshot = (overrides: Partial<PipelineSnapshot> = {}): PipelineSnapshot => ({
  configuredConnectors: 3,
  queuedRuns: 12,
  runningNow: 2,
  recordsIngested: 667_500,
  streamCatchupPercent: 82,
  workerAnswering: true,
  ...overrides,
});

describe('advanceSampleWindow', () => {
  it('records the first sample without inventing a previous one', () => {
    const window = advanceSampleWindow(EMPTY_SAMPLE_WINDOW, { recordsIngested: 100, sampledAt: 1_000 });
    expect(window).toEqual({ previous: null, current: { recordsIngested: 100, sampledAt: 1_000 } });
  });

  it('shifts the current sample into previous on a new tick', () => {
    const first = advanceSampleWindow(EMPTY_SAMPLE_WINDOW, { recordsIngested: 100, sampledAt: 1_000 });
    const second = advanceSampleWindow(first, { recordsIngested: 150, sampledAt: 6_000 });
    expect(second.previous?.recordsIngested).toBe(100);
    expect(second.current?.recordsIngested).toBe(150);
  });

  it('ignores a replayed tick with the same timestamp', () => {
    const first = advanceSampleWindow(EMPTY_SAMPLE_WINDOW, { recordsIngested: 100, sampledAt: 1_000 });
    const replayed = advanceSampleWindow(first, { recordsIngested: 100, sampledAt: 1_000 });
    expect(replayed).toBe(first);
  });
});

describe('deriveIngestionRate', () => {
  const windowOf = (previous: [number, number] | null, current: [number, number] | null): SampleWindow => ({
    previous: previous ? { recordsIngested: previous[0], sampledAt: previous[1] } : null,
    current: current ? { recordsIngested: current[0], sampledAt: current[1] } : null,
  });

  it('yields no rate before a second sample exists', () => {
    expect(deriveIngestionRate(EMPTY_SAMPLE_WINDOW)).toBeNull();
    expect(deriveIngestionRate(windowOf(null, [100, 1_000]))).toBeNull();
  });

  it('divides the delta by the real elapsed time, not the nominal cadence', () => {
    expect(deriveIngestionRate(windowOf([100, 0], [1_020, 5_000]))).toBe(184);
    expect(deriveIngestionRate(windowOf([100, 0], [200, 10_000]))).toBe(10);
  });

  it('reads an unchanged count as zero', () => {
    expect(deriveIngestionRate(windowOf([100, 0], [100, 5_000]))).toBe(0);
  });

  it('clamps a falling count at zero instead of a negative rate', () => {
    expect(deriveIngestionRate(windowOf([500, 0], [100, 5_000]))).toBe(0);
  });

  it('yields no rate over a degenerate elapsed time', () => {
    expect(deriveIngestionRate(windowOf([100, 5_000], [200, 5_000]))).toBeNull();
  });
});

describe('formatRatePerSecond', () => {
  it('renders an integer per-second figure', () => {
    expect(formatRatePerSecond(184)).toBe('184/s');
    expect(formatRatePerSecond(0)).toBe('0/s');
    expect(formatRatePerSecond(3.6)).toBe('4/s');
  });

  it('compacts a large rate the way counts are compacted', () => {
    expect(formatRatePerSecond(184_000)).toBe('184K/s');
  });
});

describe('isRibbonFlowing', () => {
  it('flows only with data and at least one configured connector', () => {
    expect(isRibbonFlowing(undefined)).toBe(false);
    expect(isRibbonFlowing(snapshot({ configuredConnectors: 0 }))).toBe(false);
    expect(isRibbonFlowing(snapshot({ configuredConnectors: 1 }))).toBe(true);
  });
});

describe('buildRibbonValues', () => {
  it('renders every node empty before the first snapshot', () => {
    const values = buildRibbonValues(undefined, null);
    expect(Object.values(values)).toEqual(['-', '-', '-', '-', '-', '-']);
  });

  it('renders a populated pipeline with compact counts', () => {
    const values = buildRibbonValues(snapshot(), 184);
    expect(values).toEqual({
      configuredConnectors: '3',
      queuedRuns: '12',
      runningNow: '2',
      ingestionRate: '184/s',
      streamCatchup: '82%',
      recordsIngested: '667.5K',
    });
  });

  it('renders true zeros with empty derived nodes on an unconfigured tenant', () => {
    const values = buildRibbonValues(
      snapshot({ configuredConnectors: 0, queuedRuns: 0, runningNow: 0, recordsIngested: 0, streamCatchupPercent: null }),
      0,
    );
    expect(values).toEqual({
      configuredConnectors: '0',
      queuedRuns: '0',
      runningNow: '0',
      ingestionRate: '-',
      streamCatchup: '-',
      recordsIngested: '0',
    });
  });

  it('keeps the rate empty until two samples exist', () => {
    expect(buildRibbonValues(snapshot(), null).ingestionRate).toBe('-');
  });

  it('keeps the catch-up empty when the stream has no anchors', () => {
    expect(buildRibbonValues(snapshot({ streamCatchupPercent: null }), 184).streamCatchup).toBe('-');
  });
});

describe('shouldWarnNoWorker', () => {
  it('warns when the snapshot says nothing is answering', () => {
    expect(shouldWarnNoWorker(snapshot({ workerAnswering: false }))).toBe(true);
  });

  it('stays silent while a worker answers', () => {
    expect(shouldWarnNoWorker(snapshot({ workerAnswering: true }))).toBe(false);
  });

  it('stays silent before the first snapshot arrives', () => {
    expect(shouldWarnNoWorker(undefined)).toBe(false);
  });
});
