import type { EventOrigin, SecuredSchema, XtmOneSeedAccount } from '@app/module';
import { assetEvidence,
  assetEvidenceHistory,
  assetEvidenceSources,
  AttackOutcome_Ransomware,
  attackOutcomeTenantIsolationPolicy,
  attackSurfaceTenantIsolationPolicy,
  budgetReviewLineControls,
  budgetReviewLines,
  budgetReviews,
  budgetReviewTenantIsolationPolicy,
  buildCountryRows,
  buildSectorRows,
  complianceAssessmentAnswers,
  complianceAssessments,
  computePertExpectedValue,
  controlCapabilities,
  controlCapabilityAssessmentEvents,
  controlCapabilityAssessments,
  controlCapabilityScopeOverrides,
  controlCapabilityTechniqueOverrides,
  countries,
  createSecuredSchema,
  crqControlWhatIfResults,
  crqIndicatorGroupScores,
  crqIndicatorRunAnnualLosses,
  crqIndicatorRunReachGaps,
  crqIndicatorRuns,
  crqIndicatorRunTenantIsolationPolicy,
  crqIndicatorRunUnplayableObstacles,
  crqIndicatorSettings,
  crqIndicatorTefInputs,
  crqPlanWhatIfResults,
  cve,
  cveTechniqueMapping,
  cveTechniqueResolution,
  deriveSeedId,
  financialProfiles,
  findingMetricDaily,
  findingScoreHistory,
  getSecurityPolicies,
  groupRoles,
  groups,
  groupUsers,
  integrationSettings,
  jobChildTenantIsolationPolicy,
  lossDrivers,
  notifications,
  ONBOARDING_RISK_SCOPE_NAME,
  onboardingWizards,
  organizationRiskTolerances,
  organizations,
  organizationTenantIsolationPolicy,
  primaryAssetBusinessValueCategories,
  primaryAssets,
  primaryAssetTenantIsolationPolicy,
  reportRefMarkingPolicy,
  riskScenarioBusinessValueCategories,
  riskScenarioPrimaryAssets,
  riskScenarioRiskTolerances,
  riskScenarios,
  riskScenarioTenantIsolationPolicy,
  roleCapabilities,
  roles,
  runPlatformSeed,
  scenarioLossEstimates,
  schema,
  SCORE_HISTORY_RETENTION_DAYS,
  sectors,
  serviceAccountGroups,
  serviceAccounts,
  serviceAccountTokens,
  streamObjectMarkingPolicy,
  supportingAssetCriticalityLifts,
  supportingAssetIdentityProperties,
  supportingAssetMachineProperties,
  supportingAssetManualValues,
  supportingAssetRelations,
  supportingAssets,
  supportingAssetSources,
  supportingAssetTags,
  supportingAssetTenantIsolationPolicy,
  supportToPrimaryLinks,
  supportToSupportLinks,
  tags,
  tagSources,
  TECHNIQUE_T1055,
  tefEstimates,
  tenantIsolationPolicy,
  tenants,
  tenantUsers,
  threatAnalyses,
  threatAnalysisAttributions,
  threatAnalysisCves,
  threatAnalysisGoals,
  threatAnalysisLocations,
  threatAnalysisMarkingPolicy,
  threatAnalysisSecondaryMotivations,
  threatAnalysisSectors,
  threatAnalysisTechniques,
  threatAnalysisTenantIsolationPolicy,
  threatMarkingPolicy,
  treatmentPlanMoves,
  treatmentPlans,
  treatmentPlanTenantIsolationPolicy,
  users } from '@app/module';
