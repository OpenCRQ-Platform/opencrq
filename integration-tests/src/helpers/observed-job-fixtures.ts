import type { DrizzleDB, EventOrigin } from '@app/module';
import {
  assetEvidence,
  assetEvidenceHistory,
  assetEvidenceVerdicts,
  AttackOutcome_DataBreachResale,
  AttackOutcome_ServiceDisruption,
  BUNDLED_CATALOGS,
  BUNDLED_CONTROL_LINKS,
  BusinessValueCategory_PersonalData,
  controlCapabilityAssessments,
  controlCapabilityAssessmentSources,
  cve,
  deriveSeedId,
  LossDriver_ForensicsIncidentManagement,
  openctiStreamObjects,
  originUserId,
  storedFiles,
  TECHNIQUE_T1003,
  TECHNIQUE_T1027,
  threatAnalyses,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { TestServices } from '../setup/test-context';
import { seedAttackRunScenario } from './attack-run-scenario';
import { FULLY_ANSWERED_PROFILE_ANSWERS } from './financial-profile-answers';
import { DISRUPTION_DESCRIPTION, MALWARE_BY_OUTCOME } from './threat-analyses-fixtures';

export interface ObservedJobFixtureContext {
  services: TestServices,
  db: DrizzleDB,
  tenantId: string,
  adminOrigin: EventOrigin,
}

/**
 * Seeds the estate a job's run has to take every branch on. The drift guard runs every registered
 * observed job over its fixture and refuses a kind without one.
 */
export type ObservedJobFixture = (ctx: ObservedJobFixtureContext) => Promise<void>;

const scoringEstate: ObservedJobFixture = async ({ services, db, tenantId, adminOrigin }) => {
  const assetId = uuidv7();
  await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
    id: assetId,
    name: 'Observed asset',
    description: null,
    ownerId: null,
    exposure: 'internet_facing',
    categoryId: 'host',
    criticality: 'high',
  });
  const cveId = uuidv7();
  // A weakness class, so the run also reads the tenant's weakness link.
  await db.insert(cve).values([{ id: cveId, tenantId, cveId: 'CVE-2024-0001', epss: 0.5, kev: true, kevUpdatedAt: new Date(), cwe: ['CWE-287'] }]);
  await db.insert(assetEvidence).values([{ id: uuidv7(), supportingAssetId: assetId, tenantId, cveId }]);
  // A technique finding beside the CVE one, which the run never scores and only clears.
  await db.insert(assetEvidence).values([{
    id: uuidv7(),
    supportingAssetId: assetId,
    tenantId,
    mitreTechniqueId: TECHNIQUE_T1003,
    expectationType: 'prevention',
    evaluatedAt: new Date(),
  }]);
};

/**
 * One actor carrying a claim of each of the four collections: an observed window, an authoring date
 * alone, and a claim under the default gate, so the run walks every branch of the fold.
 */
const threatEstate: ObservedJobFixture = async ({ services, tenantId, adminOrigin }) => {
  const provenance = { producerStixId: 'identity--observed', producerName: 'Observed Producer', isInferred: false };
  const relation = { ...provenance, relCreated: new Date('2024-01-10T00:00:00.000Z'), relStartTime: null, relStopTime: null, relModified: null };
  await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([{
    threat: {
      stixId: 'intrusion-set--0bserved-0000-0000-0000-000000000001',
      entityType: 'intrusion-set',
      name: 'Observed Actor',
      description: DISRUPTION_DESCRIPTION,
      mitreGroupId: 'G9001',
      confidence: 80,
      stixCreated: new Date('2023-01-01T00:00:00.000Z'),
      firstSeen: null,
      lastSeen: new Date('2024-06-01T00:00:00.000Z'),
      primaryMotivation: 'organizational-gain',
      resourceLevel: 'organization',
      sophistication: null,
      objective: null,
      labels: [],
    },
    malware: MALWARE_BY_OUTCOME[AttackOutcome_ServiceDisruption],
    aliases: ['Observed Group'],
    secondaryMotivations: [],
    goals: [],
    threatActorTypes: [],
    roles: [],
    attributions: [],
    locations: [{ ...relation, relStopTime: new Date('2025-11-01T00:00:00.000Z'), stixId: 'location--fr', stixRelationId: 'relationship--observed-location', name: 'France', country: 'France', relConfidence: 90 }],
    sectors: [{ ...relation, stixId: 'identity--sector', stixRelationId: 'relationship--observed-sector', name: 'Finance', relConfidence: 90 }],
    cves: [{ ...relation, stixId: 'vulnerability--observed', stixRelationId: 'relationship--observed-cve', cveId: 'CVE-2024-0001', relConfidence: 30 }],
    techniques: [{ ...relation, stixId: 'attack-pattern--observed', stixRelationId: 'relationship--observed-technique', name: 'Network Denial of Service', mitreExternalId: 'T1498', relConfidence: null }],
  }], tenantId, 'stix-import');
};

