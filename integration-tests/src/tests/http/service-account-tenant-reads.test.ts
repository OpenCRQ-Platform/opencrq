import type { EventOrigin, ParsedThreatInput } from '@app/module';
import { AttackOutcome_Ransomware, attackOutcomeMitreTechniques, Capability_ManageSecurity, controlCapabilityAssessments, deriveSeedId, THREAT_RELEVANCE_DEFAULTS, threatAnalyses } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { createTenantWithAdmin } from '../../helpers/factories';
import { createServiceAccountClient } from '../../helpers/service-account-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

const relMeta = { relCreated: null, relStartTime: null, relStopTime: null, relModified: null, relConfidence: THREAT_RELEVANCE_DEFAULTS.confidenceGate };

const actorTargetingFrance: ParsedThreatInput = {
  threat: {
    stixId: 'intrusion-set--french-actor',
    entityType: 'intrusion-set',
    name: 'french-actor',
    description: null,
    mitreGroupId: null,
    confidence: 80,
    stixCreated: new Date('2024-01-01T00:00:00.000Z'),
    firstSeen: new Date('2024-01-01T00:00:00.000Z'),
    lastSeen: new Date('2024-06-01T00:00:00.000Z'),
    primaryMotivation: null,
    resourceLevel: null,
    sophistication: null,
    objective: null,
    labels: [],
  },
  aliases: [],
  secondaryMotivations: [],
  goals: [],
  threatActorTypes: [],
  roles: [],
  attributions: [],
  locations: [{
    ...relMeta,
    stixId: 'location--france',
    stixRelationId: 'relationship--french-actor-france',
    name: 'France',
    country: 'France',
    producerStixId: 'identity--mandiant',
    producerName: 'Mandiant',
    isInferred: false,
  }],
  sectors: [],
  cves: [],
  techniques: [],
};

