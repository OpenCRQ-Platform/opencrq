import type { DrizzleDB } from '@app/module';
import { allServiceDefinitions, createServices, PlatformCapability_ManageUsers } from '@app/module';
import { TRPCError } from '@trpc/server';
import type { PublicProcedure } from '../../trpc';
import type { ServedProcedureManifest } from './procedure-manifest';
import { authenticatedProcedure, router, tenantScopedProcedure } from '../../trpc';
import { platformVersion } from '../../utils/platform-version';
import { aleChangeExplainRouter } from './ale-change-explain';
import { attackOutcomesRouter } from './attack-outcomes';
import { assetDependenciesRouter } from './asset-dependencies';
import { capabilitiesRouter } from './capabilities';
import { controlCapabilitiesRouter } from './controls';
import { controlValidationRouter } from './control-validation';
import { countriesRouter } from './countries';
import { dashboardRouter } from './dashboard';
import { financialProfilesRouter } from './financial-profiles';
import { declaredEstateRouter } from './declared-estate';
import { findingScoreRouter } from './finding-score';
import { groupsRouter } from './groups';
import { threatsRouter } from './threats';
import { jobsRouter } from './jobs';
import { lossDriversRouter } from './loss-drivers';
import { membersRouter, platformMembersRouter } from './members';
import { mitreAttackRouter } from './mitre-attack';
import { notificationsRouter } from './notifications';
import { onboardingWizardRouter } from './onboarding-wizard';
import { organizationsRouter } from './organizations';
import { businessValueCategoriesRouter } from './business-value-categories';
import { platformCapabilitiesRouter } from './platform-capabilities';
import { platformGroupsRouter } from './platform-groups';
import { platformRolesRouter } from './platform-roles';
import { primaryAssetsRouter } from './primary-assets';
import { riskScenariosRouter } from './risk-scenarios';
import { rolesRouter } from './roles';
import { scenarioLossEstimatesRouter } from './scenario-loss-estimates';
import { sectorsRouter } from './sectors';
import { supportingAssetsRouter } from './supporting-assets';
import { threatRelevanceSettingsRouter } from './threat-relevance-settings';
import { tenantsRouter } from './tenants';
import { crqIndicatorSettingsRouter } from './crq-indicator-settings';
import { crqIndicatorsRouter } from './crq-indicators';
import { cveRouter } from './cve';
import { cweRouter } from './cwe';
import { fileStorageRouter } from './file-storage';
import { serviceAccountsRouter } from './service-accounts';
import { integrationsRouter } from './integrations/integrations-router';
import { xtmRouter } from './xtm/xtm-router';
import { connectorsRouter } from './connectors/connectors-router';
import { openctiRouter } from './opencti/opencti-router';
import { defaultThreatsRouter } from './default-threats/default-threats-router';
import { drataRouter } from './drata/drata-router';
import { treatmentPlansRouter } from './treatment-plans';
import { budgetReviewsRouter } from './budget-reviews';
import { complianceAssessmentsRouter } from './compliance-assessments';
import { usersRouter } from './users';

import { isTenantReachableOnce } from './tenant-edition-utils';

const instantiateServices = (db: DrizzleDB) => createServices([...allServiceDefinitions], db);

/**
 * Multi-tenancy is an Enterprise Edition feature, so a Community deployment
 * serves a user exactly one tenant. Filtering `getTenants` is not enough: the
 * tenant travels in a client-supplied `x-tenant-id`, so the refusal has to sit
 * on the path every tenant-scoped call takes.
 *
 * Only client origins are narrowed. A connector's tenant is bound server-side
 * to its service account and it can see no other, so there is nothing here for
 * it to claim.
 */
export const createTenantProcedure = (services: ReturnType<typeof instantiateServices>) =>
  tenantScopedProcedure.use(async ({ ctx, next }) => {
    const { origin } = ctx;
    if (origin.type === 'client' && origin.tenantId !== undefined) {
      const { tenantId } = origin;
      const reachable = await isTenantReachableOnce(
        ctx.req,
        tenantId,
        async () => (await services.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
      );
      if (!reachable) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Reaching more than one tenant requires an Enterprise Edition license' });
      }
    }
    return next({ ctx: { ...ctx, services } });
  });