const financialEstimatesRecomputeEstate: ObservedJobFixture = async ({ services, tenantId, adminOrigin }) => {
  const organizationId = uuidv7();
  await services.withOrigin(adminOrigin).organizations.createOrganizations([
    { id: organizationId, name: 'Observed organization' },
  ]);
  await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { employeeCount: 150 });

  const attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_DataBreachResale);
  const riskScenarioId = uuidv7();
  await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
    id: riskScenarioId,
    organizationId,
    name: 'Observed scenario',
    description: null,
    attackOutcomeId,
    primaryAssetIds: [],
  });

  const personalDataId = deriveSeedId(tenantId, BusinessValueCategory_PersonalData);
  const primaryAssetId = uuidv7();
  await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
    id: primaryAssetId,
    organizationId,
    name: 'Observed asset',
    description: null,
    ownerId: null,
    businessValueCategoryIds: [personalDataId],
  });
  await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(riskScenarioId, {
    primaryAssetIds: [primaryAssetId],
  });

  await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, FULLY_ANSWERED_PROFILE_ANSWERS);
};

/**
 * Two analyses scored under no model: one the mirror holds, unmarked, which the run marks, and one
 * it does not, which sends the run to the tenant's stored file. Ingestion would leave both current.
 */
const threatOutcomeCounterEstate: ObservedJobFixture = async ({ services, db, tenantId, adminOrigin }) => {
  const mirroredStixId = 'intrusion-set--0bserved-counter-000-000000000001';
  const unmirroredStixId = 'intrusion-set--0bserved-counter-000-000000000002';
  const entry = (stixId: string, name: string) => ({
    threat: {
      stixId,
      entityType: 'intrusion-set' as const,
      name,
      description: null,
      mitreGroupId: null,
      confidence: 80,
      stixCreated: new Date('2023-01-01T00:00:00.000Z'),
      firstSeen: null,
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
    locations: [],
    sectors: [],
    cves: [],
    techniques: [],
    malware: [],
    reports: [],
  });
  await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
    entry(mirroredStixId, 'Observed Counter Mirrored'),
    entry(unmirroredStixId, 'Observed Counter Unmirrored'),
  ], tenantId, 'stix-import');
  await db.update(threatAnalyses).set({ outcomeModelVersion: null }).where(eq(threatAnalyses.tenantId, tenantId));

  await services.withOrigin(adminOrigin).openctiConnector.upsertStreamObject(tenantId, mirroredStixId, 'intrusion-set', {
    id: mirroredStixId, type: 'intrusion-set', name: 'Observed Counter Mirrored', confidence: 80,
  });
  await db.update(openctiStreamObjects).set({ pending: false }).where(eq(openctiStreamObjects.tenantId, tenantId));

  await db.insert(storedFiles).values([{
    id: uuidv7(),
    tenantId,
    storageKey: uuidv7(),
    originalName: 'observed-bundle.json',
    mimeType: 'application/json',
    sizeBytes: 2,
    createdBy: originUserId(adminOrigin) ?? null,
  }]);
};

/**
 * A configured connector and a marked mirror carrying one of each shape the batch resolves through
 * a different hop, plus a tombstoned actor so the run also takes the retraction branch.
 */
