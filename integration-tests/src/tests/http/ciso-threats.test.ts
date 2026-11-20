import type { EventOrigin, ParsedThreatInput } from '@app/module';
import {
  AttackOutcome_Espionage,
  AttackOutcome_Ransomware,
  crqIndicatorRuns,
  crqTechniqueWhatIfResults,
  deriveSeedId,
  mitreTechniques,
  THREAT_RELEVANCE_DEFAULTS,
  threatAnalyses,
} from '@app/module';
import { eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { ESPIONAGE_DESCRIPTION, RANSOMWARE_DESCRIPTION, readStoredProbability } from '../../helpers/threat-analyses-fixtures';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const DAY_MS = 24 * 60 * 60 * 1000;

const relMeta = { relCreated: null, relStartTime: null, relStopTime: null, relModified: null, relConfidence: THREAT_RELEVANCE_DEFAULTS.confidenceGate };

const actorTargeting = (slug: string, country: string, description: string | null): ParsedThreatInput => ({
  threat: {
    stixId: `intrusion-set--${slug}`,
    entityType: 'intrusion-set',
    name: slug,
    description,
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
    stixId: `location--${country.toLowerCase()}`,
    stixRelationId: `relationship--${slug}-${country.toLowerCase()}`,
    name: country,
    country,
    producerStixId: 'identity--mandiant',
    producerName: 'Mandiant',
    isInferred: false,
  }],
  sectors: [],
  cves: [],
  techniques: [],
});

