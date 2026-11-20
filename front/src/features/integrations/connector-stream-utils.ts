export interface StreamReadSample {
  objectsRead: number,
  objectsReadAt: string,
}

export interface StreamReadRate {
  value: number,
  unit: 'per-second' | 'per-minute',
}

/**
 * How fast the connector is taking objects off the stream, from two samples the server stamped itself,
 * so no clock is guessed and no rate is stored. Null for an interval so long that the figure would round
 * below one object a minute, which is the staleness rule's territory rather than the rate's.
 */
export const streamReadRate = (previous: StreamReadSample, current: StreamReadSample): StreamReadRate | null => {
  const elapsedMs = new Date(current.objectsReadAt).getTime() - new Date(previous.objectsReadAt).getTime();
  const objects = current.objectsRead - previous.objectsRead;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || objects <= 0) {
    return null;
  }
  const perSecond = objects / (elapsedMs / 1000);
  if (perSecond >= 1) {
    return { value: Math.round(perSecond), unit: 'per-second' };
  }
  const perMinute = Math.round(perSecond * 60);
  return perMinute >= 1 ? { value: perMinute, unit: 'per-minute' } : null;
};

/** A rate measured long enough ago is the rate the stream had, not the one it has. */
const STALE_AFTER_MS = 60_000;

/**
 * Milliseconds left before a sample stops standing for the present, or null once it has.
 *
 * Aged from when this browser received the sample, never from the instant the server stamped on it: a
 * browser a couple of minutes off its server would otherwise suppress every rate or keep a stopped one
 * on screen.
 */
export const msUntilStreamReadStale = (receivedAt: number | null, now: number = Date.now()): number | null => {
  if (receivedAt === null || !Number.isFinite(receivedAt)) {
    return null;
  }
  const remaining = STALE_AFTER_MS - (now - receivedAt);
  return remaining > 0 ? remaining : null;
};

export const isStreamReadStale = (receivedAt: number | null, now: number = Date.now()): boolean =>
  msUntilStreamReadStale(receivedAt, now) === null;