const openctiMirrorEstate: ObservedJobFixture = async ({ services, tenantId, adminOrigin }) => {
  const scoped = services.withOrigin(adminOrigin);
  const serviceAccountId = uuidv7();
  await scoped.serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Observed stream bot' });
  await scoped.openctiConnector.configure(tenantId, serviceAccountId, 'observed-stream');

  const actorStixId = 'intrusion-set--0bserved-mirror-0000-000000000001';
  const goneStixId = 'intrusion-set--0bserved-mirror-0000-000000000002';
  const producerStixId = 'identity--0bserved-mirror-0000-000000000003';
  const techniqueStixId = 'attack-pattern--0bserved-mirror-0000-000000000004';
  const usesStixId = 'relationship--0bserved-mirror-0000-000000000005';

  await scoped.openctiConnector.upsertStreamObject(tenantId, producerStixId, 'identity', {
    id: producerStixId, type: 'identity', name: 'Observed Intel', identity_class: 'organization',
  });
  await scoped.openctiConnector.upsertStreamObject(tenantId, techniqueStixId, 'attack-pattern', {
    id: techniqueStixId,
    type: 'attack-pattern',
    name: 'Phishing',
    external_references: [{ source_name: 'mitre-attack', external_id: 'T1566' }],
  });
  for (const [stixId, name] of [[actorStixId, 'Observed Mirror Actor'], [goneStixId, 'Observed Mirror Ghost']]) {
    await scoped.openctiConnector.upsertStreamObject(tenantId, stixId, 'intrusion-set', {
      id: stixId,
      type: 'intrusion-set',
      name,
      created: '2024-01-01T00:00:00.000Z',
      last_seen: '2024-06-01T00:00:00.000Z',
      confidence: 80,
      created_by_ref: producerStixId,
    });
  }
  await scoped.openctiConnector.upsertStreamObject(tenantId, usesStixId, 'relationship', {
    id: usesStixId,
    type: 'relationship',
    relationship_type: 'uses',
    source_ref: actorStixId,
    target_ref: techniqueStixId,
    created: '2024-02-01T00:00:00.000Z',
    confidence: 90,
    created_by_ref: producerStixId,
  });
  await scoped.openctiConnector.deleteStreamObject(tenantId, goneStixId);
};

/**
 * A Drata mirror and a published assessment reaching IDP, so the run pools both sources and writes;
 * a control derived from the assessments alone that nothing feeds any more, so it clears a row; and
 * one derived on strength alone beside a declared coverage, so it clears a single axis.
 */
const capabilityDerivationEstate: ObservedJobFixture = async ({ services, db, tenantId, adminOrigin }) => {
  const scoped = services.withOrigin(adminOrigin);
  const serviceAccountId = uuidv7();
  await scoped.serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Observed Drata bot' });
  await scoped.integrationSettings.configureIntegration('drata', serviceAccountId);
  await services.withOrigin({ type: 'connector', serviceAccountId, tenantId }).drata.replaceMirror({
    syncedAt: new Date(),
    frameworks: [],
    controls: ['DCF-58', 'DCF-67'].map((code) => ({
      drataId: Number(code.slice(4)), code, name: code, description: null,
      isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: true, archivedAt: null,
    })),
  });

  const capabilityIds = new Map((await scoped.controlCapabilities.getControlCapabilities())
    .map((capability) => [capability.externalId, capability.id]));
  const [nistCsf] = BUNDLED_CATALOGS;
  const assessmentId = await scoped.complianceAssessments.createAssessment({ name: 'Observed assessment', frameworkId: nistCsf.framework.id });
  const idpRequirements = (BUNDLED_CONTROL_LINKS.get(nistCsf.framework.id) ?? [])
    .filter((link) => link.capabilityId === capabilityIds.get('IDP'));
  for (const link of idpRequirements) {
    await scoped.complianceAssessments.answerRequirement({
      assessmentId, requirementId: link.requirementId, ownerId: null, dueDate: null, level: 3, notApplicable: false, comment: null, updatedAt: null,
    });
  }
  await scoped.complianceAssessments.publishAssessment(assessmentId);

  for (const [externalId, coverageMode] of [['DECEP', 'auto'], ['WAF', 'manual']] as const) {
    const id = uuidv7();
    await db.insert(controlCapabilityAssessments).values([{
      id,
      capabilityId: capabilityIds.get(externalId)!,
      tenantId,
      strengthRung: 'L2',
      coverageBucket: 'L2',
      strengthMode: 'auto',
      coverageMode,
      coverageBasis: coverageMode === 'auto' ? 'assumed' : 'declared',
    }]);
    await db.insert(controlCapabilityAssessmentSources).values([
      { assessmentId: id, tenantId, axis: 'strength', source: 'nist-csf-2.0' },
      ...(coverageMode === 'auto' ? [{ assessmentId: id, tenantId, axis: 'coverage' as const, source: 'nist-csf-2.0' }] : []),
    ]);
  }
};

