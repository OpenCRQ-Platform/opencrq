/**
 * For a design system `Card` stretched taller than its content, by `h-full` or by its grid row, whose
 * content pins a block to the bottom (`mt-auto`) or grows into the height (`grow`), or that ends on a
 * `CardMetaBar`, which does not pin itself. The card lays its parts out in an inner region, its first
 * child when it has no banner or media, which otherwise keeps its content height and leaves the slack
 * under it.
 */
export const CARD_CONTENT_FILLS = '*:first:grow';
