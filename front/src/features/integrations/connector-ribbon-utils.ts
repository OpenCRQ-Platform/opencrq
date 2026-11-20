import { EMPTY_VALUE, formatCompactCount, formatPointsAsPercent } from '../../utils';

export interface PipelineSnapshot {
  configuredConnectors: number,
  queuedRuns: number,
  runningNow: number,
  recordsIngested: number,
  streamCatchupPercent: number | null,
  workerAnswering: boolean,
}

export interface RibbonSample {
  recordsIngested: number,
  sampledAt: number,
}

export interface SampleWindow {
  previous: RibbonSample | null,
  current: RibbonSample | null,
}

export const EMPTY_SAMPLE_WINDOW: SampleWindow = { previous: null, current: null };

/** Idempotent on `sampledAt`, so a strict-mode double effect never shifts the window twice. */
export const advanceSampleWindow = (window: SampleWindow, sample: RibbonSample): SampleWindow =>
  window.current !== null && window.current.sampledAt === sample.sampledAt
    ? window
    : { previous: window.current, current: sample };

/**
 * Records per second between the window's two samples, over their real spacing rather than the
 * nominal cadence. Null before a second sample exists: 0/s is a true reading, absence is not.
 * Clamped at zero, a count falling when a connector replaces its mirror wholesale.
 */
export const deriveIngestionRate = (window: SampleWindow): number | null => {
  if (window.previous === null || window.current === null) {
    return null;
  }
  const elapsedMs = window.current.sampledAt - window.previous.sampledAt;
  if (elapsedMs <= 0) {
    return null;
  }
  return Math.max(0, window.current.recordsIngested - window.previous.recordsIngested) / (elapsedMs / 1000);
};

export const formatRatePerSecond = (rate: number): string => `${formatCompactCount(Math.round(rate))}/s`;

/** Silent while the snapshot is undefined, or the banner flashes on every page load. */
export const shouldWarnNoWorker = (snapshot: PipelineSnapshot | undefined): boolean =>
  snapshot !== undefined && !snapshot.workerAnswering;

/** Whether anything can flow at all; gates the travelling dot and the two derived nodes. */
export const isRibbonFlowing = (snapshot: PipelineSnapshot | undefined): boolean =>
  snapshot !== undefined && snapshot.configuredConnectors > 0;

export interface RibbonValues {
  configuredConnectors: string,
  queuedRuns: string,
  runningNow: string,
  ingestionRate: string,
  streamCatchup: string,
  recordsIngested: string,
}

const EMPTY_RIBBON_VALUES: RibbonValues = {
  configuredConnectors: EMPTY_VALUE,
  queuedRuns: EMPTY_VALUE,
  runningNow: EMPTY_VALUE,
  ingestionRate: EMPTY_VALUE,
  streamCatchup: EMPTY_VALUE,
  recordsIngested: EMPTY_VALUE,
};

/**
 * Counts render even at zero, a measured empty platform being a true reading. The two derived
 * nodes render empty until they can mean something: a rate needs two samples and a configured
 * source, the catch-up needs the stream's anchors.
 */
export const buildRibbonValues = (
  snapshot: PipelineSnapshot | undefined,
  ratePerSecond: number | null,
): RibbonValues => {
  if (snapshot === undefined) {
    return EMPTY_RIBBON_VALUES;
  }
  const flowing = snapshot.configuredConnectors > 0;
  return {
    configuredConnectors: formatCompactCount(snapshot.configuredConnectors),
    queuedRuns: formatCompactCount(snapshot.queuedRuns),
    runningNow: formatCompactCount(snapshot.runningNow),
    ingestionRate: flowing && ratePerSecond !== null ? formatRatePerSecond(ratePerSecond) : EMPTY_VALUE,
    streamCatchup: flowing && snapshot.streamCatchupPercent !== null
      ? formatPointsAsPercent(snapshot.streamCatchupPercent, 0)
      : EMPTY_VALUE,
    recordsIngested: formatCompactCount(snapshot.recordsIngested),
  };
};