/**
 * A `very_high` identity assigned to a device, so the run computes a lift, writes it and reprojects
 * the device rather than only reading the relations.
 */
const criticalityLiftEstate: ObservedJobFixture = async ({ services, tenantId, adminOrigin }) => {
  const serviceAccountId = uuidv7();
  await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Observed Defender Bot' });
  await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
  const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
  const connector = services.withOrigin({ type: 'connector', serviceAccountId, tenantId });
  const idMap = await connector.supportingAssets.bulkUpsertAssets([
    { sourceAssetId: 'obj-observed', categoryId: 'identity', connectorId, source: 'microsoft_graph', name: 'Observed admin', criticality: 'very_high', properties: { family: 'identity', directoryObjectId: 'obj-observed' } },
    { sourceAssetId: 'dev-observed', categoryId: 'host', connectorId, source: 'microsoft_graph', name: 'Observed laptop', properties: { family: 'machine', hostname: 'observed-laptop', directoryDeviceId: 'aad-observed' } },
  ]);
  await connector.supportingAssets.reconcileConnectorRelations({
    connectorId,
    kind: 'primary_user_of',
    observedAt: new Date(),
    relations: [{ fromAssetId: idMap.get('obj-observed')!, toAssetId: idMap.get('dev-observed')!, source: 'entra_registered_owner' }],
    retiredIds: [],
  });
};

/** A primary asset linked to one asset that another provides for, so the run walks a level and writes both rows. */
const primaryAssetReachEstate: ObservedJobFixture = async ({ services, adminOrigin }) => {
  const scoped = services.withOrigin(adminOrigin);
  const organizationId = uuidv7();
  await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Observed organization' }]);
  const primaryAssetId = uuidv7();
  await scoped.primaryAssets.createPrimaryAsset({
    id: primaryAssetId,
    organizationId,
    name: 'Observed primary asset',
    description: null,
    ownerId: null,
    businessValueCategoryIds: [],
  });
  const [direct, provider] = [uuidv7(), uuidv7()];
  for (const [id, name] of [[direct, 'Observed front'], [provider, 'Observed provider']]) {
    await scoped.supportingAssets.createSupportingAsset({
      id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host', criticality: 'unknown',
    });
  }
  await scoped.assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: direct, primaryAssetId }]);
  await scoped.assetDependencies.createSupportToSupportLinks([{ id: uuidv7(), dependentAssetId: direct, providerAssetId: provider }]);
};

/** A bound OpenAEV to pass the gate, and a measured result inside a closed scope, so the run replays a past and derives a scope of its own. */
const provenPostureEstate: ObservedJobFixture = async ({ services, db, tenantId, adminOrigin }) => {
  const scoped = services.withOrigin(adminOrigin);
  const serviceAccountId = uuidv7();
  await scoped.serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Observed OpenAEV bot' });
  await scoped.integrationSettings.configureIntegration('openaev', serviceAccountId);
  const assetId = uuidv7();
  await scoped.supportingAssets.createSupportingAsset({
    id: assetId,
    name: 'Observed workstation',
    description: null,
    ownerId: null,
    exposure: 'unknown',
    categoryId: 'host',
    criticality: 'unknown',
  });
  const evidenceId = uuidv7();
  const measuredAt = new Date(Date.now() - 3 * 86_400_000);
  await db.insert(assetEvidence).values([{
    id: evidenceId,
    supportingAssetId: assetId,
    tenantId,
    mitreTechniqueId: TECHNIQUE_T1027,
    expectationType: 'prevention',
    securityPlatformType: 'EDR',
    sourceScenarioId: 'observed-scenario',
    evaluatedAt: measuredAt,
  }]);
  await db.insert(assetEvidenceHistory).values([{
    id: uuidv7(),
    tenantId,
    assetEvidenceId: evidenceId,
    state: 'dismissed',
    stateChangedAt: measuredAt,
    observedAt: measuredAt,
    origin: 'not_exposed',
  }]);
  await db.insert(assetEvidenceVerdicts).values([{
    id: uuidv7(),
    tenantId,
    assetEvidenceId: evidenceId,
    isExposed: false,
    observedAt: measuredAt,
    recordedAt: measuredAt,
  }]);
  const organizationId = uuidv7();
  await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Observed scope' }]);
  await scoped.organizations.updateOrganization(organizationId, { estateMode: 'closed', mapping: { added: [assetId], removed: [] } });
};

