import { describe, expect, it } from 'vitest';
import { bucketDistribution } from './outcome-distribution';

describe('bucketDistribution', () => {
  it('groups identical values into one bucket with the right count and share', () => {
    const buckets = bucketDistribution(['team', 'team', 'organization']);
    expect(buckets).toEqual([
      { value: 'team', count: 2, share: 2 / 3 },
      { value: 'organization', count: 1, share: 1 / 3 },
    ]);
  });

  it('carries the unstated bucket at its true size and always places it last', () => {
    const buckets = bucketDistribution(['team', null, null, null]);
    expect(buckets).toEqual([
      { value: 'team', count: 1, share: 1 / 4 },
      { value: null, count: 3, share: 3 / 4 },
    ]);
  });

  it('never redistributes the unstated bucket over the stated ones', () => {
    const buckets = bucketDistribution(['team', 'organization', null]);
    const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(3);
  });

  it('orders stated buckets by count descending, ties broken alphabetically', () => {
    const buckets = bucketDistribution(['zebra', 'apple']);
    expect(buckets.map((bucket) => bucket.value)).toEqual(['apple', 'zebra']);
  });

  it('omits the unstated bucket entirely when every value is stated', () => {
    const buckets = bucketDistribution(['team']);
    expect(buckets.some((bucket) => bucket.value === null)).toBe(false);
  });

  it('returns an empty list for no values', () => {
    expect(bucketDistribution([])).toEqual([]);
  });
});
