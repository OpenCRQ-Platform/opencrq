import { describe, expect, it } from 'vitest';
import {
  EMPTY_ESTATE_MAPPING_DELTA,
  isAssetSelected,
  orderSelectedFirst,
  selectedAssetCount,
  toggleAssetSelection,
} from './estate-assets-picker-utils';

describe('toggleAssetSelection', () => {
  it('should add a row the scope does not map', () => {
    expect(toggleAssetSelection(EMPTY_ESTATE_MAPPING_DELTA, 'a', false)).toEqual({ added: ['a'], removed: [] });
  });

  it('should remove a row the scope maps', () => {
    expect(toggleAssetSelection(EMPTY_ESTATE_MAPPING_DELTA, 'a', true)).toEqual({ added: [], removed: ['a'] });
  });

  it('should leave the delta empty when a tick is undone', () => {
    const ticked = toggleAssetSelection(EMPTY_ESTATE_MAPPING_DELTA, 'a', false);
    expect(toggleAssetSelection(ticked, 'a', false)).toEqual(EMPTY_ESTATE_MAPPING_DELTA);
  });

  it('should leave the delta empty when an untick is undone', () => {
    const unticked = toggleAssetSelection(EMPTY_ESTATE_MAPPING_DELTA, 'a', true);
    expect(toggleAssetSelection(unticked, 'a', true)).toEqual(EMPTY_ESTATE_MAPPING_DELTA);
  });

  it('should leave the input untouched', () => {
    const delta = { added: ['a'], removed: [] };
    toggleAssetSelection(delta, 'b', false);
    expect(delta).toEqual({ added: ['a'], removed: [] });
  });
});

describe('isAssetSelected', () => {
  it('should hold a stored row that was not unticked', () => {
    expect(isAssetSelected(EMPTY_ESTATE_MAPPING_DELTA, 'a', true)).toBe(true);
  });

  it('should drop a stored row that was unticked', () => {
    expect(isAssetSelected({ added: [], removed: ['a'] }, 'a', true)).toBe(false);
  });

  it('should hold a row ticked this session', () => {
    expect(isAssetSelected({ added: ['a'], removed: [] }, 'a', false)).toBe(true);
  });
});

describe('selectedAssetCount', () => {
  it('should count the stored mapping plus the delta', () => {
    expect(selectedAssetCount(500, { added: ['a', 'b'], removed: ['c'] })).toBe(501);
  });
});

describe('orderSelectedFirst', () => {
  const rows = [
    { id: 'a', mapped: false },
    { id: 'b', mapped: true },
    { id: 'c', mapped: false },
    { id: 'd', mapped: true },
  ];

  it('should raise the selected rows', () => {
    expect(orderSelectedFirst(rows, EMPTY_ESTATE_MAPPING_DELTA).map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('should raise a row ticked since the page was served', () => {
    expect(orderSelectedFirst(rows, { added: ['c'], removed: [] }).map((row) => row.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('should keep the incoming order when every row is selected', () => {
    expect(orderSelectedFirst(rows, { added: ['a', 'c'], removed: [] })).toEqual(rows);
  });

  it('should keep the incoming order when nothing is selected', () => {
    expect(orderSelectedFirst(rows, { added: [], removed: ['b', 'd'] })).toEqual(rows);
  });
});