import { pricedFraction } from '@app/module/client';
import { communityEditionTenantId } from '@app/back/src/features/app-router/tenant-edition-utils';
import { count, eq, getTableName, inArray, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { DEFAULT_TENANT_ID } from '../../helpers/sign-in';

const TEST_ADMIN_EMAIL = 'admin@test.com';
const TEST_ADMIN_PASSWORD = 'TestPass123!';
// Stands for the stack's XTM One: every account it is asked for gets an id derived from its email.
const xtmOneAccounts: Array<XtmOneSeedAccount> = [];
const xtmOneSubject = (email: string) => `xtm-one-${email}`;
const seed = () => runPlatformSeed(db, {
  adminEmail: TEST_ADMIN_EMAIL,
  adminPassword: TEST_ADMIN_PASSWORD,
  xtmOneAccounts: (account) => {
    xtmOneAccounts.push(account);
    return Promise.resolve(xtmOneSubject(account.email));
  },
});
const bandAroundMean = (p10: number | null, mean: number | null, p90: number | null): boolean =>
  p10 !== null && mean !== null && p90 !== null && p10 <= mean && mean <= p90;

describe('Platform Seed', () => {
  // The seed runs the attack run engine on six scenarios, which is the bulk of its wall clock.
  beforeAll(async () => {
    await truncateAllTables(db);
    await seed();
    // An autoanalyze right after truncateAllTables' deletes records the tables as empty with pages,
    // which the planner reads as one row: the policy reads then nested-loop the seeded rows.
    await db.execute(sql`analyze`);
  }, 180_000);

  it('should create all expected users', async () => {
    const allUsers = await db.select().from(users);
    // admin + alice + bob + charlie + eve = 5
    expect(allUsers).toHaveLength(5);

    const admin = allUsers.find((u) => u.email === TEST_ADMIN_EMAIL);
    expect(admin).toBeTruthy();
    expect(admin!.name).toBe('Platform Admin');

    const alice = allUsers.find((u) => u.email === 'alice@example.com');
    expect(alice).toBeTruthy();
    expect(alice!.name).toBe('Alice Martin');
    expect(alice!.title).toBe('Security Analyst');
  });

  it('should tie every user, the admin included, to the XTM One account created for it', async () => {
    const allUsers = await db.select({ email: users.email, xtmSubject: users.xtmSubject }).from(users);
    expect(allUsers.every((user) => user.xtmSubject === xtmOneSubject(user.email))).toBe(true);
  });

  it('should create each XTM One account with the seeded name and password, the admin as an XTM One admin', async () => {
    const allUsers = await db.select({ email: users.email, name: users.name }).from(users);
    expect(xtmOneAccounts.map((account) => account.email).sort()).toEqual(allUsers.map((user) => user.email).sort());
    for (const account of xtmOneAccounts) {
      expect(account.password).toBe(TEST_ADMIN_PASSWORD);
      expect(account.fullName).toBe(allUsers.find((user) => user.email === account.email)?.name);
      expect(account.role).toBe(account.email === TEST_ADMIN_EMAIL ? 'admin' : 'user');
    }
  });

  it('should create tenants with correct users', async () => {
    const allTenants = await db.select().from(tenants);
    expect(allTenants).toHaveLength(3);

    const acme = allTenants.find((t) => t.name === 'Acme Bank');
    const tarnwick = allTenants.find((t) => t.name === 'Tarnwick Industries');
    const freshStart = allTenants.find((t) => t.name === 'Fresh Start');
    expect(acme).toBeTruthy();
    expect(tarnwick).toBeTruthy();
    expect(freshStart).toBeTruthy();

    // Acme: admin + alice + bob + charlie = 4
    const acmeUsers = await db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, acme!.id));
    expect(acmeUsers).toHaveLength(4);

    // Tarnwick: admin + eve = 2
    const tarnwickUsers = await db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, tarnwick!.id));
    expect(tarnwickUsers).toHaveLength(2);

    // Fresh Start: admin only = 1
    const freshStartUsers = await db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, freshStart!.id));
    expect(freshStartUsers).toHaveLength(1);

    // A seeded platform gets the named demo tenants only: the constant default tenant belongs
    // to a hand-onboarded deployment.
    expect(allTenants.find((t) => t.id === DEFAULT_TENANT_ID)).toBeUndefined();
  });

  it('should land the administrator on Acme Bank in Community Edition', async () => {
    const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    const memberships = await db.select({ tenantId: tenantUsers.tenantId }).from(tenantUsers).where(eq(tenantUsers.userId, admin.id));
    const [acme] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, 'Acme Bank'));

    expect(communityEditionTenantId(memberships.map(({ tenantId }) => tenantId))).toBe(acme.id);
  });

  it('should create custom roles with capabilities', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeRoles = await db.select().from(roles).where(eq(roles.tenantId, acme[0].id));

    // Admin (auto-created) + Security Analyst + Viewer = 3
    expect(acmeRoles).toHaveLength(3);

    const securityAnalyst = acmeRoles.find((r) => r.name === 'Security Analyst');
    expect(securityAnalyst).toBeTruthy();

    const securityCaps = await db.select().from(roleCapabilities).where(eq(roleCapabilities.roleId, securityAnalyst!.id));
    expect(securityCaps).toHaveLength(1);

    const viewer = acmeRoles.find((r) => r.name === 'Viewer');
    expect(viewer).toBeTruthy();

    const viewerCaps = await db.select().from(roleCapabilities).where(eq(roleCapabilities.roleId, viewer!.id));
    expect(viewerCaps).toHaveLength(0);
  });

  it('should create custom groups with users and roles', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeGroups = await db.select().from(groups).where(eq(groups.tenantId, acme[0].id));

    // Admin (auto-created) + Security Team + Viewers + Connectors = 4
    expect(acmeGroups).toHaveLength(4);

    const securityTeam = acmeGroups.find((g) => g.name === 'Security Team');
    expect(securityTeam).toBeTruthy();

    const securityMembers = await db.select().from(groupUsers).where(eq(groupUsers.groupId, securityTeam!.id));
    expect(securityMembers).toHaveLength(1); // Alice

    const securityRoles = await db.select().from(groupRoles).where(eq(groupRoles.groupId, securityTeam!.id));
    expect(securityRoles).toHaveLength(1); // Security Analyst role
  });

  it('should create organizations', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    expect(acmeOrgs).toHaveLength(5);

    const acmeBank = acmeOrgs.find((o) => o.name === 'Acme Bank');
    expect(acmeBank).toBeTruthy();

    const acmeEurope = acmeOrgs.find((o) => o.name === 'Acme Bank Europe');
    expect(acmeEurope).toBeTruthy();

    const acmeWealth = acmeOrgs.find((o) => o.name === 'Acme Wealth Management');
    expect(acmeWealth).toBeTruthy();

    // Tarnwick has 1 organization
    const tarnwick = await db.select().from(tenants).where(eq(tenants.name, 'Tarnwick Industries'));
    const tarnwickOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, tarnwick[0].id));
    expect(tarnwickOrgs).toHaveLength(1);
    expect(tarnwickOrgs[0].name).toBe('Tarnwick Industries');

    const freshStart = await db.select().from(tenants).where(eq(tenants.name, 'Fresh Start'));
    // Fresh Start is born as a tenant created from the administration: its first scope and its Get started wizard.
    const freshStartOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, freshStart[0].id));
    expect(freshStartOrgs.map((o) => o.name)).toEqual([ONBOARDING_RISK_SCOPE_NAME]);
    const freshStartWizards = await db.select().from(onboardingWizards).where(eq(onboardingWizards.tenantId, freshStart[0].id));
    expect(freshStartWizards.map((w) => w.organizationId)).toEqual([freshStartOrgs[0].id]);
  });

  it('should seed a fully-answered financial profile for Acme Bank', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeBank = acmeOrgs.find((o) => o.name === 'Acme Bank')!;

    const profiles = await db.select().from(financialProfiles).where(eq(financialProfiles.organizationId, acmeBank.id));
    expect(profiles).toHaveLength(1);
    const profile = profiles[0];

    expect(profile.tenantId).toBe(acme[0].id);
    // Both severity gates open, exercising the full question set in manual e2e testing.
    expect(profile.recordsHeldGate).toBe(true);
    expect(profile.outOfBandVerificationGate).toBe(true);
    expect(profile.ransomPaymentPosture).toBe(true);
    expect(profile.annualRevenue).toBe(3_200_000_000);
    expect(profile.ransomPaymentCeiling).toBe(1_900_000);
    expect(profile.coefficientSetVersion).not.toBeNull();

    // Every answer column the questionnaire exposes is filled — nothing left for manual e2e to
    // stumble into a blank card.
    const { id: _id, tenantId: _tenantId, organizationId: _organizationId, updatedAt: _updatedAt, coefficientSetVersion: _coefficientSetVersion, ...answers } = profile;
    expect(Object.values(answers).every((value) => value !== null)).toBe(true);
  });

  it('should provision tenant-scoped countries and sectors for every tenant', async () => {
    const allTenants = await db.select().from(tenants);
    const allCountries = await db.select().from(countries);
    const allSectors = await db.select().from(sectors);

    // Each tenant gets the full OpenCTI reference set, with deterministic per-tenant ids.
    expect(allCountries).toHaveLength(buildCountryRows('dummyTenantId').length * allTenants.length);
    expect(allSectors).toHaveLength(buildSectorRows('dummyTenantId').length * allTenants.length);
  });

  it('should link demo organizations to their tenant-scoped country and sector', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeBank = acmeOrgs.find((o) => o.name === 'Acme Bank');
    expect(acmeBank?.countryId).toBeTruthy();
    expect(acmeBank?.sectorId).toBeTruthy();

    // The referenced country row exists, is scoped to the same tenant, and is the US.
    const usCountry = await db.select().from(countries).where(eq(countries.id, acmeBank!.countryId!));
    expect(usCountry).toHaveLength(1);
    expect(usCountry[0].tenantId).toBe(acme[0].id);
    expect(usCountry[0].isoAlpha3).toBe('USA');
  });

  it('should create risk scenarios across organizations', async () => {
    const allRiskScenarios = await db.select().from(riskScenarios);
    expect(allRiskScenarios).toHaveLength(8); // 7 Acme + 1 Tarnwick

    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeOrgIds = new Set(acmeOrgs.map((o) => o.id));
    const acmeScenarios = allRiskScenarios.filter((s) => acmeOrgIds.has(s.organizationId));
    expect(acmeScenarios).toHaveLength(7);
    // Two organizations carry a second scenario naming the same attack outcome, which is what the
    // outcome-scoped exposure ledger reads.
    expect(new Set(acmeScenarios.map((s) => s.organizationId)).size).toBe(5);

    const tarnwick = await db.select().from(tenants).where(eq(tenants.name, 'Tarnwick Industries'));
    const tarnwickOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, tarnwick[0].id));
    const tarnwickOrgIds = new Set(tarnwickOrgs.map((o) => o.id));
    const tarnwickScenarios = allRiskScenarios.filter((s) => tarnwickOrgIds.has(s.organizationId));
    expect(tarnwickScenarios).toHaveLength(1);

    for (const scenario of allRiskScenarios) {
      expect(scenario.organizationId).toBeTruthy();
    }
  });

  it('should price every scenario with loss estimates', async () => {
    const allEstimates = await db.select().from(scenarioLossEstimates);
    const manualEstimates = allEstimates.filter((estimate) => estimate.provenance === 'manual');
    expect(manualEstimates).toHaveLength(19); // 16 Acme + 3 Tarnwick

    const allRiskScenarios = await db.select().from(riskScenarios);
    // A scenario with no complete estimate prices at zero and makes the whole CRQ chain read 0,
    // which is exactly what the demo data exists to avoid.
    for (const scenario of allRiskScenarios) {
      const priced = allEstimates.filter((estimate) => estimate.riskScenarioId === scenario.id
        && estimate.minValue !== null && estimate.likelyValue !== null && estimate.maxValue !== null);
      expect(priced.length).toBeGreaterThan(0);
      expect(priced.every((estimate) => estimate.likelyValue! > 0)).toBe(true);
    }
  });

  it('should price a questionnaire-derived estimate on every scenario whose organization has a financial profile, and none elsewhere', async () => {
    const profiledOrganizationIds = new Set(
      (await db.select().from(financialProfiles)).map((profile) => profile.organizationId),
    );
    const allRiskScenarios = await db.select().from(riskScenarios);
    const allEstimates = await db.select().from(scenarioLossEstimates);

    for (const scenario of allRiskScenarios) {
      const questionnaireEstimates = allEstimates.filter((estimate) => estimate.riskScenarioId === scenario.id
        && estimate.provenance === 'questionnaire');
      if (profiledOrganizationIds.has(scenario.organizationId)) {
        expect(questionnaireEstimates.length).toBeGreaterThan(0);
      } else {
        expect(questionnaireEstimates).toHaveLength(0);
      }
    }
  });

  it('should price the reference CRQ run on every estimate of its scenario, any provenance', async () => {
    // The history is copied from this run, so an estimate derived after it was built leaves the
    // whole seeded lifeline one step behind the first real simulation.
    const allRiskScenarios = await db.select().from(riskScenarios);
    const allRuns = await db.select().from(crqIndicatorRuns);
    const allEstimates = await db.select().from(scenarioLossEstimates);

    for (const scenario of allRiskScenarios) {
      const [referenceRun] = allRuns
        .filter((run) => run.riskScenarioId === scenario.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (!referenceRun || referenceRun.magnitudeMean === null) {
        continue;
      }

      const expectedMagnitude = allEstimates
        .filter((estimate) => estimate.riskScenarioId === scenario.id
          && estimate.minValue !== null && estimate.likelyValue !== null && estimate.maxValue !== null
          // The simulation reads `validOnly` estimates, which also drop an unordered triplet.
          && estimate.minValue <= estimate.likelyValue && estimate.likelyValue <= estimate.maxValue)
        .reduce((total, estimate) => total + computePertExpectedValue(estimate.minValue!, estimate.likelyValue!, estimate.maxValue!), 0);

      expect(Math.abs(referenceRun.magnitudeMean - expectedMagnitude) / expectedMagnitude).toBeLessThan(1e-9);
    }
  });

  it('should leave no recompute pending and nothing for the boot backfill to derive', async () => {
    // A driver the derivation emits with no row on file is what the boot backfill writes, and that
    // write books a real simulation over the seeded history. Read through the dry derivation so the
    // shared fixture stays untouched.
    const services = createTestServices(db);
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme.id));
    const acmeOrgIds = new Set(acmeOrgs.map((org) => org.id));
    const acmeScenarios = (await db.select().from(riskScenarios)).filter((scenario) => acmeOrgIds.has(scenario.organizationId));
    const allEstimates = await db.select().from(scenarioLossEstimates);

    const acmeServices = services.withOrigin({ type: 'client', userId: admin.id, tenantId: acme.id });
    for (const scenario of acmeScenarios) {
      const summary = await acmeServices.scenarioLossEstimates.getFinancialSummary(scenario.id);
      expect(summary.recomputePending).toBe(false);

      const onFile = new Set(allEstimates
        .filter((estimate) => estimate.riskScenarioId === scenario.id)
        .map((estimate) => estimate.lossDriverId));
      const derivable = await acmeServices.scenarioLossEstimates.getAutomaticEstimates(scenario.id);
      expect(derivable.filter((estimate) => !onFile.has(estimate.lossDriverId))).toEqual([]);
    }
  });

  it('should price every scenario on drivers the activation matrix recommends, bar one deliberate departure', async () => {
    // The demonstration data is what a prospect sees first: a scenario contradicting the model would
    // put the "not recommended" warning on the product's own showcase. Exactly one estimate is kept
    // outside the recommendation, so the section it feeds is visible on real data.
    const DELIBERATE_DEPARTURE = { scenario: 'Ransomware on Trade Finance Platform', driver: 'Notification & call handling' };

    const priced = await db
      .select({
        scenarioName: riskScenarios.name,
        driverName: lossDrivers.name,
        recommended: sql<boolean>`EXISTS (
          SELECT 1
          FROM loss_driver_activations lda
          JOIN risk_scenario_business_value_categories rsbvc ON rsbvc.risk_scenario_id = ${riskScenarios.id}
          WHERE lda.attack_outcome_id = ${riskScenarios.attackOutcomeId}
            AND lda.business_value_category_id = rsbvc.business_value_category_id
            AND lda.loss_driver_id = ${scenarioLossEstimates.lossDriverId}
        )`,
      })
      .from(scenarioLossEstimates)
      .innerJoin(riskScenarios, eq(riskScenarios.id, scenarioLossEstimates.riskScenarioId))
      .innerJoin(lossDrivers, eq(lossDrivers.id, scenarioLossEstimates.lossDriverId));

    const departures = priced
      .filter((row) => !row.recommended)
      .map((row) => ({ scenario: row.scenarioName, driver: row.driverName }));

    expect(departures).toEqual([DELIBERATE_DEPARTURE]);
  });

  it('should create supporting assets', async () => {
    const allSupportingAssets = await db.select().from(supportingAssets);
    expect(allSupportingAssets.length).toBeGreaterThan(0);
  });

  it('should create primary assets across organizations', async () => {
    const allPrimaryAssets = await db.select().from(primaryAssets);
    expect(allPrimaryAssets).toHaveLength(11); // 9 Acme (across 5 orgs) + 2 Tarnwick

    // Verify Acme assets span multiple organizations
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeOrgIds = new Set(acmeOrgs.map((o) => o.id));
    const acmeAssets = allPrimaryAssets.filter((a) => acmeOrgIds.has(a.organizationId));
    expect(acmeAssets).toHaveLength(9);

    const businessValueAssignments = await db.select().from(primaryAssetBusinessValueCategories);
    expect(businessValueAssignments).toHaveLength(24); // 18 Acme + 6 Tarnwick
    expect(new Set(businessValueAssignments.map((assignment) => assignment.primaryAssetId)).size).toBe(11);
  });

  it('reports the Core Banking host from two connectors under one canonical asset', async () => {
    const [coreBanking] = await db.select().from(supportingAssets)
      .where(eq(supportingAssets.name, 'Core Banking System (Temenos T24)'));
    const coreBankingSources = await db.select().from(supportingAssetSources)
      .where(eq(supportingAssetSources.supportingAssetId, coreBanking.id));

    expect(coreBankingSources).toHaveLength(2);
    const connectors = await db.select().from(integrationSettings);
    const sourceNames = coreBankingSources
      .map((s) => connectors.find((c) => c.id === s.connectorId)?.source)
      .sort();
    expect(sourceNames).toEqual(['microsoft_graph', 'openaev']);
    // What makes them one asset rather than two, and what the matcher would join them on again.
    const machineProperties = await db.select().from(supportingAssetMachineProperties)
      .where(inArray(supportingAssetMachineProperties.supportingAssetSourceId, coreBankingSources.map((s) => s.id)));
    expect(new Set(machineProperties.map((p) => p.macAddresses?.join(','))).size).toBe(1);
  });

  it('keys a seeded Entra identity by its object id and an Active Directory-only one by its SID, as the connector does', async () => {
    const rows = await db.select({
      sourceAssetId: supportingAssetSources.sourceAssetId,
      directoryObjectId: supportingAssetIdentityProperties.directoryObjectId,
      identityProvider: supportingAssetIdentityProperties.identityProvider,
    })
      .from(supportingAssetIdentityProperties)
      .innerJoin(supportingAssetSources, eq(supportingAssetSources.id, supportingAssetIdentityProperties.supportingAssetSourceId));

    for (const row of rows) {
      if (row.directoryObjectId === null) {
        expect(row.sourceAssetId).toMatch(/^sid:S-1-5-21-/);
      } else {
        expect(row.directoryObjectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(row.sourceAssetId).toBe(row.directoryObjectId);
      }
    }
    expect(rows.some((row) => row.directoryObjectId !== null)).toBe(true);
    expect(rows.some((row) => row.directoryObjectId === null)).toBe(true);
  });

  it('pins one identity\'s criticality below what the connector reported, so the pin visibly wins', async () => {
    const [pinned] = await db.select().from(supportingAssets).where(eq(supportingAssets.name, 'Nadia Fournier'));
    const manualValues = await db.select().from(supportingAssetManualValues)
      .where(eq(supportingAssetManualValues.supportingAssetId, pinned.id));
    expect(manualValues.map(({ attribute, value }) => ({ attribute, value })))
      .toEqual([{ attribute: 'criticality', value: 'medium' }]);
    expect(manualValues[0].setByUserId).not.toBeNull();
    expect(pinned.criticality).toBe('medium');
    const [source] = await db.select().from(supportingAssetSources)
      .where(eq(supportingAssetSources.supportingAssetId, pinned.id));
    expect(source.reportedCriticality).toBe('very_high');
  });

  it('seeds an account only the logon events name, with its SID, domain and name and nothing else', async () => {
    const [logonOnly] = await db.select().from(supportingAssets).where(eq(supportingAssets.name, 'acme\\svc_backup'));
    const [source] = await db.select().from(supportingAssetSources)
      .where(eq(supportingAssetSources.supportingAssetId, logonOnly.id));
    expect(source.sourceAssetId).toMatch(/^sid:S-1-5-21-/);
    const [properties] = await db.select().from(supportingAssetIdentityProperties)
      .where(eq(supportingAssetIdentityProperties.supportingAssetSourceId, source.id));
    expect(properties).toMatchObject({ accountDomain: 'acme', accountName: 'svc_backup', directoryObjectId: null, userPrincipalName: null });
  });

  it('should name a primary user for five workstations, one shared by two users, from each source, on the identifiers the connector joins on', async () => {
    const relations = await db.select().from(supportingAssetRelations);
    expect(relations).toHaveLength(6);
    expect(new Set(relations.map((relation) => relation.toAssetId)).size).toBe(5);
    expect(new Set(relations.map((relation) => relation.source))).toEqual(new Set(['entra_registered_owner', 'intune_primary_user']));
    for (const relation of relations) {
      const [identity] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, relation.fromAssetId));
      expect(identity.sourceAssetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const [device] = await db.select({ directoryDeviceId: supportingAssetMachineProperties.directoryDeviceId, macAddresses: supportingAssetMachineProperties.macAddresses })
        .from(supportingAssetMachineProperties)
        .innerJoin(supportingAssetSources, eq(supportingAssetSources.id, supportingAssetMachineProperties.supportingAssetSourceId))
        .where(eq(supportingAssetSources.supportingAssetId, relation.toAssetId));
      if (relation.source === 'entra_registered_owner') {
        expect(device.directoryDeviceId).not.toBeNull();
      } else {
        expect(device.directoryDeviceId === null && (device.macAddresses ?? []).length > 0).toBe(true);
      }
    }
  });

  it('should rate hosts by their rule and lift workstations from the band in effect of their primary user', async () => {
    const band = async (name: string) => {
      const [asset] = await db.select().from(supportingAssets).where(eq(supportingAssets.name, name));
      const [source] = await db.select().from(supportingAssetSources).where(eq(supportingAssetSources.supportingAssetId, asset.id));
      const [lift] = await db.select().from(supportingAssetCriticalityLifts).where(eq(supportingAssetCriticalityLifts.supportingAssetId, asset.id));
      return { criticality: asset.criticality, rule: source.reportedCriticalityRule, lift: lift?.criticality ?? null };
    };

    expect(await band('ACME-DC-01')).toEqual({ criticality: 'very_high', rule: 'domain_controller', lift: null });
    expect(await band('ACME-BKP-01')).toEqual({ criticality: 'high', rule: 'backup', lift: null });
    expect(await band('ACME-SRV-0412')).toEqual({ criticality: 'high', rule: 'asset_value_high', lift: null });
    expect(await band('ACME-SRV-0418')).toEqual({ criticality: 'unknown', rule: null, lift: null });
    expect(await band('ACME-SQL-01')).toEqual({ criticality: 'unknown', rule: null, lift: null });
    expect(await band('ACME-LT-0219')).toEqual({ criticality: 'high', rule: null, lift: 'high' });
    expect(await band('ACME-LT-0233')).toEqual({ criticality: 'medium', rule: null, lift: 'medium' });
    // Nadia Fournier reports very_high but is pinned medium by hand, which lifts nothing.
    expect(await band('ACME-LT-0142')).toEqual({ criticality: 'unknown', rule: null, lift: null });
    expect(await band('ACME-MB-0087')).toEqual({ criticality: 'unknown', rule: null, lift: null });
  });

  it('leaves one hand-made identity with no source, and so no property row', async () => {
    const [sparse] = await db.select().from(supportingAssets).where(eq(supportingAssets.name, 'External auditor'));
    expect(sparse.categoryId).toBe('identity');
    expect(await db.select().from(supportingAssetSources)
      .where(eq(supportingAssetSources.supportingAssetId, sparse.id))).toEqual([]);
  });

  // An observed asset's subcategory is re-derived from its sources, so one no source reports and no
  // pin holds would read "no source reports it" on the detail and vanish at the next re-derive.
  it('backs every observed asset\'s subcategory with a source that reports it or a pin', async () => {
    const sources = await db.select().from(supportingAssetSources);
    const pins = await db.select().from(supportingAssetManualValues).where(eq(supportingAssetManualValues.attribute, 'subcategory'));
    const unbacked = (await db.select().from(supportingAssets))
      .filter((asset) => asset.subcategoryId !== null && sources.some((s) => s.supportingAssetId === asset.id))
      .filter((asset) => !sources.some((s) => s.supportingAssetId === asset.id && s.reportedSubcategoryId === asset.subcategoryId)
        && !pins.some((pin) => pin.supportingAssetId === asset.id && pin.value === asset.subcategoryId))
      .map((asset) => asset.name);
    expect(unbacked).toEqual([]);
  });

  it('should create supporting assets with type assignments', async () => {
    const allSupportingAssets = await db.select().from(supportingAssets);
    expect(allSupportingAssets).toHaveLength(43); // 40 Acme (20 plus 8 identities, 1 known from logons, 1 with no property row, 5 workstations with a primary user, 5 servers Defender rates) + 3 Tarnwick

    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeAssets = allSupportingAssets.filter((a) => a.tenantId === acme[0].id);
    expect(acmeAssets).toHaveLength(40);

    const internetExposed = acmeAssets.filter((a) => a.exposure === 'internet_facing');
    expect(internetExposed.length).toBeGreaterThanOrEqual(4); // portal, mobile, card auth, firewall, load balancer
  });

  it('should mark every seeded asset with a manual `seed` tag of its own tenant', async () => {
    const allSupportingAssets = await db.select().from(supportingAssets);
    const seedTags = await db.select().from(tags).where(eq(tags.name, 'seed'));
    expect(new Set(seedTags.map((tag) => tag.tenantId)))
      .toEqual(new Set(allSupportingAssets.map((asset) => asset.tenantId)));

    const seedTagIdByTenantId = new Map(seedTags.map((tag) => [tag.tenantId, tag.id]));
    const links = await db.select().from(supportingAssetTags)
      .where(inArray(supportingAssetTags.tagId, seedTags.map((tag) => tag.id)));
    expect(new Set(links.map((link) => `${link.supportingAssetId}:${link.tagId}`)))
      .toEqual(new Set(allSupportingAssets.map((asset) => `${asset.id}:${seedTagIdByTenantId.get(asset.tenantId)}`)));

    // What makes the mark survive a real sync: only a connector's own links are replaced by its resync.
    const seedTagSources = await db.select().from(tagSources)
      .where(inArray(tagSources.tagId, seedTags.map((tag) => tag.id)));
    expect(seedTagSources.every((source) => source.connectorId === null && source.sourceTagId === null)).toBe(true);
    expect(links.every((link) => link.connectorId === null)).toBe(true);
  });

  it('should seed a manual `PII` tag merged into `pii`, linked to an asset that does not carry `pii`', async () => {
    const [pii] = await db.select().from(tags).where(eq(tags.name, 'pii'));
    const [merged] = await db.select().from(tags).where(eq(tags.name, 'PII'));
    expect(merged.mergedIntoTagId).toBe(pii.id);
    expect(merged.mergedAt).toBeInstanceOf(Date);

    const sources = await db.select().from(tagSources).where(eq(tagSources.tagId, merged.id));
    expect(sources.every((source) => source.connectorId === null && source.sourceTagId === null)).toBe(true);
    expect(sources).not.toHaveLength(0);

    const mergedLinks = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.tagId, merged.id));
    const piiLinks = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.tagId, pii.id));
    expect(mergedLinks).not.toHaveLength(0);
    expect(mergedLinks.every((link) => link.connectorId === null)).toBe(true);
    expect(mergedLinks.some((link) => piiLinks.some((piiLink) => piiLink.supportingAssetId === link.supportingAssetId))).toBe(false);
  });

  it('should give every scenario the loss scope its primary assets hold', async () => {
    const scopes = await db.select().from(riskScenarioBusinessValueCategories);
    const allScenarios = await db.select().from(riskScenarios);

    const scopeByScenario = new Map<string, Set<string>>();
    for (const row of scopes) {
      scopeByScenario.set(row.riskScenarioId, (scopeByScenario.get(row.riskScenarioId) ?? new Set()).add(row.businessValueCategoryId));
    }

    const assetLinks = await db.select().from(riskScenarioPrimaryAssets);
    const assetResources = await db.select().from(primaryAssetBusinessValueCategories);
    const resourcesByAsset = new Map<string, Array<string>>();
    for (const row of assetResources) {
      resourcesByAsset.set(row.primaryAssetId, [...resourcesByAsset.get(row.primaryAssetId) ?? [], row.businessValueCategoryId]);
    }

    const expectedByScenario = new Map<string, Set<string>>();
    for (const link of assetLinks) {
      const scope = expectedByScenario.get(link.riskScenarioId) ?? new Set<string>();
      for (const categoryId of resourcesByAsset.get(link.primaryAssetId) ?? []) {
        scope.add(categoryId);
      }
      expectedByScenario.set(link.riskScenarioId, scope);
    }

    for (const scenario of allScenarios) {
      expect(scopeByScenario.get(scenario.id) ?? new Set()).toEqual(expectedByScenario.get(scenario.id) ?? new Set());
    }
  });

  it('should create asset dependency links', async () => {
    // Support-to-Primary links: 14
    const allS2PLinks = await db.select().from(supportToPrimaryLinks);
    expect(allS2PLinks).toHaveLength(14);
    expect(allS2PLinks.filter((link) => !link.roles.includes('unknown')).length).toBeGreaterThan(0);

    // Support-to-Support links: 14
    const allS2SLinks = await db.select().from(supportToSupportLinks);
    expect(allS2SLinks).toHaveLength(14);
  });

  it('should create notifications for various users', async () => {
    const allNotifs = await db.select().from(notifications);
    expect(allNotifs).toHaveLength(5);

    const readNotifs = allNotifs.filter((n) => n.read);
    const unreadNotifs = allNotifs.filter((n) => !n.read);
    expect(readNotifs.length).toBeGreaterThan(0);
    expect(unreadNotifs.length).toBeGreaterThan(0);
  });

  it('should create service accounts with tokens and group assignments', async () => {
    // 1 SA per tenant that has connectors (Acme + Tarnwick)
    const allAccounts = await db.select().from(serviceAccounts);
    expect(allAccounts).toHaveLength(2);
    expect(allAccounts.every((sa) => sa.name === 'Sync Bot')).toBe(true);

    const allTokens = await db.select().from(serviceAccountTokens);
    expect(allTokens).toHaveLength(2);

    // Each SA is linked to its tenant's Connectors group
    const allLinks = await db.select().from(serviceAccountGroups);
    expect(allLinks).toHaveLength(2);
  });

  it('should create realistic CVEs for Acme only', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const allCves = await db.select().from(cve);
    expect(allCves).toHaveLength(60);
    expect(allCves.every((c) => c.tenantId === acme[0].id)).toBe(true);

    const log4shell = allCves.find((c) => c.cveId === 'CVE-2021-44228');
    expect(log4shell).toBeTruthy();
    expect(log4shell!.cvss).toBe(10);
    expect(log4shell!.kev).toBe(true);
    expect(log4shell!.epss).toBeGreaterThan(0.9);
    expect(log4shell!.cvssVector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H');
    expect(log4shell!.cwe).toEqual(['CWE-917', 'CWE-502', 'CWE-20']);

    const kevCves = allCves.filter((c) => c.kev);
    expect(kevCves.length).toBeGreaterThanOrEqual(15);

    // The seed carries the unresolved case too: absent means NULL, never an empty list.
    const withoutWeakness = allCves.filter((c) => c.cwe === null);
    expect(withoutWeakness).toHaveLength(1);
    expect(allCves.every((c) => c.cwe === null || c.cwe.length > 0)).toBe(true);
    expect(allCves.filter((c) => c.cvssVector !== null)).toHaveLength(59);
  });

  it('should ingest threats with dated children', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const analyses = await db.select().from(threatAnalyses);
    expect(analyses).toHaveLength(17);
    expect(analyses.filter((a) => a.entityType === 'threat-actor').map((a) => a.name)).toEqual(['Kraken Syndicate']);
    expect(analyses.filter((a) => a.entityType === 'campaign').map((a) => a.name).sort())
      .toEqual(['Operation Gilded Checkout', 'Operation Ledger Lure']);
    const campaign = analyses.find((a) => a.name === 'Operation Ledger Lure')!;
    const campaignAttributions = await db.select().from(threatAnalysisAttributions).where(eq(threatAnalysisAttributions.analysisId, campaign.id));
    expect(campaignAttributions.map((a) => a.targetStixId)).toEqual([analyses.find((a) => a.name === 'Scattered Spider')!.stixId]);
    expect(analyses.every((a) => a.tenantId === acme[0].id)).toBe(true);
    // The seed owns no door of its own: every demo actor came through the import parser.
    expect(new Set(analyses.map((a) => a.kind))).toEqual(new Set(['stix-import']));

    const saltTyphoon = analyses.find((a) => a.name === 'Salt Typhoon');
    expect(saltTyphoon).toBeTruthy();
    expect(saltTyphoon!.mitreGroupId).toBe('G1045');

    const techniques = await db.select().from(threatAnalysisTechniques)
      .where(eq(threatAnalysisTechniques.analysisId, saltTyphoon!.id));
    expect(techniques).toHaveLength(8);
    expect(techniques.some((t) => t.mitreExternalId === 'T1557')).toBe(true);
    expect(techniques.every((t) => t.relCreated !== null)).toBe(true);
    expect(techniques.every((t) => t.stixRelationId.length > 0)).toBe(true);

    const locations = await db.select().from(threatAnalysisLocations)
      .where(eq(threatAnalysisLocations.analysisId, saltTyphoon!.id));
    expect(locations).toHaveLength(4);
    expect(locations.some((l) => l.country === 'France')).toBe(true);
    // The demo actor carries the whole provenance surface: two producers claiming the same
    // country through distinct relationships, and one inferred claim.
    expect(new Set(locations.map((l) => l.producerName))).toEqual(new Set(['Demo Intel Feed', 'Partner Intel Feed']));
    expect(locations.filter((l) => l.country === 'United States of America')).toHaveLength(2);
    expect(locations.filter((l) => l.isInferred)).toHaveLength(1);

    const sectorRows = await db.select().from(threatAnalysisSectors)
      .where(eq(threatAnalysisSectors.analysisId, saltTyphoon!.id));
    expect(sectorRows.some((s) => s.name === 'Finance')).toBe(true);

    // CVE targeting windows need a start anchor or the activity heatmap silently skips them.
    const cveLinks = await db.select().from(threatAnalysisCves);
    expect(cveLinks.length).toBeGreaterThan(0);
    expect(cveLinks.every((l) => l.relStartTime !== null || l.relCreated !== null)).toBe(true);
  });

  it('should date an undated intrusion set by the campaign attributed to it', async () => {
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    await createTestServices(db)
      .withOrigin({ type: 'job', tenantId: acme.id, jobKind: 'threat-activity-recompute', interactive: false })
      .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
    const analyses = await db.select().from(threatAnalyses);
    const fin7 = analyses.find((a) => a.name === 'FIN7')!;
    const campaign = analyses.find((a) => a.name === 'Operation Gilded Checkout')!;

    expect(fin7.lastSeen).toBeNull();
    expect(fin7.firstSeen).toBeNull();
    expect(fin7.lastObservedAt).toEqual(campaign.lastSeen);
  });

  // The declared motivation and goal cases the demo tenant must exercise on the actor page: a
  // secondary motivation beside the primary one, a goal naming no outcome, a free-text goal, an actor
  // declaring a primary motivation alone, and an actor with no stated motivation and a single goal.
  it('should ingest the declared motivation and goal cases the demo tenant exercises', async () => {
    const analyses = await db.select().from(threatAnalyses);
    const apt29 = analyses.find((a) => a.name === 'APT29 (Cozy Bear)');
    const lazarus = analyses.find((a) => a.name === 'Lazarus Group');
    const sandworm = analyses.find((a) => a.name === 'Sandworm Team');
    const phantomLocker = analyses.find((a) => a.name === 'PhantomLocker');
    const uncDrift = analyses.find((a) => a.name === 'UNC-Drift');
    expect(apt29).toBeTruthy();
    expect(lazarus).toBeTruthy();
    expect(sandworm).toBeTruthy();
    expect(phantomLocker).toBeTruthy();
    expect(uncDrift).toBeTruthy();

    // A secondary motivation declared alongside the primary one.
    expect(apt29!.primaryMotivation).toBe('dominance');
    const apt29SecondaryMotivations = await db.select().from(threatAnalysisSecondaryMotivations)
      .where(eq(threatAnalysisSecondaryMotivations.analysisId, apt29!.id));
    expect(apt29SecondaryMotivations.map((row) => row.value)).toEqual(['espionage']);

    // A goal that names no outcome.
    const lazarusGoals = await db.select().from(threatAnalysisGoals)
      .where(eq(threatAnalysisGoals.analysisId, lazarus!.id));
    expect(lazarusGoals.map((row) => row.value)).toEqual(['ideology']);

    // Free text a source would plausibly write.
    const sandwormGoals = await db.select().from(threatAnalysisGoals)
      .where(eq(threatAnalysisGoals.analysisId, sandworm!.id));
    expect(sandwormGoals.map((row) => row.value)).toEqual(['Disrupt regional power grid operations for as long as possible']);

    // A primary motivation alone — no location, no sector, no technique claim.
    expect(phantomLocker!.primaryMotivation).toBe('ransomware');
    const phantomLockerLocations = await db.select().from(threatAnalysisLocations)
      .where(eq(threatAnalysisLocations.analysisId, phantomLocker!.id));
    const phantomLockerSectors = await db.select().from(threatAnalysisSectors)
      .where(eq(threatAnalysisSectors.analysisId, phantomLocker!.id));
    const phantomLockerTechniques = await db.select().from(threatAnalysisTechniques)
      .where(eq(threatAnalysisTechniques.analysisId, phantomLocker!.id));
    expect(phantomLockerLocations).toHaveLength(0);
    expect(phantomLockerSectors).toHaveLength(0);
    expect(phantomLockerTechniques).toHaveLength(0);

    // No stated primary/secondary motivation — a `data breach` goal alone.
    expect(uncDrift!.primaryMotivation).toBeNull();
    const uncDriftSecondaryMotivations = await db.select().from(threatAnalysisSecondaryMotivations)
      .where(eq(threatAnalysisSecondaryMotivations.analysisId, uncDrift!.id));
    const uncDriftGoals = await db.select().from(threatAnalysisGoals)
      .where(eq(threatAnalysisGoals.analysisId, uncDrift!.id));
    expect(uncDriftSecondaryMotivations).toHaveLength(0);
    expect(uncDriftGoals.map((row) => row.value)).toEqual(['data breach']);
  });

  // Neither actor targets an Acme organization's country or sector: the outcome model alone lists them
  // on Ransomware, PhantomLocker from its declared motivation, HollowTide from its T1486 claim.
  it('should list on Ransomware the seeded ransomware actors that target no Acme organization', async () => {
    const services = createTestServices(db);
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    const origin = { type: 'client', userId: admin.id, tenantId: acme.id } as const;

    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme.id));
    const { items } = await services.withOrigin(origin).threatAnalyses.getRelevantForScenario({
      attackOutcomeId: deriveSeedId(acme.id, AttackOutcome_Ransomware),
      countryIds: [...new Set(acmeOrgs.map((org) => org.countryId).filter((id) => id !== null))],
      sectorIds: [...new Set(acmeOrgs.map((org) => org.sectorId).filter((id) => id !== null))],
    });
    const listed = new Map(items.map((item) => [item.name, item]));

    for (const name of ['PhantomLocker', 'HollowTide']) {
      const actor = listed.get(name);
      expect(actor, name).toBeTruthy();
      expect(actor!.countryMatch).toBe(false);
      expect(actor!.sectorMatch).toBe(false);
    }
  });

  // The seed ships one claim deliberately below the shipped gate — Salt Typhoon's T1027,
  // stated at 30 and dated more recently than anything else on that actor. It exists so a demo can
  // show a gated claim; it must therefore be provably inert.
  describe('the seeded below-gate claim', () => {
    let shippedGate: number | undefined;
    let gatedClaim: typeof threatAnalysisTechniques.$inferSelect | undefined;

    // Restoration does not depend on the test's own control flow reaching a `finally`: it runs
    // regardless of how the test exits, and is idempotent so a partially-applied mutation (or none
    // at all) is left exactly as it found it.
    afterEach(async () => {
      const services = createTestServices(db);
      const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
      const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
      const origin = { type: 'client', userId: admin.id, tenantId: acme.id } as const;

      if (shippedGate !== undefined) {
        const current = await services.withOrigin(origin).threatRelevanceSettings.getThreatRelevanceSettings();
        if (current.confidenceGate !== shippedGate) {
          await services.withOrigin(origin).threatRelevanceSettings.updateThreatRelevanceSettings({ ...current, confidenceGate: shippedGate });
        }
      }
      if (gatedClaim) {
        const [stillThere] = await db.select().from(threatAnalysisTechniques).where(eq(threatAnalysisTechniques.id, gatedClaim.id));
        if (!stillThere) {
          await db.insert(threatAnalysisTechniques).values(gatedClaim);
        }
      }
    });

    it('should keep it stored, inert, and gated rather than merely absent', async () => {
      const services = createTestServices(db);
      const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
      const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
      const origin = { type: 'client', userId: admin.id, tenantId: acme.id } as const;
      const analysesApi = () => services.withOrigin(origin).threatAnalyses;
      // Activity columns and the list's counts are both folded under the gate, so a gate change
      // reaches them on the runs the settings write books, not on the next read.
      const setGate = async (confidenceGate: number): Promise<void> => {
        const current = await services.withOrigin(origin).threatRelevanceSettings.getThreatRelevanceSettings();
        await services.withOrigin(origin).threatRelevanceSettings.updateThreatRelevanceSettings({ ...current, confidenceGate });
        await services.withOrigin({ type: 'job', tenantId: acme.id, jobKind: 'threat-activity-recompute', interactive: true })
          .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
        await services.withOrigin({ type: 'job', tenantId: acme.id, jobKind: 'threat-list-projection-recompute', interactive: false })
          .threatAnalyses.recomputeListProjections();
      };

      shippedGate = (await services.withOrigin(origin).threatRelevanceSettings.getThreatRelevanceSettings()).confidenceGate;
      await setGate(shippedGate);
      const analyses = await db.select().from(threatAnalyses);
      const saltTyphoon = analyses.find((a) => a.name === 'Salt Typhoon')!;
      const claims = await db.select().from(threatAnalysisTechniques)
        .where(eq(threatAnalysisTechniques.analysisId, saltTyphoon.id));
      gatedClaim = claims.find((t) => t.mitreExternalId === 'T1027')!;

      expect(gatedClaim.relConfidence).toBeLessThan(shippedGate);
      const gatedClaimDate = gatedClaim.relStartTime ?? gatedClaim.relCreated!;
      expect(claims.every((t) => t.id === gatedClaim!.id || (t.relStartTime ?? t.relCreated!) <= gatedClaimDate)).toBe(true);

      const detail = await analysesApi().getDetail(saltTyphoon.id);
      const [listed] = (await analysesApi().list({ page: 1, limit: 500, sortDesc: true }).then((r) => r.items)).filter((row) => row.id === saltTyphoon.id);

      expect(detail!.techniques.map((t) => t.mitreExternalId)).not.toContain('T1027');
      expect(listed.techniqueCount).toBe(claims.length - 1);
      // The most recent claim on the actor is the gated one, so an anchor that ignored the gate
      // would land on its date.
      expect(detail!.activity.lastActivityAt!.getTime()).toBeLessThan(gatedClaimDate.getTime());

      // What excludes it is the gate, not an accident of the fixture: drop the gate below 30 and the
      // same row drives all three surfaces.
      await setGate(20);
      const openDetail = await analysesApi().getDetail(saltTyphoon.id);
      const [openListed] = (await analysesApi().list({ page: 1, limit: 500, sortDesc: true }).then((r) => r.items)).filter((row) => row.id === saltTyphoon.id);

      expect(openDetail!.techniques.map((t) => t.mitreExternalId)).toContain('T1027');
      expect(openListed.techniqueCount).toBe(claims.length);
      expect(openDetail!.activity.lastActivityAt!.getTime()).toBe(gatedClaimDate.getTime());
      await setGate(shippedGate);

      // And it moves no number: the displayed outcome score is identical whether the row is in the
      // table or physically gone.
      const [scoredWithClaim] = (await analysesApi().list({ page: 1, limit: 500, sortDesc: true }).then((r) => r.items)).filter((row) => row.id === saltTyphoon.id);
      await db.delete(threatAnalysisTechniques).where(eq(threatAnalysisTechniques.id, gatedClaim.id));
      const [scoredAfterDelete] = (await analysesApi().list({ page: 1, limit: 500, sortDesc: true }).then((r) => r.items)).filter((row) => row.id === saltTyphoon.id);
      expect(scoredAfterDelete.topOutcomeName).toBe(scoredWithClaim.topOutcomeName);
      expect(scoredAfterDelete.topOutcomeScore).toBe(scoredWithClaim.topOutcomeScore);
      await db.insert(threatAnalysisTechniques).values(gatedClaim);
    });
  });

  it('should create asset findings with state history', async () => {
    const evidences = await db.select().from(assetEvidence);
    expect(evidences).toHaveLength(68);
    const sources = await db.select().from(assetEvidenceSources);
    const evidenceIdsWithSource = new Set(sources.map((s) => s.assetEvidenceId));
    expect(evidences.every((e) => e.userId !== null || evidenceIdsWithSource.has(e.id))).toBe(true);

    const history = await db.select().from(assetEvidenceHistory);
    expect(history).toHaveLength(101); // 68 applicable + 31 dismissals + 2 reopens

    const dismissed = history.filter((h) => h.state === 'dismissed');
    expect(dismissed.length).toBeGreaterThan(0);
    expect(dismissed.every((h) => h.reason)).toBe(true);
  });

  it('does not let a real recompute reopen a seeded auto-dismissed connector finding', async () => {
    const services = createTestServices(db);
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    const origin = { type: 'client', userId: admin.id, tenantId: acme.id } as const;

    const assetIds = [...new Set((await db.select({ id: supportingAssets.id })
      .from(supportingAssets)
      .where(eq(supportingAssets.tenantId, acme.id))).map((row) => row.id))];

    const currentStates = async (): Promise<Map<string, string>> => {
      const states = new Map<string, string>();
      for (const supportingAssetId of assetIds) {
        const page = await services.withOrigin(origin).findingScore.listAssetFindings({
          supportingAssetId, page: 1, limit: 500, state: null, mitreTechniqueExternalId: null, expectationType: null, search: null, sortBy: 'name', sortDesc: false,
        });
        expect(page.items).toHaveLength(page.total);
        for (const finding of page.items) {
          states.set(finding.evidenceId, finding.currentState);
        }
      }
      return states;
    };

    const before = await currentStates();
    const dismissedBefore = [...before.entries()].filter(([, state]) => state === 'dismissed').map(([id]) => id);
    expect(dismissedBefore.length).toBeGreaterThan(0);

    // A source whose seeded defaults left it reading as exposed would flip its canonical finding
    // back to applicable right here — exactly the seed bug this proves is fixed.
    await services.withOrigin({ type: 'job', tenantId: acme.id, jobKind: 'finding-score-recompute', interactive: false })
      .supportingAssets.recomputeEvidenceStateForAssets({ supportingAssetIds: assetIds, reason: 'test recompute' });

    const after = await currentStates();
    for (const id of dismissedBefore) {
      expect(after.get(id)).toBe('dismissed');
    }
  });

  it('should feed the per-host readings of a fresh environment: the tests sit on an OpenAEV host', async () => {
    const services = createTestServices(db);
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    await services.withOrigin({ type: 'job', tenantId: acme.id, jobKind: 'capability-derivation', interactive: false })
      .controlValidation.measureTechniqueTestResults({ now: new Date() });

    const readings = await services.withOrigin({ type: 'client', userId: admin.id, tenantId: acme.id })
      .controlValidation.getTechniqueTestReadings(TECHNIQUE_T1055);
    const edrPrevention = readings.find((reading) => reading.capabilityExternalId === 'EDR' && reading.function === 'prevent');
    // The family's three tests: two on T1055, one on T1055.012, the first of them held.
    expect(edrPrevention).toMatchObject({ covered: true, tested: { tests: 3, heldTests: 1, hostsTested: 1 } });
  });

  it('should give every band card a point on each day of the frame', async () => {
    const metrics = await db.select().from(findingMetricDaily);
    const bandMetrics = ['band_critical', 'band_high', 'band_medium', 'band_low'];

    // Thirty days, four bands, one row each: a card with a hole in its frame reads as a dip.
    expect(metrics).toHaveLength(30 * 4);
    expect(new Set(metrics.map((row) => row.day)).size).toBe(30);
    bandMetrics.forEach((metric) => {
      expect(metrics.filter((row) => row.metric === metric)).toHaveLength(30);
    });
    expect(metrics.some((row) => row.value > 0)).toBe(true);
  });

  it('should stand the seeded band figures on journal lines inside the retention', async () => {
    const lines = await db.select().from(findingScoreHistory);
    const oldest = lines.reduce((earliest, line) => (line.changedAt < earliest ? line.changedAt : earliest), new Date());

    expect(lines.length).toBeGreaterThan(0);
    // Inside the retention, or the first run of the platform would trim the demo away.
    expect(Date.now() - oldest.getTime()).toBeLessThan(SCORE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const evidenceIds = new Set((await db.select().from(assetEvidence)).map((row) => row.id));
    expect(lines.every((line) => evidenceIds.has(line.assetEvidenceId))).toBe(true);
  });

  it('should give the demo findings a journal past six months, with a band crossed before the last thirty days', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const lines = (await db.select().from(findingScoreHistory)).toSorted((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    const previousBand = new Map<string, string | null>();
    let crossedBeforeTheFrame = false;
    for (const line of lines) {
      const before = previousBand.get(line.assetEvidenceId);
      if (before !== undefined && before !== line.band && Date.now() - line.changedAt.getTime() > 30 * dayMs) {
        crossedBeforeTheFrame = true;
      }
      previousBand.set(line.assetEvidenceId, line.band);
    }

    expect(lines.some((line) => Date.now() - line.changedAt.getTime() > 183 * dayMs)).toBe(true);
    expect(crossedBeforeTheFrame).toBe(true);
  });

  it('should resolve the seeded vulnerabilities to techniques', async () => {
    const resolutions = await db.select().from(cveTechniqueResolution);
    expect(resolutions.length).toBeGreaterThan(0);
    expect(resolutions.every((r) => r.tablesVersion.length > 0)).toBe(true);

    expect(resolutions.some((r) => r.state === 'resolved')).toBe(true);
    expect(resolutions.some((r) => r.state === 'unresolved')).toBe(true);

    const mappings = await db.select().from(cveTechniqueMapping);
    expect(mappings.length).toBeGreaterThan(0);
    const unresolved = resolutions.filter((r) => r.state === 'unresolved').map((r) => r.cveId);
    expect(mappings.every((m) => !unresolved.includes(m.cveId))).toBe(true);
  });

  it('should create capability assessments with backdated events', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    // The seed derives the posture before it prices the anchors (#3253), as the boot would: the
    // controls the compliance mirror reaches gain auto rows beside the 14 declared ones.
    const all = await db.select().from(controlCapabilityAssessments);
    expect(all.every((a) => a.tenantId === acme[0].id)).toBe(true);
    const assessments = all.filter((a) => a.strengthMode === 'manual' || a.coverageMode === 'manual');
    expect(assessments).toHaveLength(14);
    expect(assessments.some((a) => a.strengthRung === 'L3')).toBe(true);
    expect(assessments.filter((a) => a.strengthRung === 'L0' && a.coverageBucket === 'L0')).toHaveLength(1);

    // The log opens before the running budget review period and moves inside it, whatever today's date,
    // so that review has a start posture and moves to read.
    const events = (await db.select().from(controlCapabilityAssessmentEvents)).filter((e) => e.connector !== 'derivation');
    expect(events).toHaveLength(23);
    const now = Date.now();
    const lastWeek = events.filter((e) => e.createdAt.getTime() > now - 7 * 86_400_000);
    expect(lastWeek.map((e) => e.type).toSorted()).toEqual(['coverage_change', 'strength_change']);
    const [running] = await db.select().from(budgetReviews).where(eq(budgetReviews.status, 'open'));
    const periodStart = new Date(running.periodStart).getTime();
    expect(events.every((e) => e.createdAt.getTime() <= now)).toBe(true);
    expect(events.some((e) => e.createdAt.getTime() < periodStart)).toBe(true);
    expect(events.filter((e) => e.createdAt.getTime() >= periodStart).length).toBeGreaterThan(1);
  });

  it('should declare awareness training and a phishing simulation measured under it, so the phishing entry has a declared rate to read', async () => {
    const [sat] = await db.select({ strengthRung: controlCapabilityAssessments.strengthRung })
      .from(controlCapabilityAssessments)
      .innerJoin(controlCapabilities, eq(controlCapabilities.id, controlCapabilityAssessments.capabilityId))
      .where(eq(controlCapabilities.externalId, 'SAT'));
    expect(sat.strengthRung).toBe('L2');

    const [settings] = await db.select().from(crqIndicatorSettings);
    expect(settings.phishingFailureRate).toBe(0.05);
    expect(settings.phishingFailureMeasuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(settings.phishingFailureMeasuredOn!).getTime()).toBeLessThan(Date.now());
  });

  it('should seed one scope override, logged at that scope inside the running budget review period', async () => {
    const overrides = await db.select().from(controlCapabilityScopeOverrides);
    expect(overrides).toHaveLength(1);
    const events = await db.select().from(controlCapabilityAssessmentEvents);
    const scopeEvents = events.filter((event) => event.organizationId !== null);
    expect(scopeEvents).toHaveLength(1);
    expect(scopeEvents[0]).toMatchObject({ organizationId: overrides[0].organizationId, capabilityId: overrides[0].capabilityId });
    const [running] = await db.select().from(budgetReviews).where(eq(budgetReviews.status, 'open'));
    expect(scopeEvents[0].createdAt.getTime()).toBeGreaterThanOrEqual(new Date(running.periodStart).getTime());
  });

  it('should seed an open budget review of a running fiscal year not starting in January, with build lines and a run line sharing one control', async () => {
    const reviews = await db.select().from(budgetReviews).where(eq(budgetReviews.status, 'open'));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ version: 1 });
    expect(reviews[0].periodStart).toMatch(/^\d{4}-\d{2}-01$/);
    const start = new Date(reviews[0].periodStart);
    expect(start.getUTCMonth()).not.toBe(0);
    expect(start.getTime()).toBeLessThan(Date.now());
    expect(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 1)).toBeGreaterThan(Date.now());
    const lines = await db.select().from(budgetReviewLines).where(eq(budgetReviewLines.reviewId, reviews[0].id));
    expect(lines.map((line) => line.nature).sort()).toEqual(['build', 'build', 'run']);
    const controls = await db.select().from(budgetReviewLineControls);
    const byLine = (nature: string) => new Set(controls
      .filter((control) => lines.some((line) => line.nature === nature && line.id === control.lineId))
      .map((control) => control.capabilityId));
    expect([...byLine('build')].some((capabilityId) => byLine('run').has(capabilityId))).toBe(true);
  });

  describe('budget review figures', () => {
    // Wrapped: the services proxy refuses the `then` an awaited return value is probed for.
    const acmeBudgetReviews = async () => {
      const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
      const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
      return { service: createTestServices(db).withOrigin({ type: 'client', userId: admin.id, tenantId: acme.id }).budgetReviews };
    };
    const reviewOf = async (status: 'open' | 'closed') =>
      (await db.select().from(budgetReviews).where(eq(budgetReviews.status, status)))[0];
    type Reading = { probability: number | null, beyondTail: boolean | null } | null;
    const outside = (reading: Reading, maxExceedanceProbability: number) =>
      reading !== null && reading.beyondTail === false && reading.probability! > maxExceedanceProbability;

    it('should price the running review, its build work bringing one scenario back inside its tolerance and leaving the other outside', async () => {
      const { service } = await acmeBudgetReviews();
      const review = await reviewOf('open');

      const figures = await service.getBudgetReviewFigures(review.id);
      expect(figures!.toReprice).toEqual([]);
      expect(figures!.figures.every((figure) => figure.state === 'priced' && figure.aleReductionMean! > 0)).toBe(true);

      const tolerance = await service.getBudgetReviewTolerance(review.id);
      expect(tolerance!.state).toBe('priced');
      const verdicts = tolerance!.scenarios.map((scenario) => ({
        withoutBuild: outside(scenario.withoutBuild, scenario.tolerance!.maxExceedanceProbability),
        reference: outside(scenario.reference, scenario.tolerance!.maxExceedanceProbability),
      }));
      expect(verdicts).toContainEqual({ withoutBuild: true, reference: false });
      expect(verdicts).toContainEqual({ withoutBuild: true, reference: true });
    });

    it('should seed the previous fiscal year closed after its end, every scenario outside its tolerance at the closing', async () => {
      const { service } = await acmeBudgetReviews();
      const open = await reviewOf('open');
      const closed = await reviewOf('closed');
      expect(new Date(closed.periodStart).getUTCFullYear()).toBe(new Date(open.periodStart).getUTCFullYear() - 1);
      expect(closed.closedAt!.getTime()).toBeGreaterThan(new Date(open.periodStart).getTime());

      const figures = await service.getBudgetReviewFigures(closed.id);
      expect(figures!.figures.every((figure) => figure.state === 'priced' && figure.aleReductionMean! > 0)).toBe(true);

      const postures = await service.getBudgetReviewControlPostures(closed.id);
      expect(postures!.logCoversPeriodStart).toBe(true);

      const tolerance = await service.getBudgetReviewTolerance(closed.id);
      expect(tolerance!.scenarios).toHaveLength(2);
      expect(tolerance!.scenarios.every((scenario) => outside(scenario.reference, scenario.tolerance!.maxExceedanceProbability))).toBe(true);
    });

    it('should step each review\'s build gap on each day a build control moved, the identity work on three days of the running year', async () => {
      const { service } = await acmeBudgetReviews();
      for (const [status, stepCount] of [['open', 4], ['closed', 1]] as const) {
        const series = (await service.getBudgetReviewRiskSeries((await reviewOf(status)).id))!;

        expect(series.moves).toHaveLength(stepCount);
        expect(series.pricedAt).not.toBeNull();
        const afterFirstMove = series.points.filter((point) => point.date >= series.moves[0].date);
        expect(afterFirstMove.length).toBeGreaterThan(0);
        expect(afterFirstMove.every((point) => point.without !== null && point.without > point.ale)).toBe(true);
      }
      const open = await service.getBudgetReviewRiskSeries((await reviewOf('open')).id);
      expect(open!.moves.map((day) => day.lines.map(({ finished }) => finished))).toEqual([[false], [false], [true], [true]]);
    });
  });

  /*
   * The posture rewound to today reads exactly what the scope declares now, on every control, and
   * the seeded review's period opens on a posture the period then moves: the build line's controls
   * moved, the scope override among them.
   */
  it('should rebuild the seeded scope’s posture at today’s date as its current posture, and read the period’s moves', async () => {
    const services = createTestServices(db);
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    const [review] = await db.select().from(budgetReviews).where(eq(budgetReviews.status, 'open'));
    const acmeServices = services.withOrigin({ type: 'client', userId: admin.id, tenantId: acme.id });

    const current = await acmeServices.controlCapabilities.getResolvedPosture(review.organizationId);
    const { postures: [today], logStartsAt } = await acmeServices.controlCapabilities.getScopePostureAt(review.organizationId, [new Date(Date.now() + 1000)]);
    expect(current.length).toBeGreaterThan(0);
    for (const posture of current) {
      expect(today.get(posture.capabilityId), posture.capabilityId).toMatchObject({
        strengthRung: posture.strengthRung,
        coverageBucket: posture.coverageBucket,
      });
    }
    expect(logStartsAt!.getTime()).toBeLessThan(new Date(review.periodStart).getTime());

    const postures = await acmeServices.budgetReviews.getBudgetReviewControlPostures(review.id);
    expect(postures!.logCoversPeriodStart).toBe(true);
    const [override] = await db.select().from(controlCapabilityScopeOverrides);
    expect(postures!.controls.find((control) => control.capabilityId === override.capabilityId)).toMatchObject({ moved: true });
    expect(postures!.controls.filter((control) => control.buildLine !== null).every((control) => control.moved)).toBe(true);
  });

  // One deliberate departure from the catalogue on each side, so a manual walkthrough sees
  // both override states without having to create them.
  it('should create one added and one removed technique override on an Acme control', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const overrides = await db.select().from(controlCapabilityTechniqueOverrides);
    expect(overrides).toHaveLength(2);
    expect(overrides.every((o) => o.tenantId === acme[0].id)).toBe(true);

    const removed = overrides.find((o) => o.kind === 'removed')!;
    expect(removed.function).toBe('prevent');
    const added = overrides.find((o) => o.kind === 'added')!;
    expect(added.function).toBe('prevent');
  });

  it('should seed CRQ run history with a consistent latest run per simulated Acme scenario', async () => {
    const tefInputs = await db.select().from(crqIndicatorTefInputs);
    expect(tefInputs).toHaveLength(1);

    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeOrgIds = new Set(acmeOrgs.map((o) => o.id));
    const acmeScenarios = (await db.select().from(riskScenarios)).filter((s) => acmeOrgIds.has(s.organizationId));
    expect(acmeScenarios).toHaveLength(7);

    const autoScenarios = acmeScenarios.filter((s) => s.tefMode === 'auto');
    expect(autoScenarios).toHaveLength(5);

    // Every seeded organization carries complete, mappable firmography, so each scenario positions
    // rather than falling back to the unpositioned baseline.
    const tefEstimateRows = await db.select().from(tefEstimates);
    for (const scenario of autoScenarios) {
      const estimate = tefEstimateRows.find((row) => row.riskScenarioId === scenario.id);
      expect(estimate?.positioned).toBe(true);
    }

    const allRuns = await db.select().from(crqIndicatorRuns);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
    const latestRunIds = new Set<string>();

    // Only the scenarios listed in SCENARIO_SIM_SPECS carry runs — one Acme scenario is left
    // unsimulated on purpose, so that an outcome reads as partly priced.
    const simulatedScenarios = acmeScenarios.filter((s) => allRuns.some((r) => r.riskScenarioId === s.id));
    expect(simulatedScenarios).toHaveLength(6);

    for (const scenario of simulatedScenarios) {
      const runs = allRuns
        .filter((r) => r.riskScenarioId === scenario.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      expect(runs.length).toBeGreaterThanOrEqual(60);
      // The dashboard 90-day trend needs a baseline run strictly before the window.
      expect(runs.some((r) => r.createdAt < ninetyDaysAgo)).toBe(true);
      expect(runs.every((r) => r.outcomeBlocked !== null)).toBe(true);
      expect(runs.every((r) => bandAroundMean(r.aleP10, r.aleMean, r.aleP90))).toBe(true);
      expect(runs.every((r) => bandAroundMean(r.lefP10, r.lefMean, r.lefP90))).toBe(true);
      expect(runs.every((r) => r.createdAt.getTime() <= Date.now())).toBe(true);
      latestRunIds.add(runs[0].id);
    }

    for (const scenario of simulatedScenarios.filter((s) => s.tefMode === 'auto')) {
      const runs = allRuns.filter((r) => r.riskScenarioId === scenario.id);
      const estimates = tefEstimateRows.filter((row) => row.riskScenarioId === scenario.id);
      expect(runs.every((r) => estimates.some((e) => e.likely === r.tefLikely && e.createdAt <= r.createdAt))).toBe(true);
      expect(new Set(estimates.map((e) => e.readSizeClasses?.join(','))).size).toBe(2);
      // The size moves at the newest history run, inside the last week, not at the anchor run.
      const [anchorEstimate, newestHistory, previousHistory] = estimates.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      expect(newestHistory.readSizeClasses).toEqual(anchorEstimate.readSizeClasses);
      expect(previousHistory.readSizeClasses).not.toEqual(anchorEstimate.readSizeClasses);
      expect(newestHistory.createdAt.getTime()).toBeGreaterThan(Date.now() - 7 * 86_400_000);
    }

    const gaps = await db.select().from(crqIndicatorRunReachGaps);
    expect(gaps.length).toBeGreaterThan(0);
    for (const run of allRuns) {
      const ofRun = gaps.filter((gap) => gap.runId === run.id);
      expect(ofRun.filter((gap) => gap.gap === 'estate')).toHaveLength(run.uncontestedPairCount ?? 0);
      expect(ofRun.filter((gap) => gap.gap === 'catalogue')).toHaveLength(run.uncontestablePairCount ?? 0);
    }
    const gapSets = new Set(allRuns.map((run) => gaps.filter((gap) => gap.runId === run.id).map((gap) => `${gap.mitreTechniqueId}/${gap.family}`).toSorted().join()));
    expect(gapSets.size).toBeGreaterThan(simulatedScenarios.length);

    // What-if results exist for the anchor (latest) runs only.

    const whatIfs = await db.select().from(crqControlWhatIfResults);
    expect(whatIfs.length).toBeGreaterThan(0);
    expect(whatIfs.every((w) => latestRunIds.has(w.runId))).toBe(true);
    expect(whatIfs.every((w) => w.aleReductionMean === null
      || bandAroundMean(w.aleReductionP10, w.aleReductionMean, w.aleReductionP90))).toBe(true);
  });

  it('should seed an annual loss distribution on every priced run, drawing a year of likelihood per simulated scenario', async () => {
    const pricedRuns = (await db.select().from(crqIndicatorRuns))
      .filter((run) => run.aleMean !== null && run.lefMean !== null && run.lefMean > 0);
    const distributions = new Map((await db.select().from(crqIndicatorRunAnnualLosses)).map((row) => [row.runId, row]));
    const yearAgo = Date.now() - 360 * 86_400_000;

    expect(pricedRuns.length).toBeGreaterThan(0);
    for (const run of pricedRuns) {
      const distribution = distributions.get(run.id);
      expect(distribution, run.id).toBeDefined();
      expect(distribution!.lossEventYearShare).toBeCloseTo(1 - Math.exp(-run.lefMean!), 1);
    }
    const scenarioIds = new Set(pricedRuns.map((run) => run.riskScenarioId));
    for (const scenarioId of scenarioIds) {
      expect(pricedRuns.some((run) => run.riskScenarioId === scenarioId && run.createdAt.getTime() < yearAgo)).toBe(true);
    }
  });

  it('should seed risk tolerances on several scopes, one overridden by one of its scenarios while another follows it, and leave a scope without one', async () => {
    const scopeTolerances = await db.select().from(organizationRiskTolerances);
    const overrides = await db
      .select({ riskScenarioId: riskScenarios.id, organizationId: riskScenarios.organizationId })
      .from(riskScenarioRiskTolerances)
      .innerJoin(riskScenarios, eq(riskScenarios.id, riskScenarioRiskTolerances.riskScenarioId));
    const tolerated = new Set(scopeTolerances.map((tolerance) => tolerance.organizationId));

    expect(scopeTolerances.length).toBeGreaterThan(1);
    expect(overrides).toHaveLength(1);
    expect(tolerated.has(overrides[0].organizationId)).toBe(true);
    const overriddenScopeScenarios = await db.select({ id: riskScenarios.id }).from(riskScenarios)
      .where(eq(riskScenarios.organizationId, overrides[0].organizationId));
    expect(overriddenScopeScenarios.some((scenario) => scenario.id !== overrides[0].riskScenarioId)).toBe(true);
    const scenarioScopes = await db.select({ organizationId: riskScenarios.organizationId }).from(riskScenarios);
    expect(scenarioScopes.some((scenario) => !tolerated.has(scenario.organizationId))).toBe(true);
  });

  it('should seed every run so its outcomes decompose into a threat, a defences and a business factor that recombine to its mean loss', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeOrgIds = new Set(acmeOrgs.map((o) => o.id));
    const acmeScenarios = (await db.select().from(riskScenarios)).filter((s) => acmeOrgIds.has(s.organizationId));

    const allRuns = await db.select().from(crqIndicatorRuns);
    const runsByScenario = new Map(
      acmeScenarios
        .map((scenario) => [scenario.id, allRuns.filter((run) => run.riskScenarioId === scenario.id)] as const)
        .filter(([, runs]) => runs.length > 0),
    );
    expect(runsByScenario.size).toBeGreaterThan(0);

    let pricedRunCount = 0;
    for (const runs of runsByScenario.values()) {
      for (const run of runs) {
        const sum = run.outcomeBlocked! + run.outcomeEvicted! + run.outcomeImpactDetected! + run.outcomeImpactUndetected!;
        expect(sum).toBeCloseTo(1, 9);
        expect(run.outcomeBlocked).toBeGreaterThanOrEqual(0);

        if (run.aleMean === null) {
          continue;
        }
        pricedRunCount += 1;
        expect(run.magnitudeMean).not.toBeNull();
        expect(run.magnitudeP10).not.toBeNull();
        expect(run.magnitudeP90).not.toBeNull();

        const pert = computePertExpectedValue(run.tefMin!, run.tefLikely!, run.tefMax!);
        const priced = pricedFraction({
          evicted: run.outcomeEvicted!,
          impactDetected: run.outcomeImpactDetected!,
          impactUndetected: run.outcomeImpactUndetected!,
        });
        const expectedAleMean = pert * priced * run.magnitudeMean!;
        expect(Math.abs(expectedAleMean - run.aleMean) / run.aleMean).toBeLessThan(1e-9);
      }
    }
    expect(pricedRunCount).toBeGreaterThan(0);

    // The Threat and Business curves would read flat if the history only rescaled the aggregates,
    // so at least one scenario's history must show its TEF and its magnitude actually moving.
    const varies = (values: ReadonlyArray<number>): boolean => new Set(values).size > 1;
    const scenarioWithMovingFactors = [...runsByScenario.values()].some((runs) => {
      const priced = runs.filter((run) => run.aleMean !== null);
      return varies(priced.map((run) => run.tefLikely!)) && varies(priced.map((run) => run.magnitudeMean!));
    });
    expect(scenarioWithMovingFactors).toBe(true);
  });

  it('should move the threat and defences factors by small steps from one seeded run to the next', async () => {
    const pricedRuns = (await db.select().from(crqIndicatorRuns)).filter((run) => run.aleMean !== null);
    const runsByScenario = Map.groupBy(pricedRuns, (run) => run.riskScenarioId);
    expect(runsByScenario.size).toBeGreaterThan(0);

    const stepsOf = (values: ReadonlyArray<number>): Array<number> => values
      .slice(1)
      .map((value, index) => Math.abs(value / values[index] - 1));
    const largestStep = (values: ReadonlyArray<number>): number => Math.max(0, ...stepsOf(values));
    // The budget reviews' five build moves each step the defences of their scope down once, while the noise between two
    // runs stays under 7 %: the smallest move, 5 %, crosses 10 % on some days the seed runs and not on others.
    const jumpCount = (values: ReadonlyArray<number>): number => stepsOf(values).filter((step) => step >= 0.1).length;

    for (const runs of runsByScenario.values()) {
      const chronological = runs.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const threat = chronological.map((run) => computePertExpectedValue(run.tefMin!, run.tefLikely!, run.tefMax!));
      const defences = chronological.map((run) => pricedFraction({
        evicted: run.outcomeEvicted!,
        impactDetected: run.outcomeImpactDetected!,
        impactUndetected: run.outcomeImpactUndetected!,
      }));
      expect(largestStep(threat)).toBeLessThan(0.1);
      expect(jumpCount(defences)).toBeLessThanOrEqual(5);
    }
  });

  /*
   * The treatment plans are the demonstration data of the plan screens, so what matters is that
   * every figure they will read exists: a priced row on the anchor run of each simulated scenario of
   * the plan's own risk scope, moves naming capabilities the tenant actually declares, and a promise
   * only where a plan is active, since it is stamped once at activation and never re-stamped.
   */
  it('should seed a published NIST CSF 2.0 assessment fully answered and a draft about a third answered', async () => {
    const [acme] = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const assessments = await db.select().from(complianceAssessments);
    expect(assessments.every((assessment) => assessment.tenantId === acme.id)).toBe(true);
    const published = assessments.filter((assessment) => assessment.status === 'published');
    const drafts = assessments.filter((assessment) => assessment.status === 'draft');
    expect(published).toHaveLength(1);
    expect(drafts).toHaveLength(1);
    expect(published[0].publishedAt).not.toBeNull();
    expect(published[0].publishedById).not.toBeNull();

    const answers = await db.select().from(complianceAssessmentAnswers);
    const answeredOf = (assessmentId: string) => answers.filter((answer) => answer.assessmentId === assessmentId
      && (answer.notApplicable || answer.level !== null)).length;
    expect(answeredOf(published[0].id)).toBe(106);
    expect(answeredOf(drafts[0].id)).toBeGreaterThan(20);
    expect(answeredOf(drafts[0].id)).toBeLessThan(55);
  });

  it('should seed two treatment plans, their moves and a priced row on every anchor run of their scope', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrganizations = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeOrganizationIds = new Set(acmeOrganizations.map((organization) => organization.id));
    const plans = await db.select().from(treatmentPlans);
    expect(plans).toHaveLength(2);
    expect(plans.every((plan) => acmeOrganizationIds.has(plan.organizationId))).toBe(true);
    expect(new Set(plans.map((plan) => plan.organizationId)).size).toBe(2);
    expect(plans.every((plan) => plan.ownerId !== null && plan.costOneOff !== null && plan.costRecurringAnnual !== null)).toBe(true);
    expect(plans.filter((plan) => plan.status === 'active')).toHaveLength(1);
    for (const plan of plans) {
      expect(plan.promisedAleReduction === null).toBe(plan.status !== 'active');
      expect(plan.promisedAt === null).toBe(plan.status !== 'active');
    }

    const assessments = await db.select().from(controlCapabilityAssessments);
    const declared = new Set(assessments.map((assessment) => assessment.capabilityId));
    const moves = await db.select().from(treatmentPlanMoves);
    expect(moves.length).toBeGreaterThanOrEqual(2 * plans.length);
    expect(moves.every((move) => declared.has(move.capabilityId))).toBe(true);
    expect(moves.every((move) => move.targetStrengthRung !== null || move.targetCoverageBucket !== null)).toBe(true);
    for (const plan of plans) {
      expect(moves.filter((move) => move.planId === plan.id).length).toBeGreaterThan(0);
    }

    const allRuns = await db.select().from(crqIndicatorRuns);
    const scenarioOrganization = new Map(
      (await db.select().from(riskScenarios)).map((scenario) => [scenario.id, scenario.organizationId]),
    );
    const anchorOrganization = new Map<string, string>();
    for (const scenarioId of new Set(allRuns.map((run) => run.riskScenarioId))) {
      const [anchor] = allRuns
        .filter((run) => run.riskScenarioId === scenarioId)
        .sort((one, other) => other.createdAt.getTime() - one.createdAt.getTime());
      anchorOrganization.set(anchor.id, scenarioOrganization.get(anchor.riskScenarioId)!);
    }

    const priced = await db.select().from(crqPlanWhatIfResults);
    expect(priced.length).toBeGreaterThan(0);
    for (const plan of plans) {
      const scopeAnchors = [...anchorOrganization.entries()]
        .filter(([, organizationId]) => organizationId === plan.organizationId)
        .map(([runId]) => runId);
      const rows = priced.filter((row) => row.planId === plan.id);
      expect(rows).toHaveLength(scopeAnchors.length);
      expect(rows.every((row) => scopeAnchors.includes(row.runId))).toBe(true);
      expect(rows.some((row) => row.aleReductionMean !== null && row.aleReductionMean > 0)).toBe(true);
      expect(rows.every((row) => row.aleReductionMean === null
        || bandAroundMean(row.aleReductionP10, row.aleReductionMean, row.aleReductionP90))).toBe(true);
      // A row priced against a scope the plan has since changed reads as absent, so the demo's
      // rows have to agree with their plan's current version or the screens show nothing.
      expect(rows.every((row) => row.planScopeVersion === plan.scopeVersion)).toBe(true);
    }
  });

  it('should decompose the anchor CRQ runs over the attacker mixture and store the mean accumulators', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const acmeOrgs = await db.select().from(organizations).where(eq(organizations.tenantId, acme[0].id));
    const acmeOrgIds = new Set(acmeOrgs.map((o) => o.id));
    const acmeScenarios = (await db.select().from(riskScenarios)).filter((s) => acmeOrgIds.has(s.organizationId));

    const allRuns = await db.select().from(crqIndicatorRuns);
    const allGroupScores = await db.select().from(crqIndicatorGroupScores);
    const allObstacles = await db.select().from(crqIndicatorRunUnplayableObstacles);
    let mixtureRuns = 0;
    let runsWithMoreActorsThanClasses = 0;

    for (const scenario of acmeScenarios) {
      const [anchor] = allRuns
        .filter((r) => r.riskScenarioId === scenario.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Only the scenarios listed in SCENARIO_SIM_SPECS carry a CRQ run: a new Acme scenario without
      // a matching spec must read as a skip here, not as a dereference of undefined.
      if (!anchor) {
        continue;
      }

      expect(anchor.vulnerabilityMean).toBeGreaterThan(0);
      expect(anchor.lefMean).toBeGreaterThan(0);
      expect(anchor.aleMean).toBeGreaterThan(0);

      const rows = allGroupScores.filter((row) => row.runId === anchor.id);
      if (anchor.threatEvidenceMode !== 'attacker-mixture') {
        expect(rows).toHaveLength(0);
        continue;
      }
      mixtureRuns += 1;
      expect(anchor.admittedActorCount).toBeGreaterThan(0);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.groupName === null && row.groupEntityType === null)).toBe(true);
      expect(new Set(rows.map((row) => row.actorClass)).size).toBe(rows.length);
      const obstacles = allObstacles.filter((row) => row.runId === anchor.id);
      expect(new Set(obstacles.map((row) => `${row.groupKey}:${row.obstacleKey}`)).size).toBe(obstacles.length);
      expect(rows.length).toBeLessThanOrEqual(anchor.admittedActorCount!);
      if (anchor.admittedActorCount! > rows.length) {
        runsWithMoreActorsThanClasses += 1;
      }
      expect(rows.every((row) => row.groupKey !== null)).toBe(true);
      expect(rows.every((row) => row.actorClass !== null && row.attackRunDays !== null && row.reactionTimeExceededShare !== null)).toBe(true);

      // V decomposes linearly over the mixture: the persisted per-attacker means recombine into the
      // run's own mean.
      const totalShare = rows.reduce((total, row) => total + row.share, 0);
      expect(totalShare).toBeCloseTo(1, 10);
      const recombined = rows.reduce((total, row) => total + row.share * row.vulnerabilityMean, 0);
      expect(recombined).toBeCloseTo(anchor.vulnerabilityMean!, 10);
    }

    // The Acme seed exists to exercise the CTI path end to end: at least one scenario must run on a
    // real attacker mixture rather than on the editorial fallback.
    expect(mixtureRuns).toBeGreaterThan(0);
    // Without a run whose actors outnumber their classes, a count of attacker rows would pass for the admitted actors.
    expect(runsWithMoreActorsThanClasses).toBeGreaterThan(0);
  });

  it('should seed every finding in the state its sources derive, so a retirement pass writes nothing', async () => {
    const services = createTestServices(db);
    // Run per tenant, as a connector run is: the pass files what it writes under the run's tenant.
    const assetsByTenant = Map.groupBy(
      await db.selectDistinct({ tenantId: assetEvidence.tenantId, assetId: assetEvidence.supportingAssetId }).from(assetEvidence),
      (row) => row.tenantId,
    );
    const before = await db.select({ id: assetEvidenceHistory.id }).from(assetEvidenceHistory);

    for (const [tenantId, rows] of assetsByTenant) {
      await services.withOrigin({ type: 'job', tenantId, jobKind: 'microsoft-graph-sync', interactive: false }).supportingAssets
        .recomputeEvidenceStateForAssets({ supportingAssetIds: rows.map((row) => row.assetId), reason: 'No longer reported' });
    }

    expect(await db.select({ id: assetEvidenceHistory.id }).from(assetEvidenceHistory)).toHaveLength(before.length);
  });

  it('should be idempotent — second run is a no-op', async () => {
    const usersBefore = await db.select().from(users);
    const tenantsBefore = await db.select().from(tenants);
    const rolesBefore = await db.select().from(roles);
    const groupsBefore = await db.select().from(groups);
    const orgsBefore = await db.select().from(organizations);
    const riskScenariosBefore = await db.select().from(riskScenarios);
    const notifsBefore = await db.select().from(notifications);
    const primaryAssetsBefore = await db.select().from(primaryAssets);
    const supportingAssetsBefore = await db.select().from(supportingAssets);
    const businessValueAssignmentsBefore = await db.select().from(primaryAssetBusinessValueCategories);
    const lossEstimatesBefore = await db.select().from(scenarioLossEstimates);
    const scenarioScopesBefore = await db.select().from(riskScenarioBusinessValueCategories);
    const s2pLinksBefore = await db.select().from(supportToPrimaryLinks);
    const s2sLinksBefore = await db.select().from(supportToSupportLinks);
    const serviceAccountsBefore = await db.select().from(serviceAccounts);
    const serviceAccountTokensBefore = await db.select().from(serviceAccountTokens);
    const cvesBefore = await db.select().from(cve);
    const threatsBefore = await db.select().from(threatAnalyses);
    const threatTechniquesBefore = await db.select().from(threatAnalysisTechniques);
    const assetEvidenceBefore = await db.select().from(assetEvidence);
    const assetEvidenceHistoryBefore = await db.select().from(assetEvidenceHistory);
    const capabilityAssessmentsBefore = await db.select().from(controlCapabilityAssessments);
    const capabilityAssessmentEventsBefore = await db.select().from(controlCapabilityAssessmentEvents);
    const crqRunsBefore = await db.select().from(crqIndicatorRuns);
    const crqReachGapsBefore = await db.select().from(crqIndicatorRunReachGaps);
    const crqWhatIfResultsBefore = await db.select().from(crqControlWhatIfResults);
    const crqTefInputsBefore = await db.select().from(crqIndicatorTefInputs);
    const treatmentPlansBefore = await db.select().from(treatmentPlans);
    const treatmentPlanMovesBefore = await db.select().from(treatmentPlanMoves);
    const crqPlanWhatIfResultsBefore = await db.select().from(crqPlanWhatIfResults);
    const financialProfilesBefore = await db.select().from(financialProfiles);

    await seed();

    const usersAfter = await db.select().from(users);
    const tenantsAfter = await db.select().from(tenants);
    const rolesAfter = await db.select().from(roles);
    const groupsAfter = await db.select().from(groups);
    const orgsAfter = await db.select().from(organizations);
    const riskScenariosAfter = await db.select().from(riskScenarios);
    const notifsAfter = await db.select().from(notifications);
    const primaryAssetsAfter = await db.select().from(primaryAssets);
    const supportingAssetsAfter = await db.select().from(supportingAssets);
    const businessValueAssignmentsAfter = await db.select().from(primaryAssetBusinessValueCategories);
    const lossEstimatesAfter = await db.select().from(scenarioLossEstimates);
    const scenarioScopesAfter = await db.select().from(riskScenarioBusinessValueCategories);
    const s2pLinksAfter = await db.select().from(supportToPrimaryLinks);
    const s2sLinksAfter = await db.select().from(supportToSupportLinks);
    const serviceAccountsAfter = await db.select().from(serviceAccounts);
    const serviceAccountTokensAfter = await db.select().from(serviceAccountTokens);
    const cvesAfter = await db.select().from(cve);
    const threatsAfter = await db.select().from(threatAnalyses);
    const threatTechniquesAfter = await db.select().from(threatAnalysisTechniques);
    const assetEvidenceAfter = await db.select().from(assetEvidence);
    const assetEvidenceHistoryAfter = await db.select().from(assetEvidenceHistory);
    const capabilityAssessmentsAfter = await db.select().from(controlCapabilityAssessments);
    const capabilityAssessmentEventsAfter = await db.select().from(controlCapabilityAssessmentEvents);
    const crqRunsAfter = await db.select().from(crqIndicatorRuns);
    const crqReachGapsAfter = await db.select().from(crqIndicatorRunReachGaps);
    const crqWhatIfResultsAfter = await db.select().from(crqControlWhatIfResults);
    const crqTefInputsAfter = await db.select().from(crqIndicatorTefInputs);
    const treatmentPlansAfter = await db.select().from(treatmentPlans);
    const treatmentPlanMovesAfter = await db.select().from(treatmentPlanMoves);
    const crqPlanWhatIfResultsAfter = await db.select().from(crqPlanWhatIfResults);
    const financialProfilesAfter = await db.select().from(financialProfiles);

    expect(usersAfter).toHaveLength(usersBefore.length);
    expect(tenantsAfter).toHaveLength(tenantsBefore.length);
    expect(rolesAfter).toHaveLength(rolesBefore.length);
    expect(groupsAfter).toHaveLength(groupsBefore.length);
    expect(orgsAfter).toHaveLength(orgsBefore.length);
    expect(riskScenariosAfter).toHaveLength(riskScenariosBefore.length);
    expect(notifsAfter).toHaveLength(notifsBefore.length);
    expect(primaryAssetsAfter).toHaveLength(primaryAssetsBefore.length);
    expect(supportingAssetsAfter).toHaveLength(supportingAssetsBefore.length);
    expect(businessValueAssignmentsAfter).toHaveLength(businessValueAssignmentsBefore.length);
    expect(lossEstimatesAfter).toHaveLength(lossEstimatesBefore.length);
    expect(scenarioScopesAfter).toHaveLength(scenarioScopesBefore.length);
    expect(s2pLinksAfter).toHaveLength(s2pLinksBefore.length);
    expect(s2sLinksAfter).toHaveLength(s2sLinksBefore.length);
    expect(serviceAccountsAfter).toHaveLength(serviceAccountsBefore.length);
    expect(serviceAccountTokensAfter).toHaveLength(serviceAccountTokensBefore.length);
    expect(cvesAfter).toHaveLength(cvesBefore.length);
    expect(threatsAfter).toHaveLength(threatsBefore.length);
    expect(threatTechniquesAfter).toHaveLength(threatTechniquesBefore.length);
    expect(assetEvidenceAfter).toHaveLength(assetEvidenceBefore.length);
    expect(assetEvidenceHistoryAfter).toHaveLength(assetEvidenceHistoryBefore.length);
    expect(capabilityAssessmentsAfter).toHaveLength(capabilityAssessmentsBefore.length);
    expect(capabilityAssessmentEventsAfter).toHaveLength(capabilityAssessmentEventsBefore.length);
    expect(crqRunsAfter).toHaveLength(crqRunsBefore.length);
    expect(crqReachGapsAfter).toHaveLength(crqReachGapsBefore.length);
    expect(crqWhatIfResultsAfter).toHaveLength(crqWhatIfResultsBefore.length);
    expect(crqTefInputsAfter).toHaveLength(crqTefInputsBefore.length);
    expect(treatmentPlansAfter).toHaveLength(treatmentPlansBefore.length);
    expect(treatmentPlanMovesAfter).toHaveLength(treatmentPlanMovesBefore.length);
    expect(crqPlanWhatIfResultsAfter).toHaveLength(crqPlanWhatIfResultsBefore.length);
    expect(financialProfilesAfter).toHaveLength(financialProfilesBefore.length);
  });

  describe('tenant policies', () => {
    const tenantPolicies: ReadonlyArray<unknown> = [
      tenantIsolationPolicy,
      organizationTenantIsolationPolicy,
      riskScenarioTenantIsolationPolicy,
      primaryAssetTenantIsolationPolicy,
      supportingAssetTenantIsolationPolicy,
      crqIndicatorRunTenantIsolationPolicy,
      attackOutcomeTenantIsolationPolicy,
      threatAnalysisTenantIsolationPolicy,
      jobChildTenantIsolationPolicy,
      attackSurfaceTenantIsolationPolicy,
      treatmentPlanTenantIsolationPolicy,
      budgetReviewTenantIsolationPolicy,
      // The OpenCTI marking policies narrow only an origin the tenant procedure resolved markings for
      // (opencrq #31): the plain client origins below carry none, so they see the whole tenant.
      threatMarkingPolicy,
      threatAnalysisMarkingPolicy,
      streamObjectMarkingPolicy,
      reportRefMarkingPolicy,
    ];
    const tableKeys: ReadonlyArray<string> = Object.entries(schema).flatMap(([key, value]) => (is(value, PgTable) ? [key] : []));
    const isTableKey = (key: string): key is keyof SecuredSchema => tableKeys.includes(key);
    const guardedTables = Object.keys(schema).filter(isTableKey).filter((key) => getSecurityPolicies(schema[key]).length > 0);
    const isTenantScoped = (key: keyof SecuredSchema) => getSecurityPolicies(schema[key]).every((policy) => tenantPolicies.includes(policy));
    const tenantScopedTables = guardedTables.filter(isTenantScoped);
    // A further policy (a capability, an owner) shows a member less than the tenant holds, so these are left out.
    const FURTHER_GUARDED_TABLES = [
      'crqIndicatorSettings', 'cweTechniqueOverrides', 'dashboardSettings', 'groupRoles', 'groups', 'groupUsers', 'notifications',
      'organizationAssets', 'organizationUnpins', 'platformGroupRoles', 'platformGroups', 'platformGroupUsers',
      'platformRoleCapabilities', 'platformRoles', 'roleCapabilities', 'roles', 'serviceAccountGroups', 'serviceAccounts',
      'serviceAccountTokens', 'tenants', 'tenantUsers', 'threatRelevanceSettings', 'users',
    ];

    const jobIn = (tenantId: string): EventOrigin => ({ type: 'job', tenantId, jobKind: 'probe', interactive: false });
    const clientIn = (userId: string, tenantId: string): EventOrigin => ({ type: 'client', userId, tenantId });
    const NOTHING = { rows: 0, hash: BigInt(0) };
    /** The rows an origin sees, counted and hashed, so two sets of the same size still tell apart. */
    const visible = async (origin: EventOrigin, key: keyof SecuredSchema) => {
      const [row] = await db
        .select({ rows: count(), hash: sql<string>`coalesce(sum(hashtext(${sql.identifier(getTableName(schema[key]))}::text)), 0)` })
        .from(createSecuredSchema(db, origin)[key]);
      return { rows: row.rows, hash: BigInt(row.hash) };
    };

    let tenantIds: Array<string>;
    // Two users, each a member of one tenant only, in two different tenants.
    let member: { userId: string, tenantId: string };
    let memberElsewhere: { userId: string, tenantId: string };
    let memberOfSeveral: { userId: string, tenantIds: Array<string> };

    beforeAll(async () => {
      const seededTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
      tenantIds = seededTenants.map((tenant) => tenant.id);
      // The tenant holding the most seeded data, so that one member sees most of the tables.
      const acmeId = seededTenants.find((tenant) => tenant.name === 'Acme Bank')!.id;
      const memberships = await db
        .select({ userId: tenantUsers.userId, tenantId: tenantUsers.tenantId })
        .from(tenantUsers)
        .orderBy(tenantUsers.userId, tenantUsers.tenantId);
      const tenantsOf = (userId: string) => memberships.filter((row) => row.userId === userId).map((row) => row.tenantId);
      const singleTenantMembers = memberships.filter((row) => tenantsOf(row.userId).length === 1);
      const withScenarios = new Set((await db.select({ tenantId: riskScenarios.tenantId }).from(riskScenarios)).map((row) => row.tenantId));
      member = singleTenantMembers.find((row) => row.tenantId === acmeId)!;
      memberElsewhere = singleTenantMembers.find((row) => row.tenantId !== member.tenantId && withScenarios.has(row.tenantId))!;
      const severalTenantsUserId = memberships.find((row) => tenantsOf(row.userId).filter((tenantId) => withScenarios.has(tenantId)).length >= 2)!.userId;
      memberOfSeveral = { userId: severalTenantsUserId, tenantIds: tenantsOf(severalTenantsUserId) };
    });

    it('should leave out only the tables a further policy guards', () => {
      expect(guardedTables.filter((key) => !isTenantScoped(key)).sort()).toEqual([...FURTHER_GUARDED_TABLES].sort());
    });

    it('should hold seeded rows in most of the tables they guard', async () => {
      const seeded = await Promise.all(tenantScopedTables.map(async (key) => visible(jobIn(member.tenantId), key)));

      expect(seeded.filter(({ rows }) => rows > 0).length).toBeGreaterThanOrEqual(50);
    });

    it.each(tenantScopedTables)('should give %s to a member exactly as its tenant holds it, and nothing to anyone else', async (key) => {
      const total = await visible({ type: 'system' }, key);
      const perTenant = await Promise.all(tenantIds.map(async (tenantId) => visible(jobIn(tenantId), key)));
      const inTenant = (tenantId: string) => perTenant[tenantIds.indexOf(tenantId)];

      expect(perTenant.reduce((sum, seen) => ({ rows: sum.rows + seen.rows, hash: sum.hash + seen.hash }), NOTHING)).toEqual(total);
      expect(await visible(clientIn(member.userId, member.tenantId), key)).toEqual(inTenant(member.tenantId));
      expect(await visible(clientIn(memberElsewhere.userId, memberElsewhere.tenantId), key)).toEqual(inTenant(memberElsewhere.tenantId));
      for (const tenantId of memberOfSeveral.tenantIds) {
        expect(await visible(clientIn(memberOfSeveral.userId, tenantId), key), tenantId).toEqual(inTenant(tenantId));
      }
      expect(await visible(clientIn(memberElsewhere.userId, member.tenantId), key)).toEqual(NOTHING);
      expect(await visible(clientIn(uuidv7(), member.tenantId), key)).toEqual(NOTHING);
    });
  });

  it('should anchor each scenario on the engine price the first price pass writes, so the trend has no cliff on its last day', async () => {
    const acme = await db.select().from(tenants).where(eq(tenants.name, 'Acme Bank'));
    const seeded = await db.select().from(crqIndicatorRuns);
    const anchorByScenario = new Map<string, typeof seeded[number]>();
    for (const run of seeded.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      anchorByScenario.set(run.riskScenarioId, run);
    }

    // The pass a fresh tenant runs right after the seed, on the inputs the anchor did not fingerprint.
    const services = createTestServices(db).withOrigin({ type: 'job', tenantId: acme[0].id, jobKind: 'crq-price-recompute', interactive: false });
    await services.crqIndicators.priceAllScenarios(acme[0].id, new AbortController().signal, uuidv7(), {});

    const after = await db.select().from(crqIndicatorRuns);
    let compared = 0;
    for (const [scenarioId, anchor] of anchorByScenario) {
      const [latest] = after.filter((run) => run.riskScenarioId === scenarioId)
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (latest.id === anchor.id || anchor.aleMean === null || latest.aleMean === null) {
        continue;
      }
      compared += 1;
      expect(latest.vulnerabilityMean! / anchor.vulnerabilityMean!).toBeGreaterThan(0.8);
      expect(latest.vulnerabilityMean! / anchor.vulnerabilityMean!).toBeLessThan(1.25);
      expect(latest.aleMean / anchor.aleMean).toBeGreaterThan(0.6);
      expect(latest.aleMean / anchor.aleMean).toBeLessThan(1.6);
    }
    expect(compared).toBeGreaterThan(0);
  }, 180_000);
});
