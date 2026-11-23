import { describe, expect, it } from 'vitest';
import { isInventoryDue, OPENAEV_INVENTORY_INTERVAL_MS } from './full-walk-utils';

const NOW = new Date('2026-11-23T20:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR_MS = 60 * 60 * 1000;

describe('isInventoryDue', () => {
  it('is due when the connector never completed an inventory', () => {
    expect(isInventoryDue(null, null, NOW)).toBe(true);
  });

  it('is due once the last inventory is older than the interval', () => {
    expect(isInventoryDue(ago(OPENAEV_INVENTORY_INTERVAL_MS + 1), null, NOW)).toBe(true);
  });

  it('is not due within the interval when nobody asked', () => {
    expect(isInventoryDue(ago(2 * HOUR_MS), null, NOW)).toBe(false);
  });

  it('is due within the interval when an administrator asked for one', () => {
    expect(isInventoryDue(ago(2 * HOUR_MS), ago(60 * 1000), NOW)).toBe(true);
  });
});
