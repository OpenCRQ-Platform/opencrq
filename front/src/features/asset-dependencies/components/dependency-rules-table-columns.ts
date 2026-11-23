/** The settings pane at a 1080 px screen, where the rules table must not scroll sideways. */
export const RULES_TABLE_PANE_WIDTH_AT_1080 = 652;

/**
 * The column widths of Settings > Engine > Dependency Rules. The table is laid out fixed
 * (`DataPageLayout` `fixedColumnWidths`), so these widths bind and add up to the pane at 1080: the
 * table never scrolls sideways (Design standards s.3). A value wider than its column is cut with an
 * ellipsis and shown whole in a tooltip; a list of chips shows its first chip and a `+n` chip.
 */
export const RULE_COLUMN_SIZES = {
  name: 104,
  conditions: 108,
  primaryAssetName: 116,
  roles: 80,
  linkCount: 88,
  enabled: 100,
  actions: 56,
} as const;