// Every write is the admin's and happens once: the service account only reads, or is refused.
describe('Service account reads of tenant data (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let serviceAccount: Awaited<ReturnType<typeof createServiceAccountClient>>;
  let securityServiceAccount: Awaited<ReturnType<typeof createServiceAccountClient>>;
  let adminOrigin: EventOrigin;
  let organizationId: string;
  let scenarioId: string;
  let analysisId: string;
  let planId: string;
  let mfaId: string;
  let addedTechniqueId: string;
  let assetId: string;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    const scoped = services.withOrigin(adminOrigin);
    serviceAccount = await createServiceAccountClient(server, services, adminOrigin);
    securityServiceAccount = await createServiceAccountClient(server, services, adminOrigin);
    const securityRoleId = uuidv7();
    await scoped.roles.createRole({ id: securityRoleId, name: 'Security' });
    await scoped.roles.addCapabilityToRole(securityRoleId, Capability_ManageSecurity);
    const securityGroupId = uuidv7();
    await scoped.groups.createGroup({ id: securityGroupId, name: 'Security' });
    await scoped.groups.addRoleToGroup(securityGroupId, securityRoleId);
    await scoped.serviceAccounts.addGroupToServiceAccount(securityServiceAccount.serviceAccountId, securityGroupId);

    const countries = await scoped.countries.getCountries();
    organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'France scope' }]);
    await scoped.organizations.updateOrganization(organizationId, { countryId: countries.find((country) => country.name === 'France')!.id });

    const ransomwareId = deriveSeedId(setup.tenantId, AttackOutcome_Ransomware);
    scenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: scenarioId,
      organizationId,
      name: 'Ransomware',
      description: null,
      attackOutcomeId: ransomwareId,
      primaryAssetIds: [],
    });

    await scoped.threatAnalyses.ingestBundle([actorTargetingFrance], setup.tenantId, 'stix-import');
    await recomputeAttackOutcomeMixtures(services, setup.tenantId);
    [{ id: analysisId }] = await db.select({ id: threatAnalyses.id }).from(threatAnalyses).where(eq(threatAnalyses.name, 'french-actor'));

    const capabilities = await scoped.controlCapabilities.getControlCapabilities();
    mfaId = capabilities.find((capability) => capability.externalId === 'IDP')!.id;
    await scoped.controlCapabilities.upsertAssessment(mfaId, 'L2', 'L2', null);

    // A technique of the scenario's outcome the catalogue does not give MFA, so only the tenant's
    // override links the two.
    const mfaEdges = new Set((await scoped.controlCapabilities.getControlCapability(mfaId))!.edges.map((edge) => edge.techniqueId));
    const outcomeTechniques = await db.select({ id: attackOutcomeMitreTechniques.mitreTechniqueId })
      .from(attackOutcomeMitreTechniques)
      .where(eq(attackOutcomeMitreTechniques.attackOutcomeId, ransomwareId));
    addedTechniqueId = outcomeTechniques.find((technique) => !mfaEdges.has(technique.id))!.id;
    await scoped.controlCapabilities.addTechnique(mfaId, addedTechniqueId, 'prevent');

    assetId = uuidv7();
    await scoped.supportingAssets.createSupportingAsset({
      id: assetId, name: 'Core DB', description: null, ownerId: null, exposure: 'internal', categoryId: 'host', criticality: 'high',
    });

    planId = await scoped.treatmentPlans.createTreatmentPlan({ organizationId, name: 'Harden MFA' });

    await scoped.crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 1500 });
  });

  it.each([
    ['findingScore.getFindingsPanelCounts', () => ({})],
    ['findingScore.getTopVulnerabilities', () => ({})],
    ['findingScore.listScoredFindings', () => ({ page: 1, limit: 10 })],
    ['findingScore.getTechniqueTestPosture', () => ({})],
    ['threats.getDetail', () => ({ id: analysisId })],
    ['threats.getOutcomeScoresForAnalysis', () => ({ analysisId })],
    ['threats.getRelevantForScenario', () => ({ scenarioId })],
    ['threats.getByCveId', () => ({ cveId: 'CVE-2021-44228' })],
    ['dashboard.getMostActiveThreats', () => ({})],
    ['dashboard.getTenantHomeDashboard', () => undefined],
    ['riskScenarios.getControlCapabilitiesForRiskScenario', () => ({ riskScenarioId: scenarioId })],
    ['controlCapabilities.getCapabilityEvents', () => ({ capabilityId: mfaId })],
    ['controlCapabilities.getEffectivenessHistory', () => ({ capabilityId: mfaId })],
    ['controlCapabilities.getResolvedControlPosture', () => ({ organizationId })],
    ['controlValidation.getControlValidation', () => ({ capabilityId: mfaId })],
    ['controlValidation.getControlValidationEvidence', () => ({ capabilityId: mfaId })],
    ['controlValidation.listControlValidationEvidence', () => ({ capabilityId: mfaId })],
    ['controlValidation.listControlValidationEvidenceTechniques', () => ({ capabilityId: mfaId })],
    ['controlValidation.getProvenPostureHistory', () => ({ capabilityId: mfaId })],
    ['supportingAssets.getProtectingControls', () => ({ supportingAssetId: assetId })],
    ['treatmentPlans.getTreatmentPlanCandidates', () => ({ planId })],
  ])('should answer %s', async (path, input) => {
    const res = await serviceAccount.query(path, input());
    expect(res.json.error).toBeUndefined();
    expect(res.status).toBe(200);
  });

  it('should read the capability assessments a member of the tenant reads', async () => {
    const res = await serviceAccount.query('controlCapabilities.getControlCapabilities');
    const mfa = res.json.result.data.find((capability: { id: string }) => capability.id === mfaId);
    expect(mfa.assessment).toMatchObject({ strengthRung: 'L2', coverageBucket: 'L2' });
  });

  it('should read a control’s detail with the tenant’s assessment and technique overrides', async () => {
    const res = await serviceAccount.query('controlCapabilities.getControlCapability', { id: mfaId });
    const capability = res.json.result.data;
    expect(capability.assessment).toMatchObject({ strengthRung: 'L2', coverageBucket: 'L2' });
    expect(capability.edges).toContainEqual(expect.objectContaining({ techniqueId: addedTechniqueId, function: 'prevent', source: 'tenant', state: 'added' }));
  });

  it('should read the controls of a technique with the tenant’s overrides and assessments', async () => {
    const res = await serviceAccount.query('controlCapabilities.getCapabilitiesForTechnique', { techniqueId: addedTechniqueId });
    expect(res.json.result.data).toContainEqual(expect.objectContaining({
      id: mfaId,
      source: 'tenant',
      state: 'added',
      assessment: expect.objectContaining({ strengthRung: 'L2', coverageBucket: 'L2' }),
    }));
  });

  it('should link a control to the scenarios its tenant override reaches, as a member of the tenant reads them', async () => {
    const res = await serviceAccount.query('controlCapabilities.getControlCapabilityRiskScenarios', { id: mfaId });
    const memberRead = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilityRiskScenarios(mfaId);
    expect(memberRead.map((scenario) => scenario.id)).toContain(scenarioId);
    expect(res.json.result.data).toEqual(memberRead);
  });

  it('should read the tenant’s CRQ indicator settings, not the defaults, with MANAGE_SECURITY', async () => {
    const res = await securityServiceAccount.query('crqIndicatorSettings.getCrqIndicatorSettings');
    expect(res.json.result.data.iterations).toBe(1500);
  });

  it('should refuse the CRQ indicator settings with FORBIDDEN without MANAGE_SECURITY', async () => {
    const res = await serviceAccount.query('crqIndicatorSettings.getCrqIndicatorSettings');
    expect(res.status).toBe(403);
    expect(res.json.error.data.code).toBe('FORBIDDEN');
  });

  it.each([
    ['controlCapabilities.upsertAssessment', () => ({ capabilityId: mfaId, strengthRung: 'L3', coverageBucket: 'L3', comment: null })],
    ['controlCapabilities.declareScopeControlPosture', () => ({ organizationId, capabilityId: mfaId, strengthRung: 'L3', coverageBucket: null, comment: null })],
    ['controlCapabilities.clearScopeControlPosture', () => ({ organizationId, capabilityId: mfaId, dimension: 'strength' })],
    ['controlCapabilities.addTechniqueOverride', () => ({ capabilityId: mfaId, techniqueId: addedTechniqueId, function: 'detect' })],
    ['controlCapabilities.removeTechnique', () => ({ capabilityId: mfaId, techniqueId: addedTechniqueId, function: 'prevent' })],
    ['controlCapabilities.restoreTechnique', () => ({ capabilityId: mfaId, techniqueId: addedTechniqueId, function: 'prevent' })],
    ['controlCapabilities.resetTechniqueOverrides', () => ({ capabilityId: mfaId, function: 'prevent' })],
    ['dashboard.setTenantHomeDashboard', () => ({ dashboardId: 'risk-sankey' })],
    ['cwe.addTechnique', () => ({ cweId: 'CWE-79', techniqueId: addedTechniqueId })],
    ['cwe.removeTechnique', () => ({ cweId: 'CWE-79', techniqueId: addedTechniqueId })],
    ['cwe.restoreTechnique', () => ({ cweId: 'CWE-79', techniqueId: addedTechniqueId })],
    ['cwe.reset', () => ({ cweId: 'CWE-79' })],
    ['organizations.setOrganizationPinned', () => ({ id: organizationId, pinned: false })],
  ])('should refuse %s with FORBIDDEN rather than a server error', async (path, input) => {
    const res = await serviceAccount.mutation(path, input());
    expect(res.status).toBe(403);
    expect(res.json.error.data.code).toBe('FORBIDDEN');
  });

  it('should leave the declaration a refused write named untouched', async () => {
    await serviceAccount.mutation('controlCapabilities.upsertAssessment', { capabilityId: mfaId, strengthRung: 'L3', coverageBucket: 'L3', comment: null });

    const [row] = await db.select().from(controlCapabilityAssessments).where(eq(controlCapabilityAssessments.capabilityId, mfaId));
    expect(row).toMatchObject({ strengthRung: 'L2', coverageBucket: 'L2' });
  });
});
