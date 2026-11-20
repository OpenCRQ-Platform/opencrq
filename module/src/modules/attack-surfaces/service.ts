import type { InferRepository } from '../../registry';
import type { AssetCategory } from '../supporting-assets/constants';
import type { ApplicablePair } from './applicable-techniques-resolver';
import { defineService } from '../../registry';
import { UNCLASSIFIED_ASSETS_IN_SCOPE } from './constants';
import { foldPairsOntoRequestedTechniques, withUnclassifiedBucket } from './applicable-techniques-resolver';
import { attackSurfacesRepository } from './repository';

type Repo = InferRepository<typeof attackSurfacesRepository>;

const UNCLASSIFIED_CATEGORY: AssetCategory = 'generic_asset';

interface ResolverOptions {
  /**
   * Whether the unclassified bucket takes part in this answer. Off unless the caller asks, and the
   * engine setting can still refuse: turning the setting off is the only way to obtain an answer in
   * which no technique concerns unclassified assets.
   */
  readonly includeUnclassified?: boolean,
  /**
   * The tenant the answer is for. Required of jobs, which run under a `system` origin where the
   * secured views apply no tenant filter: the junction is per-tenant, so the answer would otherwise
   * be built from every tenant's rows at once.
   */
  readonly tenantId?: string,
}

const unclassifiedApplies = (options: ResolverOptions | undefined): boolean => (
  options?.includeUnclassified === true && UNCLASSIFIED_ASSETS_IN_SCOPE
);

const resolvePairs = async (repo: Repo, techniqueIds: Array<string>, options?: ResolverOptions): Promise<Array<ApplicablePair>> => {
  if (techniqueIds.length === 0) {
    return [];
  }
  const pairs = foldPairsOntoRequestedTechniques(await repo.findApplicablePairsForTechniques(techniqueIds, options?.tenantId), techniqueIds);
  return unclassifiedApplies(options) ? withUnclassifiedBucket(pairs, techniqueIds, UNCLASSIFIED_CATEGORY) : pairs;
};

/**
 * The only read path onto the family x applicable technique table, in both directions.
 * No consumer queries the junction itself, and no consumer reassembles the branch rule or the
 * unclassified rule on its own.
 */
export const attackSurfacesService = defineService(
  'attackSurfaces',
  attackSurfacesRepository,
).implement({
  // eslint-disable-next-line app/no-unused-service-method -- no caller yet; the seeder reaches the per-tenant surface rows through their derived ids, and the category page is the first reader
  getAttackSurfaces: async ({ repo }) => await repo.findAllAttackSurfaces(),

  /**
   * The techniques a family carries. The unclassified bucket carries no row of its own: it answers
   * every live technique, from the rule rather than from the table, and only when the caller opts in.
   */
  getApplicableTechniques: async ({ repo }, categoryId: AssetCategory, options?: ResolverOptions) => {
    if (categoryId === UNCLASSIFIED_CATEGORY) {
      return unclassifiedApplies(options) ? await repo.findAllLiveTechniques() : [];
    }
    return await repo.findApplicableTechniquesByCategory(categoryId);
  },

  getApplicableTechniqueCountPerCategory: async ({ repo }) => await repo.countApplicableTechniquesPerCategory(),

  /** The families a set of techniques reaches, one pair per technique and family. */
  getApplicablePairsForTechniques: async ({ repo }, techniqueIds: Array<string>, options?: ResolverOptions) => await resolvePairs(repo, techniqueIds, options),
});
