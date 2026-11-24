/** The settings pane at a 1080 px screen, where the rules table must not scroll sideways. */
export const RULES_TABLE_PANE_WIDTH_AT_1080 = 652;

/** The horizontal padding of a design system table cell (`px-l` on both sides). */
export const RULES_TABLE_CELL_PADDING = 32;

/**
 * The column widths of Settings > Engine > Dependency Rules. The table is laid out fixed
 * (`DataPageLayout` `fixedColumnWidths`), so these widths bind and add up to the pane at 1080: the
 * table never scrolls sideways (Design standards s.3). A value wider than its column is cut with an
 * ellipsis and shown whole in a tooltip; a list of chips shows its first chip and a `+n` chip, or
 * its count alone when the column is too narrow for a readable first chip (`OneLineChips`).
 * Links holds a number and Status one chip, so the room goes to Conditions and Role; Primary asset
 * keeps its header whole.
 */
export const RULE_COLUMN_SIZES = {
  name: 76,
  conditions: 128,
  primaryAssetName: 128,
  roles: 88,
  linkCount: 56,
  enabled: 120,
  actions: 56,
} as const;
