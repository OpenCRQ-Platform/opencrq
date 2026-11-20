import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doorbell } from './event-stream-utils';
import { createDoorbellGate, planDoorbellInvalidations } from './event-stream-utils';

const queryKey = ['assets'];

const mountedQuery = async () => {
  const queryClient = new QueryClient();
  const queryFn = vi.fn().mockResolvedValue('data');
  const observer = new QueryObserver(queryClient, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  queryFn.mockClear();
  return { queryClient, queryFn, unsubscribe };
};

const applyTo = async (queryClient: QueryClient, documentHidden: boolean) => {
  await Promise.all(
    planDoorbellInvalidations({ procedures: [], all: true }, documentHidden)
      // eslint-disable-next-line no-restricted-syntax -- this test exercises the SSE doorbell mechanism itself against a real QueryClient
      .map((invalidation) => queryClient.invalidateQueries(invalidation)),
  );
};

describe('planDoorbellInvalidations', () => {
  it('should invalidate each named procedure by its key prefix and refetch the active ones', () => {
    expect(planDoorbellInvalidations({ procedures: ['organizations.getOrganizations', 'dashboard.getAssetsOverview'], all: false }, false)).toEqual([
      { queryKey: [['organizations', 'getOrganizations']], refetchType: 'active' },
      { queryKey: [['dashboard', 'getAssetsOverview']], refetchType: 'active' },
    ]);
  });

  it('should only mark the queries stale in a hidden document', () => {
    expect(planDoorbellInvalidations({ procedures: ['organizations.getOrganizations'], all: false }, true)).toEqual([
      { queryKey: [['organizations', 'getOrganizations']], refetchType: 'none' },
    ]);
  });

  it('should invalidate everything at once when the doorbell stands for every table', () => {
    expect(planDoorbellInvalidations({ procedures: [], all: true }, false)).toEqual([{ refetchType: 'active' }]);
    expect(planDoorbellInvalidations({ procedures: [], all: true }, true)).toEqual([{ refetchType: 'none' }]);
  });

  it('should ask nothing of the cache when the doorbell names no procedure', () => {
    expect(planDoorbellInvalidations({ procedures: [], all: false }, false)).toEqual([]);
  });

  it('should send no request when the tab is hidden, and mark its queries stale', async () => {
    const { queryClient, queryFn, unsubscribe } = await mountedQuery();

    await applyTo(queryClient, true);

    expect(queryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    unsubscribe();
  });

  it('should refetch a mounted query when the tab is visible', async () => {
    const { queryClient, queryFn, unsubscribe } = await mountedQuery();

    await applyTo(queryClient, false);

    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('createDoorbellGate', () => {
  const rung = (...procedures: Array<string>): Doorbell => ({ procedures, all: false });

  const gate = () => {
    const delivered: Array<Doorbell> = [];
    return { delivered, ...createDoorbellGate((doorbell) => delivered.push(doorbell)) };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should deliver a doorbell at once when nothing holds it', () => {
    const { delivered, ring } = gate();

    ring(rung('assets.getAsset'));

    expect(delivered).toEqual([rung('assets.getAsset')]);
  });

  it('should deliver the doorbells rung during a hold as one, 300 ms after release', () => {
    const { delivered, ring, hold } = gate();
    const release = hold();

    ring(rung('assetDependencies.getSupportToSupportLinks'));
    ring(rung('assetDependencies.getSupportToSupportLinks', 'assets.getAsset'));
    release();
    vi.advanceTimersByTime(299);
    expect(delivered).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(delivered).toEqual([rung('assetDependencies.getSupportToSupportLinks', 'assets.getAsset')]);
  });

  it('should merge a doorbell rung just after the release, as the last write\'s is', () => {
    const { delivered, ring, hold } = gate();
    const release = hold();
    ring(rung('assets.getAsset'));
    release();

    vi.advanceTimersByTime(100);
    ring(rung('assetDependencies.getSupportToSupportLinks'));
    vi.advanceTimersByTime(200);

    expect(delivered).toEqual([rung('assets.getAsset', 'assetDependencies.getSupportToSupportLinks')]);
  });

  it('should hold until the last of overlapping holds is released', () => {
    const { delivered, ring, hold } = gate();
    const releaseFirst = hold();
    const releaseSecond = hold();
    ring(rung('assets.getAsset'));

    releaseFirst();
    releaseFirst();
    vi.advanceTimersByTime(300);
    expect(delivered).toEqual([]);

    releaseSecond();
    vi.advanceTimersByTime(300);
    expect(delivered).toEqual([rung('assets.getAsset')]);
  });

  it('should keep holding when a new hold starts before the delivery', () => {
    const { delivered, ring, hold } = gate();
    const releaseFirst = hold();
    ring(rung('assets.getAsset'));
    releaseFirst();

    vi.advanceTimersByTime(200);
    const releaseSecond = hold();
    vi.advanceTimersByTime(300);
    expect(delivered).toEqual([]);

    releaseSecond();
    vi.advanceTimersByTime(300);
    expect(delivered).toEqual([rung('assets.getAsset')]);
  });

  it('should deliver a held doorbell for every table as one for every table', () => {
    const { delivered, ring, hold } = gate();
    const release = hold();
    ring(rung('assets.getAsset'));
    ring({ procedures: [], all: true });

    release();
    vi.advanceTimersByTime(300);

    expect(delivered).toEqual([{ procedures: [], all: true }]);
  });

  it('should release a hold by itself past the longest hold, and ignore its late release', () => {
    const { delivered, ring, hold } = gate();
    const release = hold();
    ring(rung('assets.getAsset'));

    vi.advanceTimersByTime(15_300);
    expect(delivered).toEqual([rung('assets.getAsset')]);

    release();
    ring(rung('assets.getAsset'));
    expect(delivered).toEqual([rung('assets.getAsset'), rung('assets.getAsset')]);
  });

  it('should deliver nothing on release when nothing rang', () => {
    const { delivered, hold } = gate();

    hold()();
    vi.advanceTimersByTime(300);

    expect(delivered).toEqual([]);
  });
});
