import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type * as TimersPromises from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { mapInYieldedChunks } from './yield-chunks';

vi.mock('node:timers/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof TimersPromises>();
  return { ...actual, setImmediate: vi.fn(actual.setImmediate) };
});

describe('mapInYieldedChunks', () => {
  it('yields the event loop once per full chunk plus once for the trailing partial chunk', async () => {
    const items = Array.from({ length: 101 }, (_, i) => i);

    const mapped = await mapInYieldedChunks(items, 100, (item) => item * 2);

    expect(mapped).toEqual(items.map((item) => item * 2));
    expect(yieldToEventLoop).toHaveBeenCalledTimes(2);
  });

  it('still yields once for a batch no larger than one chunk', async () => {
    vi.mocked(yieldToEventLoop).mockClear();

    const mapped = await mapInYieldedChunks([1, 2, 3], 100, (item) => item);

    expect(mapped).toEqual([1, 2, 3]);
    expect(yieldToEventLoop).toHaveBeenCalledTimes(1);
  });
});
