import { describe, expect, it } from 'vitest';
import { computeCriticalityLifts, diffCriticalityLifts, liftGivesBand, toReprojectionBatches } from './criticality-lift';

describe('computeCriticalityLifts', () => {
  it('lifts a device one band below the identity assigned to it', () => {
    expect(computeCriticalityLifts([
      { deviceId: 'laptop-1', identityId: 'admin', identityCriticality: 'very_high' },
      { deviceId: 'laptop-2', identityId: 'analyst', identityCriticality: 'high' },
    ])).toEqual([
      { supportingAssetId: 'laptop-1', criticality: 'high', fromAssetId: 'admin' },
      { supportingAssetId: 'laptop-2', criticality: 'medium', fromAssetId: 'analyst' },
    ]);
  });

  it('lifts nothing from an identity at medium or below', () => {
    const bands = ['medium', 'low', 'unknown'] as const;
    expect(computeCriticalityLifts(bands.map((band, i) => ({ deviceId: `laptop-${i}`, identityId: `user-${i}`, identityCriticality: band })))).toEqual([]);
  });

  it('takes the highest of several identities, and the same one on every run when two tie', () => {
    const assignments = [
      { deviceId: 'shared', identityId: 'b-analyst', identityCriticality: 'high' as const },
      { deviceId: 'shared', identityId: 'z-admin', identityCriticality: 'very_high' as const },
      { deviceId: 'shared', identityId: 'a-admin', identityCriticality: 'very_high' as const },
    ];
    expect(computeCriticalityLifts(assignments)).toEqual([{ supportingAssetId: 'shared', criticality: 'high', fromAssetId: 'a-admin' }]);
    expect(computeCriticalityLifts([...assignments].reverse())).toEqual([{ supportingAssetId: 'shared', criticality: 'high', fromAssetId: 'a-admin' }]);
  });
});

describe('diffCriticalityLifts', () => {
  it('writes a new or changed lift, deletes one no identity gives any more, and leaves an unchanged one alone', () => {
    const diff = diffCriticalityLifts(
      [
        { supportingAssetId: 'same', criticality: 'high', fromAssetId: 'admin' },
        { supportingAssetId: 'changed', criticality: 'medium', fromAssetId: 'analyst' },
        { supportingAssetId: 'gone', criticality: 'high', fromAssetId: null },
      ],
      [
        { supportingAssetId: 'same', criticality: 'high', fromAssetId: 'admin' },
        { supportingAssetId: 'changed', criticality: 'high', fromAssetId: 'admin' },
        { supportingAssetId: 'new', criticality: 'medium', fromAssetId: 'analyst' },
      ],
    );

    expect(diff.upserts.map((lift) => lift.supportingAssetId)).toEqual(['changed', 'new']);
    expect(diff.deletedAssetIds).toEqual(['gone']);
    expect(diff.changedAssetIds).toEqual(['changed', 'new', 'gone']);
  });

  it('changes nothing when every stored lift is the computed one', () => {
    const lifts = [{ supportingAssetId: 'same', criticality: 'high' as const, fromAssetId: 'admin' }];
    expect(diffCriticalityLifts(lifts, lifts)).toEqual({ upserts: [], deletedAssetIds: [], changedAssetIds: [] });
  });
});

describe('toReprojectionBatches', () => {
  it('keeps every batch under the size, however many devices changed', () => {
    const ids = Array.from({ length: 70_001 }, (_, i) => `device-${String(i).padStart(6, '0')}`);
    const batches = toReprojectionBatches(ids, 1000);

    expect(batches).toHaveLength(71);
    expect(batches.every((batch) => batch.length <= 1000)).toBe(true);
    expect(batches.flat()).toEqual(ids);
  });

  it('orders the ids across the whole run', () => {
    expect(toReprojectionBatches(['c', 'a', 'd', 'b'], 2)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('gives no batch when nothing changed', () => {
    expect(toReprojectionBatches([], 1000)).toEqual([]);
  });
});

describe('liftGivesBand', () => {
  const lifted = { lift: 'high' as const, bandInEffect: 'high' as const, isSetByHand: false };

  it('gives the band when every reading of the device is below the lift', () => {
    expect(liftGivesBand({ ...lifted, connectorReadings: ['unknown', 'medium'] })).toBe(true);
  });

  it('gives nothing when a connector already reads the device at the lift', () => {
    expect(liftGivesBand({ ...lifted, connectorReadings: ['high'] })).toBe(false);
  });

  it('gives nothing when the band was set by hand', () => {
    expect(liftGivesBand({ ...lifted, connectorReadings: [], isSetByHand: true })).toBe(false);
  });

  it('gives nothing until the device is reprojected with it', () => {
    expect(liftGivesBand({ ...lifted, bandInEffect: 'unknown', connectorReadings: [] })).toBe(false);
  });
});