export type TenantProcedure = ReturnType<typeof createTenantProcedure>;

/** For the surface reachable before a tenant is picked: tenants, the acting user, platform groups/roles/capabilities. */
export const createPlatformProcedure = (services: ReturnType<typeof instantiateServices>) =>
  authenticatedProcedure.use(({ ctx, next }) => next({ ctx: { ...ctx, services } }));

export type PlatformProcedure = ReturnType<typeof createPlatformProcedure>;

/**
 * For every procedure that reads or writes the platform group/role tables, other than the caller's
 * own capability checks: the policy layer (`platformSecurityPolicy`) is the floor that no endpoint
 * can forget, but on its own it lets `update`/`delete` fail as a silent 0-row no-op and leaves
 * every read open to any authenticated caller. This middleware is what turns an uncapable call
 * into an explicit `FORBIDDEN`, reads included.
 *
 * A `client` origin becomes a `platform` one: `views.users` would narrow it to the members of the
 * `x-tenant-id` tenant, a header the front still sends while a navigation to the platform scope is
 * pending.
 */
export const createPlatformSecurityProcedure = (services: ReturnType<typeof instantiateServices>) =>
  createPlatformProcedure(services).use(async ({ ctx, next }) => {
    const origin = ctx.origin.type === 'client' ? { type: 'platform' as const, userId: ctx.origin.userId } : ctx.origin;
    const hasManageUsers = await services.withOrigin(origin).platformCapabilities
      .hasPlatformCapability(PlatformCapability_ManageUsers);
    if (!hasManageUsers) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'The MANAGE_USERS platform capability is required' });
    }
    return next({ ctx: { ...ctx, origin, tenantId: undefined } });
  });

export type PlatformSecurityProcedure = ReturnType<typeof createPlatformSecurityProcedure>;

/**
 * `groups`, `roles`, `members`, `serviceAccounts`, `crqIndicatorSettings`, `threatRelevanceSettings`
 * and the mutations of `cwe` only. Their policies never tell the caller it was refused: an uncapable
 * update or delete affects no row, an insert fails as an opaque server error, and
 * `manageSecurityPolicy` answers a read with an empty result. The two settings tables have no read
 * rule at all, since the engine reads them under any member's origin, so this middleware alone
 * closes their reads. It sits on the base procedure, so it answers `FORBIDDEN` before any input
 * is validated.
 */
export const createTenantSecurityProcedure = (services: ReturnType<typeof instantiateServices>) =>
  createTenantProcedure(services).use(async ({ ctx, next }) => {
    const hasManageSecurity = await services.withOrigin(ctx.origin).capabilities.hasManageSecurity();
    if (!hasManageSecurity) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'The MANAGE_SECURITY capability is required' });
    }
    return next({ ctx });
  });

export type TenantSecurityProcedure = ReturnType<typeof createTenantSecurityProcedure>;

/**
 * Anonymous usage telemetry hooks, injected by the feature (see
 * app-router-feature.ts) so the tRPC routers stay engine-free - same pattern
 * as the auth-service session hook. Every hook is optional and counts a
 * feature activation event only (no identity, no content).
 */
export interface AppRouterTelemetry {
  onRiskScenarioCreated?: () => void,
  onCrqSimulationLaunched?: () => void,
  onConnectorSyncLaunched?: () => void,
}

