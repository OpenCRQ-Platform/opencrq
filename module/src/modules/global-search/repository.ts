import { asc, count, ilike } from 'drizzle-orm';
import { foldedLike } from '../../db/fold-text';
import { escapeLikePattern } from '../../db/like-pattern';
import { defineRepository } from '../../registry';

/**
 * Per entity type, one bounded read and one count for the header's "Search the platform" field: the
 * page shows the first matches and the true number of matches. Every read goes through the secured
 * views, so a reader only ever sees the rows of the tenant on screen; the folded columns match
 * accents and case the way each entity's own list does.
 */
export const globalSearchRepository = defineRepository({
  findRiskScenarios: ({ db, views }, search: string, limit: number) =>
    db.select({ id: views.riskScenarios.id, name: views.riskScenarios.name, organizationId: views.riskScenarios.organizationId })
      .from(views.riskScenarios)
      .where(foldedLike(views.riskScenarios.nameFolded, search, 'contains'))
      .orderBy(asc(views.riskScenarios.nameFolded), asc(views.riskScenarios.id))
      .limit(limit),

  countRiskScenarios: async ({ db, views }, search: string) => {
    const [row] = await db.select({ total: count() })
      .from(views.riskScenarios)
      .where(foldedLike(views.riskScenarios.nameFolded, search, 'contains'));
    return Number(row?.total ?? 0);
  },

  findPrimaryAssets: ({ db, views }, search: string, limit: number) =>
    db.select({ id: views.primaryAssets.id, name: views.primaryAssets.name, organizationId: views.primaryAssets.organizationId })
      .from(views.primaryAssets)
      .where(foldedLike(views.primaryAssets.nameFolded, search, 'contains'))
      .orderBy(asc(views.primaryAssets.nameFolded), asc(views.primaryAssets.id))
      .limit(limit),

  countPrimaryAssets: async ({ db, views }, search: string) => {
    const [row] = await db.select({ total: count() })
      .from(views.primaryAssets)
      .where(foldedLike(views.primaryAssets.nameFolded, search, 'contains'));
    return Number(row?.total ?? 0);
  },

  findSupportingAssets: ({ db, views }, search: string, limit: number) =>
    db.select({ id: views.supportingAssets.id, name: views.supportingAssets.displayName })
      .from(views.supportingAssets)
      .where(foldedLike(views.supportingAssets.displayNameFolded, search, 'contains'))
      .orderBy(asc(views.supportingAssets.displayNameFolded), asc(views.supportingAssets.id))
      .limit(limit),

  countSupportingAssets: async ({ db, views }, search: string) => {
    const [row] = await db.select({ total: count() })
      .from(views.supportingAssets)
      .where(foldedLike(views.supportingAssets.displayNameFolded, search, 'contains'));
    return Number(row?.total ?? 0);
  },

  findThreats: ({ db, views }, search: string, limit: number) =>
    db.select({ id: views.threatAnalyses.id, name: views.threatAnalyses.name })
      .from(views.threatAnalyses)
      .where(foldedLike(views.threatAnalyses.nameFolded, search, 'contains'))
      .orderBy(asc(views.threatAnalyses.nameFolded), asc(views.threatAnalyses.id))
      .limit(limit),

  countThreats: async ({ db, views }, search: string) => {
    const [row] = await db.select({ total: count() })
      .from(views.threatAnalyses)
      .where(foldedLike(views.threatAnalyses.nameFolded, search, 'contains'));
    return Number(row?.total ?? 0);
  },

  findOrganizations: ({ db, views }, search: string, limit: number) =>
    db.select({ id: views.organizations.id, name: views.organizations.name })
      .from(views.organizations)
      .where(ilike(views.organizations.name, `%${escapeLikePattern(search)}%`))
      .orderBy(asc(views.organizations.name), asc(views.organizations.id))
      .limit(limit),

  countOrganizations: async ({ db, views }, search: string) => {
    const [row] = await db.select({ total: count() })
      .from(views.organizations)
      .where(ilike(views.organizations.name, `%${escapeLikePattern(search)}%`));
    return Number(row?.total ?? 0);
  },

  findControlCapabilities: ({ db, views }, search: string, limit: number) =>
    db.select({ id: views.controlCapabilities.id, name: views.controlCapabilities.name, externalId: views.controlCapabilities.externalId })
      .from(views.controlCapabilities)
      .where(ilike(views.controlCapabilities.name, `%${escapeLikePattern(search)}%`))
      .orderBy(asc(views.controlCapabilities.position), asc(views.controlCapabilities.id))
      .limit(limit),

  countControlCapabilities: async ({ db, views }, search: string) => {
    const [row] = await db.select({ total: count() })
      .from(views.controlCapabilities)
      .where(ilike(views.controlCapabilities.name, `%${escapeLikePattern(search)}%`));
    return Number(row?.total ?? 0);
  },
});
