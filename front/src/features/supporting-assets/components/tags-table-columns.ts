/** The settings pane at a 1080 px screen, where the tags table must not scroll sideways. */
export const TAGS_TABLE_PANE_WIDTH_AT_1080 = 652;

/** Horizontal padding of a header cell of the DS table (16 px left, 8 px right). */
export const TABLE_HEADER_CELL_PADDING = 24;

/** Horizontal padding of a body cell of the DS table (16 px left, 16 px right), measured in the lab. */
export const TABLE_BODY_CELL_PADDING = 32;

/** The Name column of the tags table. */
export const TAG_NAME_COLUMN_WIDTH = 132;

/**
 * The widest a tag chip of the Name column gets before its label truncates (DS Chip tooltip): the
 * column minus the body cell padding, so the cell never overflows and paints its own ellipsis.
 */
export const TAG_NAME_CHIP_MAX_WIDTH = TAG_NAME_COLUMN_WIDTH - TABLE_BODY_CELL_PADDING;
export const TAG_NAME_CHIP_CLASS = 'max-w-[100px]';

/**
 * The min-content each header needs, measured in the lab at 1080 (label, the header's options
 * button and the cell padding): below it the label is clipped.
 */
export const TAG_HEADER_MIN_WIDTHS = {
  connectorNames: 152,
  mergedTags: 120,
  assetCount: 88,
} as const;

/**
 * The column widths of Settings > Taxonomies > Tags. The table is laid out fixed
 * (`DataPageLayout` `fixedColumnWidths`), so these widths bind: a header can no longer grow its
 * column past them, as it did when they were only a floor (691 px in the 652 px pane). They hold
 * every header at its min-content and add up to the pane at 1080.
 */
export const TAG_COLUMN_SIZES = {
  name: TAG_NAME_COLUMN_WIDTH,
  connectorNames: TAG_HEADER_MIN_WIDTHS.connectorNames,
  sources: 104,
  mergedTags: TAG_HEADER_MIN_WIDTHS.mergedTags,
  assetCount: TAG_HEADER_MIN_WIDTHS.assetCount,
  actions: 56,
} as const;
