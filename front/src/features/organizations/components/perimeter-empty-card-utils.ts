/**
 * True only once the organization list is known and empty: an unresolved query
 * must not flash the card.
 */
export const isPerimeterEmpty = (organizations: ReadonlyArray<unknown> | undefined): boolean =>
  organizations !== undefined && organizations.length === 0;
