import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { LATERAL_ON } from '../../db/lateral';
import { defineRepository } from '../../registry';
import { latestRunOf } from '../crq-indicators/latest-run';

export const onboardingWizardsRepository = defineRepository({
  /**
   * The oldest wizard of the tenant, with the scope fields its steps are computed from. The tolerance is joined
   * on `organization_id`, unique in that table, so the join never multiplies the row.
   */
  findFirstOnboardingWizard: async ({ db, views }) => {
    const rows = await db
      .select({
        id: views.onboardingWizards.id,
        organizationId: views.onboardingWizards.organizationId,
        sectorId: views.organizations.sectorId,
        countryId: views.organizations.countryId,
        toleranceId: views.organizationRiskTolerances.id,
      })
      .from(views.onboardingWizards)
      .innerJoin(views.organizations, eq(views.organizations.id, views.onboardingWizards.organizationId))
      .leftJoin(
        views.organizationRiskTolerances,
        eq(views.organizationRiskTolerances.organizationId, views.onboardingWizards.organizationId),
      )
      .orderBy(asc(views.onboardingWizards.id))
      .limit(1);
    return rows[0];
  },

  /** The stored financial profile of the risk scope, which `organization_id` makes at most one row. */
  findFinancialProfile: async ({ db, views }, organizationId: string) => {
    const rows = await db.select().from(views.financialProfiles).where(eq(views.financialProfiles.organizationId, organizationId)).limit(1);
    return rows[0];
  },

  /** Whether the tenant has at least one supporting asset: one row is read, the estate is never counted. */
  hasSupportingAsset: async ({ db, views }) => {
    const rows = await db.select({ id: views.supportingAssets.id }).from(views.supportingAssets).limit(1);
    return rows.length > 0;
  },

  /** Whether the tenant has at least one threat, whatever its source: one row is read, the catalogue is never counted. */
  hasThreat: async ({ db, views }) => {
    const rows = await db.select({ id: views.threatAnalyses.id }).from(views.threatAnalyses).limit(1);
    return rows.length > 0;
  },

  /**
   * How many capabilities the catalogue holds, and how many are assessed for the risk scope: the tenant assessed the
   * capability or the scope overrides it, whichever source wrote either (a declared level 0 counts). Both joins are
   * unique per capability, so the row count is the catalogue's.
   */
  countCapabilityAssessments: async ({ db, views }, organizationId: string) => {
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        assessed: sql<number>`(count(*) filter (where ${views.controlCapabilityAssessments.id} is not null or ${views.controlCapabilityScopeOverrides.id} is not null))::int`,
      })
      .from(views.controlCapabilities)
      .leftJoin(views.controlCapabilityAssessments, eq(views.controlCapabilityAssessments.capabilityId, views.controlCapabilities.id))
      .leftJoin(
        views.controlCapabilityScopeOverrides,
        and(
          eq(views.controlCapabilityScopeOverrides.capabilityId, views.controlCapabilities.id),
          eq(views.controlCapabilityScopeOverrides.organizationId, organizationId),
        ),
      );
    return rows[0];
  },

  /** How many kinds of asset the risk scope answered, a "None" included: it is a row of bounds 0 to 0, an unanswered kind has none. */
  countDeclaredEstateKinds: async ({ db, views }, organizationId: string) => {
    const rows = await db
      .select({ answered: sql<number>`count(*)::int` })
      .from(views.declaredEstate)
      .where(eq(views.declaredEstate.organizationId, organizationId));
    return rows[0]?.answered ?? 0;
  },

  /** Whether the risk scope has at least one primary asset. */
  hasPrimaryAsset: async ({ db, views }, organizationId: string) => {
    const rows = await db
      .select({ id: views.primaryAssets.id })
      .from(views.primaryAssets)
      .where(eq(views.primaryAssets.organizationId, organizationId))
      .limit(1);
    return rows.length > 0;
  },

  /**
   * Whether one of the risk scope's scenarios is priced by its latest run, the one its list and the finish screen
   * read: a run with no loss figure quantifies nothing, and a later unpriced run outdates an earlier figure.
   */
  hasComputedRiskScenario: async ({ db, views }, organizationId: string) => {
    const latestRun = latestRunOf({ db, views }, { aleMean: views.crqIndicatorRuns.aleMean });
    const rows = await db
      .select({ id: views.riskScenarios.id })
      .from(views.riskScenarios)
      .innerJoinLateral(latestRun, LATERAL_ON)
      .where(and(eq(views.riskScenarios.organizationId, organizationId), isNotNull(latestRun.aleMean)))
      .limit(1);
    return rows.length > 0;
  },
});
