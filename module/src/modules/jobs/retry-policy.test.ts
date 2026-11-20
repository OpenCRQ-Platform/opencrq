import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeNextRunAfter,
  computeRetryDelayMs,
  DEFAULT_RETRY_POLICY,
  deferralDelayMs,
  deferralPolicyFor,
} from './retry-policy';
import { isErrorRetryable, NonRetryableError, TimeoutError } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeRetryDelayMs', () => {
  it('returns a positive delay for attempt 0 within jitter bounds', () => {
    const delay = computeRetryDelayMs(0);
    const min = DEFAULT_RETRY_POLICY.baseDelayMs * DEFAULT_RETRY_POLICY.jitterMin;
    const max = DEFAULT_RETRY_POLICY.baseDelayMs * DEFAULT_RETRY_POLICY.jitterMax;
    expect(delay).toBeGreaterThanOrEqual(min);
    expect(delay).toBeLessThanOrEqual(max);
  });

  it('grows exponentially when jitter is pinned at midpoint', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(computeRetryDelayMs(0)).toBe(1_000);
    expect(computeRetryDelayMs(1)).toBe(2_000);
    expect(computeRetryDelayMs(2)).toBe(4_000);
    expect(computeRetryDelayMs(3)).toBe(8_000);
    expect(computeRetryDelayMs(4)).toBe(16_000);
  });

  it('caps at maxDelayMs', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(computeRetryDelayMs(100)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it('applies random jitter across the configured range', () => {
    const samples: Array<number> = [];
    for (let i = 0; i < 200; i += 1) {
      samples.push(computeRetryDelayMs(2));
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const base = DEFAULT_RETRY_POLICY.baseDelayMs * (DEFAULT_RETRY_POLICY.exponentBase ** 2);
    expect(min).toBeGreaterThanOrEqual(base * DEFAULT_RETRY_POLICY.jitterMin);
    expect(max).toBeLessThanOrEqual(base * DEFAULT_RETRY_POLICY.jitterMax);
    expect(max - min).toBeGreaterThan(500);
  });

  it('clamps negative attempts to attempt 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(computeRetryDelayMs(-5)).toBe(1_000);
  });
});

describe('computeNextRunAfter', () => {
  it('returns a date strictly later than `now`', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const next = computeNextRunAfter(0, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('isErrorRetryable', () => {
  it('treats NonRetryableError as non-retryable', () => {
    expect(isErrorRetryable(new NonRetryableError('x'))).toBe(false);
  });

  it('defaults to retryable for plain Error', () => {
    expect(isErrorRetryable(new Error('boom'))).toBe(true);
  });

  it('defaults to retryable for non-Error values', () => {
    expect(isErrorRetryable('string error')).toBe(true);
    expect(isErrorRetryable(null)).toBe(true);
    expect(isErrorRetryable(undefined)).toBe(true);
  });

  it('treats TimeoutError as retryable', () => {
    expect(isErrorRetryable(new TimeoutError('handler exceeded maxRuntimeMs'))).toBe(true);
  });
});

describe('computeRetryDelayMs cap', () => {
  it('clamps below maxDelayMs even at jitter max', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(computeRetryDelayMs(100)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });
});

describe('deferralPolicyFor', () => {
  it.each([500, 300_000, 3_600_000])('waits longer than a booking delay of %i ms', (bookingCapMs) => {
    expect(deferralPolicyFor(bookingCapMs).maxWaitMs).toBeGreaterThan(bookingCapMs);
  });
});

describe('deferralDelayMs', () => {
  const policy = { minDelayMs: 2_000, maxDelayMs: 30_000, maxWaitMs: 600_000 };

  it.each([
    [0, 2_000],
    [8_000, 2_000],
    [40_000, 10_000],
    [120_000, 30_000],
    [500_000, 30_000],
  ])('waits a quarter of an age of %i ms, within the policy bounds: %i ms', (ageMs, expected) => {
    expect(deferralDelayMs(ageMs, policy)).toBe(expected);
  });
});
