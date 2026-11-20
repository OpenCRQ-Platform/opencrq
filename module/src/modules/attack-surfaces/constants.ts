/**
 * Whether assets in the unclassified bucket take part in the computation.
 *
 * This belongs in the per-tenant engine settings, and that table does not exist yet. Until it does,
 * the specification default lives here as a constant, which is the documented fallback for every
 * other engine setting in the same situation: when the table lands, this becomes one of its columns
 * and this constant becomes that column's default.
 *
 * In scope by default, so that a badly catalogued estate costs more rather than less.
 */
export const UNCLASSIFIED_ASSETS_IN_SCOPE = true;
