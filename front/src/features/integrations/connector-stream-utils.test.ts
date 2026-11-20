import { describe, expect, it } from 'vitest';
import { isStreamReadStale, msUntilStreamReadStale, streamReadRate } from './connector-stream-utils';

const at = (isoSeconds: string) => `2026-08-31T10:00:${isoSeconds}.000Z`;

describe('streamReadRate', () => {
  it('divides the objects taken by the interval the server stamped', () => {
    expect(streamReadRate(
      { objectsRead: 1_000, objectsReadAt: at('00') },
      { objectsRead: 2_070, objectsReadAt: at('05') },
    )).toEqual({ value: 214, unit: 'per-second' });
  });

  it('switches to a per-minute figure below one object a second', () => {
    expect(streamReadRate(
      { objectsRead: 10, objectsReadAt: at('00') },
      { objectsRead: 13, objectsReadAt: at('30') },
    )).toEqual({ value: 6, unit: 'per-minute' });
  });

  it('gives no rate at all rather than one rounding to nothing', () => {
    expect(streamReadRate(
      { objectsRead: 10, objectsReadAt: '2026-08-31T10:00:00.000Z' },
      { objectsRead: 11, objectsReadAt: '2026-08-31T10:10:00.000Z' },
    )).toBeNull();
  });

  it('gives no rate when the counter did not move', () => {
    expect(streamReadRate(
      { objectsRead: 10, objectsReadAt: at('00') },
      { objectsRead: 10, objectsReadAt: at('05') },
    )).toBeNull();
  });

  it('gives no rate when the two samples carry the same instant', () => {
    expect(streamReadRate(
      { objectsRead: 10, objectsReadAt: at('05') },
      { objectsRead: 40, objectsReadAt: at('05') },
    )).toBeNull();
  });

  it('gives no rate when the counter went backwards, which a reset makes possible', () => {
    expect(streamReadRate(
      { objectsRead: 900, objectsReadAt: at('00') },
      { objectsRead: 12, objectsReadAt: at('05') },
    )).toBeNull();
  });
});

describe('staleness', () => {
  const now = new Date('2026-08-31T10:05:00.000Z').getTime();

  it('holds a sample this browser received ten seconds ago, and says how long it has left', () => {
    expect(isStreamReadStale(now - 10_000, now)).toBe(false);
    expect(msUntilStreamReadStale(now - 10_000, now)).toBe(50_000);
  });

  it('drops a sample received a minute ago', () => {
    expect(isStreamReadStale(now - 60_000, now)).toBe(true);
    expect(msUntilStreamReadStale(now - 60_000, now)).toBeNull();
  });

  it('treats a stream this browser has received nothing for as having no current rate', () => {
    expect(isStreamReadStale(null, now)).toBe(true);
    expect(msUntilStreamReadStale(null, now)).toBeNull();
  });
});
