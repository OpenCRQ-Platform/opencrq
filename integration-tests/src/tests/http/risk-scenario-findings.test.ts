import type { EventOrigin, ParsedThreatInput } from '@app/module';
import { assetEvidenceHistory, AttackOutcome_Ransomware, cve, deriveSeedId, THREAT_RELEVANCE_DEFAULTS } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAXIMAL_CVSS_VECTOR } from '../../helpers/finding-score-fixtures';
import { recomputePrimaryAssetReach } from '../../helpers/primary-asset-reach';
import { RANSOMWARE_DESCRIPTION } from '../../helpers/threat-analyses-fixtures';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const TARGETED_CVE_ID = 'CVE-2021-44228';

// This suite is about ranking exploiting actors, not about the gate, so its claims state a
// confidence the shipped gate admits.
const relMeta = { producerStixId: 'identity--test-producer', producerName: 'Test Producer', isInferred: false, relCreated: null, relStartTime: null, relStopTime: null, relModified: null, relConfidence: THREAT_RELEVANCE_DEFAULTS.confidenceGate };

const buildThreat = (params: {
  name: string,
  targetsSector: boolean,
  cveIds: Array<string>,
}): ParsedThreatInput => ({
  threat: {
    stixId: `intrusion-set--${params.name.toLowerCase().replace(/[^a-z]/g, '-')}`,
    entityType: 'intrusion-set',
    name: params.name,
    description: RANSOMWARE_DESCRIPTION,
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
  locations: [{ ...relMeta, stixId: `location--france--${params.name}`, stixRelationId: `relationship--france--${params.name}`, name: 'France', country: 'France' }],
  sectors: params.targetsSector
    ? [{ ...relMeta, stixId: `identity--defense--${params.name}`, stixRelationId: `relationship--defense--${params.name}`, name: 'Defense' }]
    : [],
  cves: params.cveIds.map((cveId, index) => ({
    ...relMeta,
    stixId: `vulnerability--${params.name}--${index}`,
    stixRelationId: `relationship--${params.name}--${index}`,
    cveId,
  })),
  techniques: [],
});

describe('Risk scenario findings (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let origin: EventOrigin;
  let organizationId: string;
  let attackOutcomeId: string;
  let riskScenarioId: string;
  let supportingAssetId: string;
  let evidenceId: string;
  let adminId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Findings Tenant' }, adminId);

    origin = { type: 'client', userId: adminId, tenantId };
    const scoped = services.withOrigin(origin);

    const countries = await scoped.countries.getCountries();
    const sectors = await scoped.sectors.getSectors();
    const france = countries.find((c) => c.name === 'France')!;
    const defense = sectors.find((s) => s.name === 'Defense')!;

    organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Findings Org' }]);
    await scoped.organizations.updateOrganization(organizationId, { countryId: france.id, sectorId: defense.id });

    const primaryAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Core Banking', description: null, ownerId: null, businessValueCategoryIds: [],
    });
    supportingAssetId = uuidv7();
    await scoped.supportingAssets.createSupportingAsset({
      id: supportingAssetId, name: 'Log Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });
    await scoped.assetDependencies.createSupportToPrimaryLinks([{
      id: uuidv7(), supportingAssetId, primaryAssetId,
    }]);

    const cveUuid = uuidv7();
    await db.insert(cve).values([{
      id: cveUuid, tenantId, cveId: TARGETED_CVE_ID.toLowerCase(), cvss: 10, cvssVector: MAXIMAL_CVSS_VECTOR, epss: 0.97, kev: true, kevUpdatedAt: new Date(),
    }]);
    evidenceId = uuidv7();
    await scoped.supportingAssets.createEvidence({
      id: evidenceId, supportingAssetId, cve: { rowId: cveUuid }, userId: adminId,
    });

    attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_Ransomware);
    riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Log server compromise',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [primaryAssetId],
    });

    await scoped.threatAnalyses.ingestBundle([
      buildThreat({ name: 'Broad Actor', targetsSector: false, cveIds: [TARGETED_CVE_ID] }),
      buildThreat({ name: 'Focused Actor', targetsSector: true, cveIds: [TARGETED_CVE_ID, TARGETED_CVE_ID] }),
      buildThreat({ name: 'Unrelated Actor', targetsSector: true, cveIds: ['CVE-2019-19781'] }),
    ], tenantId, 'stix-import');
    await recomputePrimaryAssetReach(services, tenantId);
  });

  it('should rank exploiting threat actors by relevance and list each of them once', async () => {
    const res = await client.query('riskScenarios.listFindingsForRiskScenario', { riskScenarioId, state: 'all' }, { tenantId });

    expect(res.status).toBe(200);
    const findings = res.json.result.data.items;
    expect(findings).toHaveLength(1);
    expect(findings[0].supportingAssetId).toBe(supportingAssetId);
    expect(findings[0].pathCount).toBe(1);
    expect(findings[0].exploitedBy.map((threat: { name: string }) => threat.name))
      .toEqual(['Focused Actor', 'Broad Actor']);
  });

  it('should leave the score reading empty on a finding no recompute has scored yet', async () => {
    const res = await client.query('riskScenarios.listFindingsForRiskScenario', { riskScenarioId, state: 'all' }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.items[0]).toMatchObject({
      score: null, band: null, assetCategoryId: null, sources: null, lastEvaluatedAt: null, firstSeenAt: null,
    });
  });

  it('should carry the score, the band and the asset type of a scored finding', async () => {
    await services.withOrigin(origin).findingScore.recomputeFindingScores();

    const res = await client.query('riskScenarios.listFindingsForRiskScenario', { riskScenarioId, state: 'all' }, { tenantId });

    expect(res.status).toBe(200);
    const [finding] = res.json.result.data.items;
    expect(finding.score).toEqual(expect.any(Number));
    expect(finding.band).toEqual(expect.any(String));
    expect(finding.assetCategoryId).toBe('host');
    expect(finding.sources).toEqual([]);
    expect(finding.firstSeenAt).not.toBeNull();
  });

  it('should name what dismissed a finding: a sync, or a person and the type they filed it under', async () => {
    const retiredAt = new Date();
    await db.insert(assetEvidenceHistory).values({
      id: uuidv7(), tenantId, assetEvidenceId: evidenceId, state: 'dismissed', stateChangedAt: retiredAt, observedAt: retiredAt, reason: 'No longer reported by Microsoft Defender', origin: 'no_longer_reported',
    });
    const retired = await client.query('riskScenarios.listFindingsForRiskScenario', { riskScenarioId, state: 'all' }, { tenantId });

    await services.withOrigin(origin).supportingAssets.dismissEvidence({
      evidenceId, dismissalType: 'risk_accepted', reasonCode: 'wont_fix', reason: 'Accepted', changedByUserId: adminId,
    });
    const setAside = await client.query('riskScenarios.listFindingsForRiskScenario', { riskScenarioId, state: 'all' }, { tenantId });

    expect(retired.json.result.data.items[0]).toMatchObject({ currentState: 'dismissed', stateOrigin: 'no_longer_reported', dismissalType: null });
    expect(setAside.json.result.data.items[0]).toMatchObject({ currentState: 'dismissed', stateOrigin: 'user', dismissalType: 'risk_accepted' });
  });

  it('should return an empty threat list for a scenario with no findings', async () => {
    const emptyScenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: emptyScenarioId,
      organizationId,
      name: 'Scenario without assets',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });

    const res = await client.query('riskScenarios.listFindingsForRiskScenario', { riskScenarioId: emptyScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({ items: [], total: 0 });
  });

  it('should name the threats exploiting the findings the overview puts first', async () => {
    const res = await client.query('riskScenarios.getFindingsSummaryForRiskScenario', { riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.counts.total).toBe(1);
    expect(res.json.result.data.top[0].exploitedBy.map((threat: { name: string }) => threat.name))
      .toEqual(['Focused Actor', 'Broad Actor']);
  });
});
