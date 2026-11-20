import type { PgColumn } from 'drizzle-orm/pg-core';
import type { RepositoryContext } from '../../registry';
import { eq, inArray } from 'drizzle-orm';

/**
 * Which assets a risk scope is measured over, as the readers receive it: `open` narrows nothing,
 * `closed` narrows to the scope's mapping. The mode itself is read once, by the resolver, so that
 * no reader has to know a scope carries one.
 */
export type ResolvedEstate = { mode: 'open' } | { mode: 'closed', organizationId: string };

export const OPEN_ESTATE: ResolvedEstate = { mode: 'open' };

/** The estate a reader narrowing to one scope's mapping asks for; `null` is the whole tenant library. */
export const estateOfMappedScope = (organizationId: string | null): ResolvedEstate =>
  (organizationId === null ? OPEN_ESTATE : { mode: 'closed', organizationId });

/**
 * Membership of the estate, as a predicate on any column holding an asset id, or `undefined` when
 * the estate narrows nothing.
 *
 * Every reader of an estate goes through this one builder, the engine's population reads included:
 * a page and the figure priced beside it disagreeing on what the scope holds is the failure the
 * single builder exists to make impossible. It is a join on the mapping and never a list of ids:
 * one scope maps hundreds of thousands of rows.
 */
export const estateFilter = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  estate: ResolvedEstate,
  assetIdColumn: PgColumn,
) => {
  if (estate.mode === 'open') {
    return undefined;
  }
  const mappedAssetIdsSq = db.select({ supportingAssetId: views.organizationAssets.supportingAssetId })
    .from(views.organizationAssets)
    .where(eq(views.organizationAssets.organizationId, estate.organizationId));
  return inArray(assetIdColumn, mappedAssetIdsSq);
};
