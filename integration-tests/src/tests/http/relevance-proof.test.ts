import type { EventOrigin, ParsedThreatInput } from '@app/module';
import { ACTIVITY_HALF_LIFE_DAYS, ACTIVITY_SIGNAL_BASE_WEIGHT, AttackOutcome_Ransomware, deriveSeedId, OUTCOME_COUNTER_VERSION, parseThreatBundle, THREAT_RELEVANCE_DEFAULTS } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_TAU, outcomeWeightOf, RANSOMWARE_DESCRIPTION, readStoredProbability } from '../../helpers/threat-analyses-fixtures';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

const relMeta = { relCreated: null, relStartTime: null, relStopTime: null, relModified: null, relConfidence: THREAT_RELEVANCE_DEFAULTS.confidenceGate };

const buildThreat = (): ParsedThreatInput => ({
  threat: {
    stixId: 'intrusion-set--proof-actor',
    entityType: 'intrusion-set',
    name: 'Proof Actor',
    description: RANSOMWARE_DESCRIPTION,
    mitreGroupId: null,
    confidence: 80,
    stixCreated: new Date('2024-01-01T00:00:00.000Z'),
    firstSeen: new Date('2024-01-01T00:00:00.000Z'),
    lastSeen: new Date('2024-06-01T00:00:00.000Z'),
    primaryMotivation: null,
    resourceLevel: 'government',
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
    stixRelationId: 'relationship--france',
    name: 'France',
    country: 'France',
    producerStixId: 'identity--mandiant',
    producerName: 'Mandiant',
    isInferred: true,
  }],
  sectors: [],
  cves: [],
  techniques: [],
});

