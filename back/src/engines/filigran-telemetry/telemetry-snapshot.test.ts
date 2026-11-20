import type { DrizzleDB } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import { EVENT_COUNTERS } from './telemetry-events';
import { COUNT_GAUGES, EDITION_GAUGE, getSnapshotValue, refreshSnapshot } from './telemetry-snapshot';

const buildDb = (
  behavior: (gaugeIndex: number) => number | Error,
  onWhere?: (gaugeIndex: number) => void,
): DrizzleDB => {
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock, object literal satisfies DrizzleDB select/from/where chain in practice
  return {
    select: () => ({
      from: () => {
        const index = call;
        call += 1;
        const run = () => {
          const result = behavior(index);
          if (result instanceof Error) {
            return Promise.reject(result);
          }
          return Promise.resolve([{ value: result }]);
        };
        // Filtered gauges chain `.where(filter)`; unfiltered ones await the
        // query builder directly, so the mock is a thenable with a `where`.
        return {
          where: () => {
            onWhere?.(index);
            return run();
          },
          then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
            run().then(onFulfilled, onRejected),
        };
      },
    }),
  } as unknown as DrizzleDB;
};

describe('telemetry snapshot', () => {
  it('names every exported series in snake case, without a product prefix, once', () => {
    const counts = [...COUNT_GAUGES, ...EVENT_COUNTERS].map(({ name }) => name);
    const names = [EDITION_GAUGE.name, ...counts];
    for (const name of counts) {
      expect(name).toMatch(/_count$/);
    }
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name, 'the analytics warehouse adds the product prefix').not.toMatch(/^(opencrq|ocrq)_/);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('counts the configured integrations of every connector source', () => {
    expect(COUNT_GAUGES.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'integration_nist_count',
      'integration_microsoft_graph_count',
      'integration_openaev_count',
    ]));
  });

  it('refreshes every count and exposes it through getSnapshotValue', async () => {
    await refreshSnapshot(buildDb((index) => index + 10));
    COUNT_GAUGES.forEach(({ name }, index) => {
      expect(getSnapshotValue(name)).toBe(index + 10);
    });
  });

  it('keeps the previous value when an individual count fails', async () => {
    await refreshSnapshot(buildDb(() => 42));
    expect(getSnapshotValue(COUNT_GAUGES[0].name)).toBe(42);

    // First gauge read fails, the others succeed with a new value.
    const onError = vi.fn();
    await refreshSnapshot(buildDb((index) => (index === 0 ? new Error('db down') : 7)), onError);

    expect(getSnapshotValue(COUNT_GAUGES[0].name)).toBe(42);
    expect(getSnapshotValue(COUNT_GAUGES[1].name)).toBe(7);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), COUNT_GAUGES[0].name);
  });

  it('reports 0 for a gauge that was never refreshed', () => {
    expect(getSnapshotValue('unknown_gauge')).toBe(0);
  });

  it('applies the filter of filtered counts and skips it for plain counts', async () => {
    const whereCalls: Array<number> = [];
    await refreshSnapshot(buildDb(() => 1, (index) => whereCalls.push(index)));
    const filteredIndexes = COUNT_GAUGES
      .map(({ filter }, index) => (filter ? index : -1))
      .filter((index) => index >= 0);
    expect(filteredIndexes.length).toBeGreaterThan(0);
    expect(whereCalls).toEqual(filteredIndexes);
  });
});
