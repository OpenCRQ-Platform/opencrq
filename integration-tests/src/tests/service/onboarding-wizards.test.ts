import type { EventOrigin } from '@app/module';
import { controlCapabilityAssessments, crqIndicatorRuns, DECLARED_ESTATE_KIND_VALUES, ONBOARDING_RISK_SCOPE_NAME, onboardingWizards, organizations, threatAnalyses } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createAdminUser, createTenant, createTenantUser } from '../../helpers/factories';
import { EMPTY_ANSWERS, FULLY_ANSWERED_PROFILE_ANSWERS } from '../../helpers/financial-profile-answers';
import { buildParsedEntry } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const PROVISION = { provisionOnboarding: true };

describe('Onboarding Wizards Service', () => {
  let adminId: string;
  let tenantId: string;
  let adminOrigin: EventOrigin;

  const clientOrigin = (userId: string, forTenantId: string): EventOrigin => ({ type: 'client', userId, tenantId: forTenantId });

  beforeEach(async () => {
    await truncateAllTables(db);
    adminId = (await createAdminUser(services)).userId;
    tenantId = await createTenant(services, adminId, PROVISION);
    adminOrigin = clientOrigin(adminId, tenantId);
  });

  const getScopeId = async () => {
    const scopes = await services.withOrigin(adminOrigin).organizations.getOrganizations();
    expect(scopes).toHaveLength(1);
    return scopes[0].id;
  };

  const setSectorAndCountry = async (organizationId: string, which: { sector?: boolean, country?: boolean }) => {
    const scoped = services.withOrigin(adminOrigin);
    const [sector] = await scoped.sectors.getSectors();
    const [country] = await scoped.countries.getCountries();
    await scoped.organizations.updateOrganization(organizationId, {
      ...(which.sector ? { sectorId: sector.id } : {}),
      ...(which.country ? { countryId: country.id } : {}),
    });
  };

  const createAsset = async (origin: EventOrigin) => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id, name: 'Database Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });
    return id;
  };

  const createThreat = async (origin: EventOrigin, forTenantId: string) => {
    await services.withOrigin(origin).threatAnalyses.ingestBundle([buildParsedEntry()], forTenantId, 'stix-import');
  };

  const SCOPE_TOLERANCE = { annualLoss: 1_000_000, maxExceedanceProbability: 0.1 };

  const setAnnualRevenue = async (organizationId: string) => {
    await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, { ...EMPTY_ANSWERS, annualRevenue: 50_000_000 });
  };

  /** The 21 questions answered, the gated ones included. */
  const COMPLETE_ANSWERS = {
    ...FULLY_ANSWERED_PROFILE_ANSWERS,
    restoreTestRecency: 'within_12m' as const,
    largestRepositoryBand: 'under_100k' as const,
    contractualLiabilityCapBand: 'under_25' as const,
    worstOutageBand: 'none' as const,
    costliestIncidentBand: 'none' as const,
  };

  const saveAnswers = async (organizationId: string, answers: typeof EMPTY_ANSWERS) => {
    await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, answers);
  };

  const setTolerance = async (organizationId: string) => {
    await services.withOrigin(adminOrigin).organizations.setRiskTolerance(organizationId, SCOPE_TOLERANCE);
  };

  const firstCapabilityId = async (origin: EventOrigin = adminOrigin) => {
    const [capability] = await services.withOrigin(origin).controlCapabilities.getControlCapabilities();
    return capability.id;
  };

  const assessCapability = async (origin: EventOrigin = adminOrigin) => {
    await services.withOrigin(origin).controlCapabilities.upsertAssessment(await firstCapabilityId(origin), 'L0', 'L0', null);
  };

  const catalogueIds = async (origin: EventOrigin = adminOrigin) =>
    (await services.withOrigin(origin).controlCapabilities.getControlCapabilities()).map((capability) => capability.id);

  /** Assesses the given capabilities of the tenant straight in the table: one write for the whole catalogue. */
  const assessCapabilities = async (capabilityIds: ReadonlyArray<string>, forTenantId: string = tenantId) => {
    await db.insert(controlCapabilityAssessments).values(
      capabilityIds.map((capabilityId) => ({ id: uuidv7(), capabilityId, tenantId: forTenantId })),
    );
  };

  const declareScopePosture = async (organizationId: string, capabilityId?: string) => {
    await services.withOrigin(adminOrigin).controlCapabilities.declareScopePosture(organizationId, capabilityId ?? await firstCapabilityId(), {
      strengthRung: 'L1', coverageBucket: null, comment: null,
    });
  };

  const declareEstate = async (organizationId: string) => {
    await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(organizationId, [
      { kind: 'workstations', bounds: { low: 251, high: 1000 }, internetFacing: null },
    ]);
  };

  /** Every kind answered, the first one "None": an answer of bounds 0 to 0 is an answer. */
  const declareEveryKind = async (organizationId: string, kinds: ReadonlyArray<(typeof DECLARED_ESTATE_KIND_VALUES)[number]> = DECLARED_ESTATE_KIND_VALUES) => {
    await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(
      organizationId,
      kinds.map((kind, index) => ({ kind, bounds: index === 0 ? { low: 0, high: 0 } : { low: 1, high: 10 }, internetFacing: null })),
    );
  };

  const createPrimaryAsset = async (organizationId: string) => {
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id: uuidv7(), organizationId, name: 'Payments', description: null, ownerId: null, businessValueCategoryIds: [],
    });
  };

  const createRiskScenario = async (organizationId: string) => {
    const [attackOutcome] = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id, organizationId, name: 'Ransomware', description: null, attackOutcomeId: attackOutcome.id, primaryAssetIds: [],
    });
    return id;
  };

  /** A run left unpriced (no TEF or loss estimate) stores no loss figure. */
  const insertRun = async (riskScenarioId: string, { priced = true }: { priced?: boolean } = {}) => {
    await db.insert(crqIndicatorRuns).values({
      id: uuidv7(),
      riskScenarioId,
      iterations: 1000,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      lefMean: 2,
      aleP10: priced ? 50 : null,
      aleMean: priced ? 100 : null,
      aleP90: priced ? 200 : null,
      techniqueCount: 10,
      coveredTechniqueCount: 4,
    });
  };

  type StepKey = 'company' | 'assets' | 'threats' | 'defenses' | 'finances' | 'tolerance' | 'protect' | 'scenarios';

  const finishEveryStep = async (organizationId: string, { skip = [] }: { skip?: ReadonlyArray<StepKey> } = {}) => {
    const wanted = (key: StepKey) => !skip.includes(key);
    if (wanted('company')) {
      await setSectorAndCountry(organizationId, { sector: true, country: true });
    }
    if (wanted('assets')) {
      await declareEveryKind(organizationId);
    }
    if (wanted('threats')) {
      await createThreat(adminOrigin, tenantId);
    }
    if (wanted('defenses')) {
      await assessCapabilities(await catalogueIds());
    }
    if (wanted('finances')) {
      await saveAnswers(organizationId, COMPLETE_ANSWERS);
    }
    if (wanted('tolerance')) {
      await setTolerance(organizationId);
    }
    if (wanted('protect')) {
      await createPrimaryAsset(organizationId);
    }
    if (wanted('scenarios')) {
      await insertRun(await createRiskScenario(organizationId));
    }
  };

  const createOtherScope = async () => {
    const otherScopeId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherScopeId, name: 'Other scope' }]);
    return otherScopeId;
  };

  describe('provisioning', () => {
    it('should provision an Enterprise risk scope without sector nor country, and a wizard targeting it, readable by a tenant member', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      const scopes = await services.withOrigin(member.origin).organizations.getOrganizations();
      expect(scopes).toHaveLength(1);
      expect(scopes[0]).toMatchObject({ name: ONBOARDING_RISK_SCOPE_NAME, sectorId: null, countryId: null });
      expect(ONBOARDING_RISK_SCOPE_NAME).toBe('Enterprise');

      const wizard = await services.withOrigin(member.origin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ organizationId: scopes[0].id });
    });

    it('should provision nothing without the option, and read no wizard', async () => {
      const plainTenantId = await createTenant(services, adminId);
      const origin = clientOrigin(adminId, plainTenantId);

      expect(await services.withOrigin(origin).organizations.getOrganizations()).toHaveLength(0);
      expect(await services.withOrigin(origin).onboardingWizards.getOnboardingWizard()).toBeNull();
    });

    it('should switch the OpenCRQ threat set off on a provisioned tenant, and leave it on for a tenant that is not', async () => {
      expect(await services.withOrigin(adminOrigin).defaultThreats.getSettings(tenantId)).toMatchObject({ enabled: false, loadedAt: null });

      const plainTenantId = await createTenant(services, adminId);
      const plainOrigin = clientOrigin(adminId, plainTenantId);
      expect(await services.withOrigin(plainOrigin).defaultThreats.getSettings(plainTenantId)).toMatchObject({ enabled: true });
    });
  });

  describe('steps', () => {
    it('should report the eight steps as todo on a fresh wizard', async () => {
      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({
        steps: {
          company: 'todo', assets: 'todo', threats: 'todo', defenses: 'todo', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo',
        },
        finished: false,
      });
    });

    it('should report the Company step as done but the wizard as unfinished once the sector and the country are set', async () => {
      const scopeId = await getScopeId();
      await setSectorAndCountry(scopeId, { sector: true, country: true });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ organizationId: scopeId, steps: { company: 'done', assets: 'todo' }, finished: false });
    });

    it('should report the Assets step as started once a supporting asset exists, however many', async () => {
      await createAsset(adminOrigin);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'todo', assets: 'started' }, finished: false });
    });

    it('should report the Assets step as started once the wizard scope declares some kinds, with no supporting asset', async () => {
      await declareEstate(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { assets: 'started' }, finished: false });
    });

    it('should report the Assets step as started while one kind is left unanswered, even with a supporting asset', async () => {
      const scopeId = await getScopeId();
      await createAsset(adminOrigin);
      await declareEveryKind(scopeId, DECLARED_ESTATE_KIND_VALUES.slice(1));

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { assets: 'started' } });
    });

    it('should report the Assets step as done once the 12 kinds are answered, "None" included, with no supporting asset', async () => {
      await declareEveryKind(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { assets: 'done' } });
    });

    it('should count a "None" answer as an answered kind', async () => {
      const scopeId = await getScopeId();
      await declareEveryKind(scopeId, DECLARED_ESTATE_KIND_VALUES.slice(1));
      expect(await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { assets: 'started' } });

      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(scopeId, [
        { kind: DECLARED_ESTATE_KIND_VALUES[0], bounds: { low: 0, high: 0 }, internetFacing: null },
      ]);
      expect(await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { assets: 'done' } });
    });

    it('should reopen the Assets step as started when one answer is cleared', async () => {
      const scopeId = await getScopeId();
      await declareEveryKind(scopeId);
      await services.withOrigin(adminOrigin).declaredEstate.saveDeclaredEstate(scopeId, [
        { kind: DECLARED_ESTATE_KIND_VALUES[1], bounds: null, internetFacing: null },
      ]);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { assets: 'started' } });
    });

    it('should not count the estate another risk scope declares as an Assets answer', async () => {
      await declareEstate(await createOtherScope());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { assets: 'todo' } });
    });

    it('should not complete the Assets step with the 12 kinds answered on another risk scope', async () => {
      await declareEveryKind(await createOtherScope());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { assets: 'todo' } });
    });

    it('should report the Threats step as done but the wizard as unfinished once a threat exists', async () => {
      await createThreat(adminOrigin, tenantId);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'todo', assets: 'todo', threats: 'done' }, finished: false });
    });

    it('should keep the wizard unfinished while Company and Assets are done but no threat exists', async () => {
      const scopeId = await getScopeId();
      await setSectorAndCountry(scopeId, { sector: true, country: true });
      await declareEveryKind(scopeId);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'done', assets: 'done', threats: 'todo' }, finished: false });
    });

    it('should keep the wizard unfinished while Company is todo even with an asset and a threat', async () => {
      await createAsset(adminOrigin);
      await createThreat(adminOrigin, tenantId);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'todo', assets: 'started', threats: 'done' }, finished: false });
    });

    it('should keep the wizard unfinished while Assets is todo even with Company done and a threat', async () => {
      await setSectorAndCountry(await getScopeId(), { sector: true, country: true });
      await createThreat(adminOrigin, tenantId);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'done', assets: 'todo', threats: 'done' }, finished: false });
    });

    it('should keep the wizard unfinished while Company, Assets and Threats are done but the five others are todo', async () => {
      const scopeId = await getScopeId();
      await setSectorAndCountry(scopeId, { sector: true, country: true });
      await declareEveryKind(scopeId);
      await createThreat(adminOrigin, tenantId);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({
        steps: { company: 'done', assets: 'done', threats: 'done', defenses: 'todo', finances: 'todo', tolerance: 'todo', protect: 'todo', scenarios: 'todo' },
        finished: false,
      });
    });

    it('should keep the wizard unfinished while only Tolerance is todo', async () => {
      const scopeId = await getScopeId();
      await finishEveryStep(scopeId, { skip: ['tolerance'] });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { finances: 'done', tolerance: 'todo' }, finished: false });
    });

    it('should report the wizard as finished with Finances and Defenses started, since a started step never blocks it', async () => {
      const scopeId = await getScopeId();
      await finishEveryStep(scopeId, { skip: ['defenses', 'finances'] });
      await saveAnswers(scopeId, { ...EMPTY_ANSWERS, annualRevenue: 50_000_000 });
      await assessCapability();

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({
        steps: {
          company: 'done', assets: 'done', threats: 'done', defenses: 'started', finances: 'started', tolerance: 'done', protect: 'done', scenarios: 'done',
        },
        finished: true,
      });
    });

    it('should report the wizard as finished with Assets started, since a started step never blocks it', async () => {
      const scopeId = await getScopeId();
      await finishEveryStep(scopeId, { skip: ['assets'] });
      await createAsset(adminOrigin);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { assets: 'started' }, finished: true });
    });

    it('should report the wizard as finished once the eight steps are done', async () => {
      await finishEveryStep(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({
        steps: {
          company: 'done', assets: 'done', threats: 'done', defenses: 'done', finances: 'done', tolerance: 'done', protect: 'done', scenarios: 'done',
        },
        finished: true,
      });
    });

    it.each(['defenses', 'scenarios'] as const)('should keep the wizard unfinished while only %s is todo', async (key) => {
      const scopeId = await getScopeId();
      await finishEveryStep(scopeId, { skip: [key] });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { [key]: 'todo' }, finished: false });
      expect(Object.values(wizard!.steps).filter((status) => status === 'todo')).toHaveLength(1);
    });

    it('should keep the wizard unfinished while Protect is todo, which a computed scenario cannot leave done', async () => {
      await finishEveryStep(await getScopeId(), { skip: ['protect', 'scenarios'] });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { protect: 'todo', scenarios: 'todo' }, finished: false });
    });

    it('should report the Defenses step as started once the tenant assessed a capability, a declared level 0 included', async () => {
      await assessCapability();

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { defenses: 'started', protect: 'todo', scenarios: 'todo' }, finished: false });
    });

    it('should report the Defenses step as started once the wizard scope declares a capability posture', async () => {
      await declareScopePosture(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { defenses: 'started' } });
    });

    it('should report the Defenses step as done only once every capability of the catalogue is assessed', async () => {
      const [last, ...others] = (await catalogueIds()).toReversed();
      await assessCapabilities(others);
      expect(await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { defenses: 'started' } });

      await assessCapabilities([last]);
      expect(await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { defenses: 'done' } });
    });

    it('should count a posture the wizard scope declares for the one capability the tenant has not assessed', async () => {
      const [last, ...others] = (await catalogueIds()).toReversed();
      await assessCapabilities(others);
      await declareScopePosture(await getScopeId(), last);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { defenses: 'done' } });
    });

    it('should not count the posture another risk scope declares for the one capability left unassessed', async () => {
      const [last, ...others] = (await catalogueIds()).toReversed();
      await assessCapabilities(others);
      await declareScopePosture(await createOtherScope(), last);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { defenses: 'started' } });
    });

    it('should not count the capability posture another risk scope declares as a Defenses answer', async () => {
      await declareScopePosture(await createOtherScope());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { defenses: 'todo' } });
    });

    it('should report the Protect step as done once the wizard scope has a primary asset', async () => {
      await createPrimaryAsset(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { protect: 'done', scenarios: 'todo' }, finished: false });
    });

    it('should keep the Protect step todo while the wizard scope has a risk scenario and no primary asset', async () => {
      await createRiskScenario(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { protect: 'todo', scenarios: 'todo' } });
    });

    it('should not count the primary assets nor the risk scenarios of another risk scope as a Protect answer', async () => {
      const otherScopeId = await createOtherScope();
      await createPrimaryAsset(otherScopeId);
      await createRiskScenario(otherScopeId);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { protect: 'todo' } });
    });

    it('should keep the Scenarios step todo while the scope has a scenario without a run', async () => {
      await createRiskScenario(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { scenarios: 'todo' } });
    });

    it('should keep the Scenarios step todo while the runs of the scope priced nothing', async () => {
      await insertRun(await createRiskScenario(await getScopeId()), { priced: false });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { scenarios: 'todo' } });
    });

    it('should keep the Scenarios step todo when the latest run of a scenario priced nothing, an earlier one did', async () => {
      const riskScenarioId = await createRiskScenario(await getScopeId());
      await insertRun(riskScenarioId);
      await insertRun(riskScenarioId, { priced: false });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { scenarios: 'todo' } });
    });

    it('should report the Scenarios step as done once a scenario of the wizard scope has a priced run', async () => {
      await insertRun(await createRiskScenario(await getScopeId()));

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { protect: 'todo', scenarios: 'done' }, finished: false });
    });

    it('should not count the run of a scenario of another risk scope as a Scenarios answer', async () => {
      await insertRun(await createRiskScenario(await createOtherScope()));

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { scenarios: 'todo' } });
    });

    it('should keep the Finances step todo while the profile has no answer', async () => {
      await saveAnswers(await getScopeId(), EMPTY_ANSWERS);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { finances: 'todo' }, finished: false });
    });

    it('should report the Finances step as started once the profile has one answer, whichever it is', async () => {
      await saveAnswers(await getScopeId(), { ...EMPTY_ANSWERS, grossMarginPct: 40 });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'todo', finances: 'started', tolerance: 'todo' }, finished: false });
    });

    it('should report the Finances step as done once the 21 questions are answered', async () => {
      await saveAnswers(await getScopeId(), COMPLETE_ANSWERS);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { finances: 'done' } });
    });

    it('should keep the Finances step started while one question is left, a gated one included', async () => {
      const scopeId = await getScopeId();
      await saveAnswers(scopeId, { ...COMPLETE_ANSWERS, costliestIncidentBand: null });
      expect(await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { finances: 'started' } });

      await saveAnswers(scopeId, { ...COMPLETE_ANSWERS, individualsBand: null });
      expect(await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { finances: 'started' } });

      await saveAnswers(scopeId, { ...COMPLETE_ANSWERS, recordsHeldGate: false });
      expect(await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { finances: 'done' } });
    });

    it('should not count the financial profile of another risk scope of the tenant', async () => {
      await saveAnswers(await createOtherScope(), COMPLETE_ANSWERS);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { finances: 'todo' } });
    });

    it('should report the Tolerance step as done once the scope has a risk tolerance', async () => {
      await setTolerance(await getScopeId());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'todo', finances: 'todo', tolerance: 'done' }, finished: false });
    });

    it('should not count the risk tolerance of another risk scope of the tenant', async () => {
      await setTolerance(await createOtherScope());

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { tolerance: 'todo' } });
    });

    it('should read one wizard whatever the profile and the tolerance of its scope', async () => {
      const scopeId = await getScopeId();
      await setAnnualRevenue(scopeId);
      await setTolerance(scopeId);

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ organizationId: scopeId, steps: { finances: 'started', tolerance: 'done' } });
    });

    it('should reopen the Threats step when the last threat is deleted', async () => {
      const scoped = services.withOrigin(adminOrigin);
      await createThreat(adminOrigin, tenantId);
      expect(await scoped.onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { threats: 'done' } });

      const [threat] = await db.select({ id: threatAnalyses.id }).from(threatAnalyses).where(eq(threatAnalyses.tenantId, tenantId));
      await scoped.threatAnalyses.deleteImported([threat.id]);

      expect(await scoped.onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { threats: 'todo' } });
    });

    it('should reopen the Assets step when the last supporting asset is deleted', async () => {
      const scoped = services.withOrigin(adminOrigin);
      const assetId = await createAsset(adminOrigin);
      expect(await scoped.onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { assets: 'started' } });
      await scoped.supportingAssets.deleteSupportingAssets([assetId]);

      expect(await scoped.onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { assets: 'todo' } });
    });

    it('should keep the Company step todo while only the sector is set', async () => {
      await setSectorAndCountry(await getScopeId(), { sector: true });

      const wizard = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(wizard).toMatchObject({ steps: { company: 'todo' }, finished: false });
    });

    it('should not change the status when the scope is renamed', async () => {
      const scopeId = await getScopeId();
      const scoped = services.withOrigin(adminOrigin);
      await scoped.organizations.updateOrganization(scopeId, { name: 'Acme Holdings' });
      expect(await scoped.onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { company: 'todo' } });

      await setSectorAndCountry(scopeId, { sector: true, country: true });
      await scoped.organizations.updateOrganization(scopeId, { name: 'Acme Group' });
      expect(await scoped.onboardingWizards.getOnboardingWizard()).toMatchObject({ steps: { company: 'done' } });
    });
  });

  describe('cascade delete', () => {
    it('should delete the wizard with its risk scope', async () => {
      const scoped = services.withOrigin(adminOrigin);
      await scoped.organizations.deleteOrganizations([await getScopeId()]);

      expect(await scoped.onboardingWizards.getOnboardingWizard()).toBeNull();
      expect(await db.select().from(onboardingWizards).where(eq(onboardingWizards.tenantId, tenantId))).toHaveLength(0);
      expect(await db.select().from(organizations).where(eq(organizations.tenantId, tenantId))).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('should let a member of another provisioned tenant read their own wizard, never the first one', async () => {
      const otherTenantId = await createTenant(services, adminId, PROVISION);
      const otherMember = await createTenantUser(services, db, clientOrigin(adminId, otherTenantId));
      const firstMember = await createTenantUser(services, db, adminOrigin);

      const firstScopeId = await getScopeId();
      const otherScopeId = (await services.withOrigin(otherMember.origin).organizations.getOrganizations())[0].id;
      expect(otherScopeId).not.toBe(firstScopeId);

      const first = await services.withOrigin(firstMember.origin).onboardingWizards.getOnboardingWizard();
      const other = await services.withOrigin(otherMember.origin).onboardingWizards.getOnboardingWizard();
      expect(first?.organizationId).toBe(firstScopeId);
      expect(other?.organizationId).toBe(otherScopeId);
      expect(first?.id).not.toBe(other?.id);
    });

    it('should not count the supporting assets of another tenant', async () => {
      const otherTenantId = await createTenant(services, adminId, PROVISION);
      await createAsset(clientOrigin(adminId, otherTenantId));

      const other = await services.withOrigin(clientOrigin(adminId, otherTenantId)).onboardingWizards.getOnboardingWizard();
      const first = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(other?.steps.assets).toBe('started');
      expect(first?.steps.assets).toBe('todo');
    });

    it('should not count the assessments, primary assets nor runs of another tenant', async () => {
      const otherTenantId = await createTenant(services, adminId, PROVISION);
      const otherOrigin = clientOrigin(adminId, otherTenantId);
      await assessCapabilities(await catalogueIds(otherOrigin), otherTenantId);

      const otherScopeId = (await services.withOrigin(otherOrigin).organizations.getOrganizations())[0].id;
      await services.withOrigin(otherOrigin).primaryAssets.createPrimaryAsset({
        id: uuidv7(), organizationId: otherScopeId, name: 'Payments', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      const [attackOutcome] = await services.withOrigin(otherOrigin).attackOutcomes.getAttackOutcomes();
      const scenarioId = uuidv7();
      await services.withOrigin(otherOrigin).riskScenarios.createRiskScenario({
        id: scenarioId, organizationId: otherScopeId, name: 'Ransomware', description: null, attackOutcomeId: attackOutcome.id, primaryAssetIds: [],
      });
      await insertRun(scenarioId);

      const other = await services.withOrigin(otherOrigin).onboardingWizards.getOnboardingWizard();
      const first = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(other?.steps).toMatchObject({ defenses: 'done', protect: 'done', scenarios: 'done' });
      expect(first?.steps).toMatchObject({ defenses: 'todo', protect: 'todo', scenarios: 'todo' });
    });

    it('should not count the threats of another tenant', async () => {
      const otherTenantId = await createTenant(services, adminId, PROVISION);
      const otherOrigin = clientOrigin(adminId, otherTenantId);
      await createThreat(otherOrigin, otherTenantId);

      const other = await services.withOrigin(otherOrigin).onboardingWizards.getOnboardingWizard();
      const first = await services.withOrigin(adminOrigin).onboardingWizards.getOnboardingWizard();
      expect(other?.steps.threats).toBe('done');
      expect(first?.steps.threats).toBe('todo');
    });
  });
});
