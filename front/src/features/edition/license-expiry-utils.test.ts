import { describe, expect, it } from 'vitest';
import { licenseDaysRemaining } from './license-expiry-utils';

describe('licenseDaysRemaining', () => {
  it('rounds up a partial day to the next whole day', () => {
    const now = new Date('2026-09-29T00:00:00.000Z');
    const validUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    expect(licenseDaysRemaining(validUntil, now)).toBe(7);
  });

  it('reads an exact number of days as itself', () => {
    const now = new Date('2026-09-29T00:00:00.000Z');
    const validUntil = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    expect(licenseDaysRemaining(validUntil, now)).toBe(6);
  });

  it('accepts an ISO string, the shape a tRPC date crosses the wire as', () => {
    const now = new Date('2026-09-29T00:00:00.000Z');
    const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(licenseDaysRemaining(validUntil, now)).toBe(1);
  });

  it('never reads as negative when the clocks disagree', () => {
    const now = new Date('2026-09-29T00:00:00.000Z');
    const validUntil = new Date(now.getTime() - 1000);
    expect(licenseDaysRemaining(validUntil, now)).toBe(0);
  });
});
