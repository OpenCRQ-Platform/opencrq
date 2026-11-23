import { describe, expect, it } from 'vitest';
import {
  TABLE_CELL_PADDING,
  TAG_COLUMN_SIZES,
  TAG_HEADER_MIN_WIDTHS,
  TAG_NAME_CHIP_MAX_WIDTH,
  TAGS_TABLE_PANE_WIDTH_AT_1080,
} from './tags-table-columns';

describe('tags table column widths', () => {
  it('should add up to no more than the settings pane at 1080, so the table never scrolls sideways', () => {
    const total = Object.values(TAG_COLUMN_SIZES).reduce((sum, size) => sum + size, 0);
    expect(total).toBeLessThanOrEqual(TAGS_TABLE_PANE_WIDTH_AT_1080);
  });

  it('should keep every header at its measured min-content, which a fixed layout would otherwise clip', () => {
    expect(TAG_COLUMN_SIZES.connectorNames).toBeGreaterThanOrEqual(TAG_HEADER_MIN_WIDTHS.connectorNames);
    expect(TAG_COLUMN_SIZES.mergedTags).toBeGreaterThanOrEqual(TAG_HEADER_MIN_WIDTHS.mergedTags);
    expect(TAG_COLUMN_SIZES.assetCount).toBeGreaterThanOrEqual(TAG_HEADER_MIN_WIDTHS.assetCount);
  });

  it('should fit the widest tag chip and the cell padding in the Name column', () => {
    expect(TAG_COLUMN_SIZES.name).toBeGreaterThanOrEqual(TAG_NAME_CHIP_MAX_WIDTH + TABLE_CELL_PADDING);
  });
});