export const appRouter = (
  { publicProcedure }: { publicProcedure: PublicProcedure },
  db: DrizzleDB,
  checkDbConnection: () => boolean = () => true,
  telemetry: AppRouterTelemetry = {},
  procedureManifest: () => ServedProcedureManifest | null = () => null,
) => {
  const services = instantiateServices(db);
  const authProcedure = createTenantProcedure(services);
  const platformProcedure = createPlatformProcedure(services);
  const platformSecurityProcedure = createPlatformSecurityProcedure(services);
  const tenantSecurityProcedure = createTenantSecurityProcedure(services);

  return router({
    health: publicProcedure.meta({ reads: [] }).query(() => ({
      status: checkDbConnection() ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      version: platformVersion(),
    })),
    // Read by an integration that calls procedures by name (XTM One): what this instance serves and
    // the input each accepts, which only the running code knows.
    procedureManifest: authenticatedProcedure.meta({ reads: [] }).query(() => {
      const manifest = procedureManifest();
      if (manifest === null) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The procedure manifest is not available yet' });
      }
      return manifest;
    }),
    users: usersRouter(platformProcedure, platformSecurityProcedure),
    tenants: tenantsRouter(platformProcedure, authProcedure),
    platformCapabilities: platformCapabilitiesRouter(platformProcedure, platformSecurityProcedure),
    businessValueCategories: businessValueCategoriesRouter(authProcedure),
    platformGroups: platformGroupsRouter(platformSecurityProcedure),
    platformRoles: platformRolesRouter(platformSecurityProcedure),
    groups: groupsRouter(tenantSecurityProcedure),
    roles: rolesRouter(tenantSecurityProcedure),
    capabilities: capabilitiesRouter(authProcedure),
    organizations: organizationsRouter(authProcedure),
    onboardingWizard: onboardingWizardRouter(authProcedure),
    members: membersRouter(tenantSecurityProcedure, db),
    platformMembers: platformMembersRouter(platformSecurityProcedure, db),
    jobs: jobsRouter(authProcedure),
    notifications: notificationsRouter(platformProcedure),
    sectors: sectorsRouter(authProcedure),
    countries: countriesRouter(authProcedure),
    attackOutcomes: attackOutcomesRouter(authProcedure),
    threats: threatsRouter(authProcedure),
    riskScenarios: riskScenariosRouter(authProcedure, telemetry),
    lossDrivers: lossDriversRouter(authProcedure),
    scenarioLossEstimates: scenarioLossEstimatesRouter(authProcedure),
    mitreAttack: mitreAttackRouter(authProcedure),
    controlCapabilities: controlCapabilitiesRouter(authProcedure),
    controlValidation: controlValidationRouter(authProcedure),
    primaryAssets: primaryAssetsRouter(authProcedure),
    supportingAssets: supportingAssetsRouter(authProcedure),
    assetDependencies: assetDependenciesRouter(authProcedure),
    threatRelevanceSettings: threatRelevanceSettingsRouter(tenantSecurityProcedure),
    crqIndicatorSettings: crqIndicatorSettingsRouter(tenantSecurityProcedure),
    crqIndicators: crqIndicatorsRouter(authProcedure, telemetry),
    aleChangeExplain: aleChangeExplainRouter(authProcedure),
    dashboard: dashboardRouter(authProcedure),
    financialProfiles: financialProfilesRouter(authProcedure),
    declaredEstate: declaredEstateRouter(authProcedure),
    findingScore: findingScoreRouter(authProcedure),
    cve: cveRouter(authProcedure),
    cwe: cweRouter(authProcedure, tenantSecurityProcedure),
    fileStorage: fileStorageRouter(authProcedure),
    serviceAccounts: serviceAccountsRouter(tenantSecurityProcedure),
    integrations: integrationsRouter(authProcedure),
    connectors: connectorsRouter(authProcedure, telemetry),
    opencti: openctiRouter(authProcedure),
    xtm: xtmRouter(authProcedure),
    defaultThreats: defaultThreatsRouter(authProcedure),
    drata: drataRouter(authProcedure),
    treatmentPlans: treatmentPlansRouter(authProcedure),
    budgetReviews: budgetReviewsRouter(authProcedure),
    complianceAssessments: complianceAssessmentsRouter(authProcedure),
  });
};

export type AppRouter = ReturnType<typeof appRouter>;