// The router output schemas strip unknown keys, so the provenance the panel argues from only
// reaches a reader if the proof schema declares it. Asserting it over HTTP is what a service-level
// test cannot do.
describe('Relevance proof (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let origin: EventOrigin;
  let riskScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Proof Tenant' }, adminId);

    origin = { type: 'client', userId: adminId, tenantId };
    const scoped = services.withOrigin(origin);

    const countries = await scoped.countries.getCountries();
    const sectors = await scoped.sectors.getSectors();
    const france = countries.find((c) => c.name === 'France')!;
    const defense = sectors.find((s) => s.name === 'Defense')!;

    const organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Proof Org' }]);
    await scoped.organizations.updateOrganization(organizationId, { countryId: france.id, sectorId: defense.id });

    const primaryAssetId = uuidv7();
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Trading Platform', description: null, ownerId: null, businessValueCategoryIds: [],
    });

    riskScenarioId = uuidv7();
    await scoped.riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Trading platform outage',
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [primaryAssetId],
    });

    await scoped.threatAnalyses.ingestBundle([buildThreat()], tenantId, 'stix-import');
  });

  it('should carry the resource level on the ranked row', async () => {
    const res = await client.query('threats.getRelevantForScenario', { scenarioId: riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.items[0].resourceLevel).toBe('government');
  });

  it('should carry each claim provenance on the proof', async () => {
    const list = await client.query('threats.getRelevantForScenario', { scenarioId: riskScenarioId }, { tenantId });
    const analysisId = list.json.result.data.items[0].id;

    const res = await client.query('threats.getRelevanceProof', { analysisId, scenarioId: riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    const proof = res.json.result.data;
    expect(proof.gate).toBe(THREAT_RELEVANCE_DEFAULTS.confidenceGate);
    expect(proof.relevance.country.claims[0]).toMatchObject({
      producerName: 'Mandiant',
      producerStixId: 'identity--mandiant',
      isInferred: true,
    });
  });

  describe('activity weight', () => {
    const floorFor = (ageDays: number): number => ACTIVITY_SIGNAL_BASE_WEIGHT * 2 ** (-ageDays / ACTIVITY_HALF_LIFE_DAYS);

    const readProof = async () => {
      const list = await client.query('threats.getRelevantForScenario', { scenarioId: riskScenarioId }, { tenantId });
      const analysisId = list.json.result.data.items[0].id;
      const res = await client.query('threats.getRelevanceProof', { analysisId, scenarioId: riskScenarioId }, { tenantId });
      expect(res.status).toBe(200);
      return res.json.result.data;
    };

    it('should carry the weight of an undated threat and the default assumed age', async () => {
      const proof = await readProof();

      expect(proof.lastObservedAt).toBeNull();
      expect(proof.unknownActivityAgeDays).toBe(THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays);
      expect(proof.activityWeight).toBeCloseTo(floorFor(THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays), 10);
    });

    it('should carry the tenant\'s own assumed age once the setting changes', async () => {
      await services.withOrigin(origin).threatRelevanceSettings
        .updateThreatRelevanceSettings({ ...THREAT_RELEVANCE_DEFAULTS, unknownActivityAgeDays: 90 });

      const proof = await readProof();

      expect(proof.unknownActivityAgeDays).toBe(90);
      expect(proof.activityWeight).toBeCloseTo(floorFor(90), 10);
    });
  });

  describe('last observed via', () => {
    const recompute = async () => services
      .withOrigin({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: false })
      .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });

    const proofVia = async () => {
      const list = await client.query('threats.getRelevantForScenario', { scenarioId: riskScenarioId }, { tenantId });
      const analysisId = list.json.result.data.items[0].id;
      const res = await client.query('threats.getRelevanceProof', { analysisId, scenarioId: riskScenarioId }, { tenantId });
      expect(res.status).toBe(200);
      return res.json.result.data.lastObservedVia;
    };

    const ingestCampaign = async (lastSeen: Date) => services.withOrigin(origin).threatAnalyses.ingestBundle(parseThreatBundle({
      type: 'bundle',
      id: 'bundle--proof-campaign',
      objects: [
        { type: 'campaign', id: 'campaign--proof-ledger', name: 'Operation Proof Ledger', confidence: 80, last_seen: lastSeen.toISOString() },
        {
          type: 'relationship',
          id: 'relationship--proof-campaign-set',
          relationship_type: 'attributed-to',
          source_ref: 'campaign--proof-ledger',
          target_ref: 'intrusion-set--proof-actor',
          confidence: 80,
        },
      ],
    }), tenantId, 'stix-import');

    it('should name the campaign that dated the threat', async () => {
      await ingestCampaign(new Date(Date.now() - 10 * 86_400_000));
      await recompute();

      expect(await proofVia()).toEqual({
        id: expect.any(String),
        name: 'Operation Proof Ledger',
      });
    });

    it('should name no source for a threat dated by itself', async () => {
      await ingestCampaign(new Date('2023-01-01T00:00:00.000Z'));
      await recompute();

      expect(await proofVia()).toBeNull();
    });
  });

  it('should carry the stored percentage, the evidence flag and the model version on the outcome', async () => {
    const list = await client.query('threats.getRelevantForScenario', { scenarioId: riskScenarioId }, { tenantId });
    const analysisId = list.json.result.data.items[0].id;
    const stored = await readStoredProbability(db, 'intrusion-set--proof-actor', deriveSeedId(tenantId, AttackOutcome_Ransomware));

    const res = await client.query('threats.getRelevanceProof', { analysisId, scenarioId: riskScenarioId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.outcome).toEqual({ probability: stored, evidenceSufficient: true, modelVersion: OUTCOME_COUNTER_VERSION, judgedOn: null });
    expect(res.json.result.data.outcome.signals).toBeUndefined();
  });

  it('should score the relevance as the stored percentage\'s weight scaled by the country it targets', async () => {
    const list = await client.query('threats.getRelevantForScenario', { scenarioId: riskScenarioId }, { tenantId });
    const analysisId = list.json.result.data.items[0].id;
    const stored = await readStoredProbability(db, 'intrusion-set--proof-actor', deriveSeedId(tenantId, AttackOutcome_Ransomware));

    const res = await client.query('threats.getRelevanceProof', { analysisId, scenarioId: riskScenarioId }, { tenantId });

    // The organization is French and in Defense; the actor targets France only.
    expect(res.json.result.data.relevance.score).toBeCloseTo((outcomeWeightOf(stored) * 2.5) / MAX_TAU, 10);
    expect(res.json.result.data.relevance.country.matched).toBe(true);
    expect(res.json.result.data.relevance.sector.matched).toBe(false);
  });

  it('should name the organization\'s own value on a dimension that did not match', async () => {
    const list = await client.query('threats.getRelevantForScenario', { scenarioId: riskScenarioId }, { tenantId });
    const analysisId = list.json.result.data.items[0].id;

    const res = await client.query('threats.getRelevanceProof', { analysisId, scenarioId: riskScenarioId }, { tenantId });

    expect(res.json.result.data.relevance.sector).toMatchObject({ matched: false, matchedValue: null, organizationValue: 'Defense' });
    expect(res.json.result.data.relevance.country.organizationValue).toBe('France');
  });

  it('should surface NOT_FOUND when the analysis does not belong to the scenario', async () => {
    const res = await client.query('threats.getRelevanceProof', { analysisId: uuidv7(), scenarioId: riskScenarioId }, { tenantId });

    expect(res.json.error).toBeTruthy();
    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });
});
