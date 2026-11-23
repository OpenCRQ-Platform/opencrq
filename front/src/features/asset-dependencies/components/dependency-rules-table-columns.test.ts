import { describe, expect, it } from 'vitest';
import { RULE_COLUMN_SIZES, RULES_TABLE_PANE_WIDTH_AT_1080 } from './dependency-rules-table-columns';

describe('dependency rules table column widths', () => {
  it('should add up to no more than the settings pane at 1080, so the table never scrolls sideways', () => {
    const total = Object.values(RULE_COLUMN_SIZES).reduce((sum, size) => sum + size, 0);
    expect(total).toBeLessThanOrEqual(RULES_TABLE_PANE_WIDTH_AT_1080);
  });
});
