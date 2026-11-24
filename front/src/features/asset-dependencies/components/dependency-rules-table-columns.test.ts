import { describe, expect, it } from 'vitest';
import { RULE_COLUMN_SIZES, RULES_TABLE_CELL_PADDING, RULES_TABLE_PANE_WIDTH_AT_1080 } from './dependency-rules-table-columns';
import { ONE_LINE_CHIPS_FIRST_CHIP_MIN_WIDTH, ONE_LINE_CHIPS_MIN_WIDTH } from './one-line-chips';

describe('dependency rules table column widths', () => {
  it('should add up to no more than the settings pane at 1080, so the table never scrolls sideways', () => {
    const total = Object.values(RULE_COLUMN_SIZES).reduce((sum, size) => sum + size, 0);
    expect(total).toBeLessThanOrEqual(RULES_TABLE_PANE_WIDTH_AT_1080);
  });

  it('should leave the Conditions column room for a readable first chip and its +n chip', () => {
    expect(RULE_COLUMN_SIZES.conditions - RULES_TABLE_CELL_PADDING).toBeGreaterThanOrEqual(ONE_LINE_CHIPS_MIN_WIDTH);
  });

  it('should leave every chip column room for at least a readable single chip', () => {
    for (const size of [RULE_COLUMN_SIZES.conditions, RULE_COLUMN_SIZES.roles]) {
      expect(size - RULES_TABLE_CELL_PADDING).toBeGreaterThanOrEqual(ONE_LINE_CHIPS_FIRST_CHIP_MIN_WIDTH);
    }
  });

  it('should give Status room for the Disabled chip in every language (about 88 px of chip)', () => {
    expect(RULE_COLUMN_SIZES.enabled - RULES_TABLE_CELL_PADDING).toBeGreaterThanOrEqual(88);
  });
});