// The data is read-only once seeded, so it is seeded once for the whole file.
describe('CISO threats endpoints (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let anonymous: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let franceScopeId: string;
  let techniqueIdByExternalId: Map<string, string>;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    anonymous = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Threats Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };
    const scoped = services.withOrigin(origin);

    const countries = await scoped.countries.getCountries();
    const countryId = (name: string) => countries.find((country) => country.name === name)!.id;

    franceScopeId = uuidv7();
    const germanyScopeId = uuidv7();
    await scoped.organizations.createOrganizations([
      { id: franceScopeId, name: 'France scope' },
      { id: germanyScopeId, name: 'Germany scope' },
    ]);
    await scoped.organizations.updateOrganization(franceScopeId, { countryId: countryId('France') });
    await scoped.organizations.updateOrganization(germanyScopeId, { countryId: countryId('Germany') });

    const scenario = async (organizationId: string, name: string, attackOutcome: string) => {
      const id = uuidv7();
      await scoped.riskScenarios.createRiskScenario({
        id, organizationId, name, description: null, attackOutcomeId: deriveSeedId(tenantId, attackOutcome), primaryAssetIds: [],
      });
      return id;
    };
    const ransomwareId = await scenario(franceScopeId, 'Ransomware', AttackOutcome_Ransomware);
    // A threat leads to the outcomes its record describes, wherever it targets: the French scope
    // holds three ransomware scenarios, the German one an espionage scenario.
    const plantId = await scenario(franceScopeId, 'Ransomware on the plant', AttackOutcome_Ransomware);
    await scenario(franceScopeId, 'Ransomware on the cloud', AttackOutcome_Ransomware);
    const germanEspionageId = await scenario(germanyScopeId, 'German espionage', AttackOutcome_Espionage);

    await scoped.threatAnalyses.ingestBundle([
      actorTargeting('quiet-french-actor', 'France', RANSOMWARE_DESCRIPTION),
      actorTargeting('loud-french-actor', 'France', RANSOMWARE_DESCRIPTION),
      actorTargeting('a-undated-french-actor', 'France', RANSOMWARE_DESCRIPTION),
      actorTargeting('german-actor', 'Germany', ESPIONAGE_DESCRIPTION),
      // No description: nothing says what it is after, so no scenario selects it.
      actorTargeting('brazilian-actor', 'Brazil', null),
    ], tenantId, 'stix-import');
    expect(await readStoredProbability(db, 'intrusion-set--loud-french-actor', deriveSeedId(tenantId, AttackOutcome_Ransomware))).toBeGreaterThan(0.5);
    expect(await readStoredProbability(db, 'intrusion-set--german-actor', deriveSeedId(tenantId, AttackOutcome_Espionage))).toBeGreaterThan(0.5);
    const activity = async (name: string, activityScore: number) => db.update(threatAnalyses)
      .set({ activityScore, lastObservedAt: new Date() })
      .where(eq(threatAnalyses.name, name));
    await activity('quiet-french-actor', 0.2);
    await activity('loud-french-actor', 0.9);
    await activity('german-actor', 0.5);

    const techniques = await db.select({ id: mitreTechniques.id, externalId: mitreTechniques.externalId })
      .from(mitreTechniques)
      .where(inArray(mitreTechniques.externalId, ['T1566', 'T1486']));
    techniqueIdByExternalId = new Map(techniques.map((technique) => [technique.externalId, technique.id]));

    const run = async (riskScenarioId: string, ageDays: number, values: Array<[string, number, number]>) => {
      const runId = uuidv7();
      await db.insert(crqIndicatorRuns).values({
        id: runId,
        riskScenarioId,
        createdAt: new Date(Date.now() - ageDays * DAY_MS),
        iterations: 1000,
        vulnerabilityP5: 0.1,
        vulnerabilityP50: 0.2,
        vulnerabilityP95: 0.3,
        lefMean: 1,
        aleMean: 100_000,
        aleP10: 50_000,
        aleP90: 200_000,
        techniqueCount: 2,
        coveredTechniqueCount: 1,
      });
      await db.insert(crqTechniqueWhatIfResults).values(values.map(([externalId, preventValueMean, detectValueMean]) => ({
        id: uuidv7(), runId, mitreTechniqueId: techniqueIdByExternalId.get(externalId)!, preventValueMean, detectValueMean,
      })));
    };
    await run(ransomwareId, 1, [['T1566', 1_000, 400], ['T1486', 0, 0]]);
    await run(plantId, 30, [['T1566', 99_000, 99_000]]);
    await run(plantId, 1, [['T1566', 500, 100]]);
    await run(germanEspionageId, 1, [['T1566', 7_000, 3_000]]);
  }, 600_000);

  describe('dashboard.getMostActiveThreats', () => {
    it('should rank a scope\'s threats by activity, each once with its scenario count', async () => {
      const res = await client.query('dashboard.getMostActiveThreats', { organizationId: franceScopeId }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([
        expect.objectContaining({ name: 'loud-french-actor', entityType: 'intrusion-set', lastObservedAt: expect.any(String), scenarioCount: 3 }),
        expect.objectContaining({ name: 'quiet-french-actor', scenarioCount: 3 }),
        expect.objectContaining({ name: 'a-undated-french-actor', activityScore: null, lastObservedAt: null, scenarioCount: 3 }),
      ]);
    });

    it('should rank an undated threat after the dated ones, even when its name sorts first', async () => {
      const res = await client.query('dashboard.getMostActiveThreats', { organizationId: franceScopeId }, { tenantId });

      expect(res.json.result.data.map((row: { name: string }) => row.name)).toEqual([
        'loud-french-actor',
        'quiet-french-actor',
        'a-undated-french-actor',
      ]);
    });

    it('should read every scope\'s scenarios at tenant level', async () => {
      const res = await client.query('dashboard.getMostActiveThreats', {}, { tenantId });

      expect(res.json.result.data.map((row: { name: string, scenarioCount: number }) => [row.name, row.scenarioCount])).toEqual([
        ['loud-french-actor', 3],
        ['german-actor', 1],
        ['quiet-french-actor', 3],
        ['a-undated-french-actor', 3],
      ]);
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query('dashboard.getMostActiveThreats', {}, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('dashboard.getTechniqueGains', () => {
    type Tactic = { name: string, techniques: Array<{ externalId: string, prevention: number, detection: number, total: number }> };

    const techniquesOf = (tactics: Array<Tactic>, tacticName: string) =>
      tactics.find((tactic) => tactic.name === tacticName)!.techniques;

    it('should sum each lever over the latest run of each of the scope\'s scenarios', async () => {
      const res = await client.query('dashboard.getTechniqueGains', { organizationId: franceScopeId }, { tenantId });

      expect(res.status).toBe(200);
      expect(techniquesOf(res.json.result.data, 'Initial Access')).toEqual([
        expect.objectContaining({ externalId: 'T1566', prevention: 1_500, detection: 500, total: 2_000 }),
      ]);
      expect(techniquesOf(res.json.result.data, 'Impact')).toEqual([
        expect.objectContaining({ externalId: 'T1486', prevention: 0, detection: 0, total: 0 }),
      ]);
    });

    it('should read every scope\'s runs at tenant level', async () => {
      const res = await client.query('dashboard.getTechniqueGains', {}, { tenantId });

      expect(techniquesOf(res.json.result.data, 'Initial Access')).toEqual([
        expect.objectContaining({ externalId: 'T1566', prevention: 8_500, detection: 3_500, total: 12_000 }),
      ]);
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query('dashboard.getTechniqueGains', {}, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });
});