/**
 * A priced scenario with a declared TEF, and a sibling on the same scope left on the automatic one,
 * so the pass walks both TEF branches and writes the automatic estimate it then reads back.
 */
const crqPriceEstate: ObservedJobFixture = async ({ services, tenantId, adminOrigin }) => {
  const scoped = services.withOrigin(adminOrigin);
  await scoped.crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 50 });
  // One control only: the scenario's default posture, half the catalogue, contests every playable pair
  // and leaves the pass no reach gap to write.
  const { organizationId, attackOutcomeId, primaryAssetId } = await seedAttackRunScenario(services, adminOrigin, tenantId, { posture: false });
  const edr = (await scoped.controlCapabilities.getControlCapabilities()).find((capability) => capability.externalId === 'EDR')!;
  await scoped.controlCapabilities.upsertAssessment(edr.id, 'L2', 'L2', null);
  const siblingId = uuidv7();
  await scoped.riskScenarios.createRiskScenario({
    id: siblingId,
    organizationId,
    name: 'Ransomware at the automatic frequency',
    description: null,
    attackOutcomeId,
    primaryAssetIds: [primaryAssetId],
  });
  // A scenario without a loss estimate is run in full whatever profile asked for it, and a full run
  // prices the plans: the sibling is priceable, so that the pass is the price profile's alone.
  await scoped.scenarioLossEstimates.upsertScenarioLossEstimates(siblingId, [
    { lossDriverId: deriveSeedId(tenantId, LossDriver_ForensicsIncidentManagement), action: 'set', minValue: 50_000, likelyValue: 200_000, maxValue: 800_000 },
  ], { maxUpdatedAt: null, rowCount: 0 });
};

/** A rule on the host category and one host it matches, so the pass writes a rule link. */
const dependencyRulesEstate: ObservedJobFixture = async ({ services, adminOrigin }) => {
  const scoped = services.withOrigin(adminOrigin);
  const organizationId = uuidv7();
  await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Observed organization' }]);
  const primaryAssetId = uuidv7();
  await scoped.primaryAssets.createPrimaryAsset({
    id: primaryAssetId,
    organizationId,
    name: 'Observed primary asset',
    description: null,
    ownerId: null,
    businessValueCategoryIds: [],
  });
  await scoped.supportingAssets.createSupportingAsset({
    id: uuidv7(), name: 'Observed host', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host', criticality: 'unknown',
  });
  await scoped.assetDependencies.createDependencyRule({
    name: 'Observed hosts',
    primaryAssetId,
    roles: ['processes'],
    enabled: true,
    categoryId: 'host',
    subcategoryId: null,
    namePattern: null,
    namePatternKind: null,
    tagId: null,
    source: null,
  });
};

/** The actor's description and malware lead the outcome counter past 0.5 on Service Disruption, so the scenario's pair weighs a group. */
const attackOutcomeMixtureEstate: ObservedJobFixture = async (ctx) => {
  const { services, tenantId, adminOrigin } = ctx;
  await threatEstate(ctx);
  const organizationId = uuidv7();
  await services.withOrigin(adminOrigin).organizations.createOrganizations([
    { id: organizationId, name: 'Observed organization' },
  ]);
  await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
    id: uuidv7(),
    organizationId,
    name: 'Observed scenario',
    description: null,
    attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_ServiceDisruption),
    primaryAssetIds: [],
  });
};

export const OBSERVED_JOB_FIXTURES: Record<string, ObservedJobFixture> = {
  'capability-derivation': capabilityDerivationEstate,
  'finding-score-recompute': scoringEstate,
  'proven-posture-record': provenPostureEstate,
  'threat-activity-recompute': threatEstate,
  'threat-outcome-counter-recompute': threatOutcomeCounterEstate,
  'threat-list-projection-recompute': threatEstate,
  'financial-estimates-recompute': financialEstimatesRecomputeEstate,
  'asset-criticality-lift-recompute': criticalityLiftEstate,
  'primary-asset-reach-recompute': primaryAssetReachEstate,
  'attack-outcome-mixture-recompute': attackOutcomeMixtureEstate,
  'opencti-mirror-rebuild': openctiMirrorEstate,
  'crq-price-recompute': crqPriceEstate,
  'dependency-rules-apply': dependencyRulesEstate,
};
