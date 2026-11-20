import { describe, expect, it } from 'vitest';
import { mapWithConcurrency, sleep } from './utils';

describe('mapWithConcurrency', () => {
  it('processes every item', async () => {
    const seen: Array<number> = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, (item) => {
      seen.push(item);
      return Promise.resolve();
    });
    expect(seen.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never runs more workers at once than the given concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    // Proves the items actually ran concurrently rather than accidentally sequentially.
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('stops pulling new items once the signal aborts', async () => {
    const controller = new AbortController();
    const seen: Array<number> = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 1, (item) => {
      seen.push(item);
      if (item === 2) {
        controller.abort();
      }
      return Promise.resolve();
    }, controller.signal);
    expect(seen).toEqual([1, 2]);
  });

  it('lets a worker error propagate', async () => {
    await expect(mapWithConcurrency([1, 2, 3], 3, (item) => {
      if (item === 2) {
        throw new Error('boom');
      }
      return Promise.resolve();
    })).rejects.toThrow('boom');
  });
});
