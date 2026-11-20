import type { ParsedThreatInput } from '@app/module';
import { THREAT_RELEVANCE_DEFAULTS } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const THIRTY_DAYS_MS = 30 * 86_400_000;
const TARGETED_CVE_ID = 'CVE-2024-9100';

// This suite is about anchor provenance, not about the gate, so its claims state a confidence the
// shipped gate admits.
const relMeta = { producerStixId: 'identity--test-producer', producerName: 'Test Producer', isInferred: false, relCreated: null, relStartTime: null, relStopTime: null, relModified: null, relConfidence: THREAT_RELEVANCE_DEFAULTS.confidenceGate };

// Every parent temporal signal removed (`lastSeen: null`) so the location stop time is the only
// anchor, which pins the expected grade to `observed`.
const buildThreat = (relStopTime: Date | null, identity = { suffix: 'anchor-provenance', name: 'Anchor Provenance Actor', mitreGroupId: 'G9999' }): ParsedThreatInput => ({
  threat: {
    stixId: `intrusion-set--${identity.suffix}`,
    entityType: 'intrusion-set',
    name: identity.name,
    description: null,
    mitreGroupId: identity.mitreGroupId,
    confidence: 80,
    stixCreated: new Date('2024-01-01T00:00:00.000Z'),
    firstSeen: null,
    lastSeen: null,
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
  locations: [{ ...relMeta, stixId: `location--${identity.suffix}`, stixRelationId: `relationship--france-${identity.suffix}`, name: 'France', country: 'France', relStopTime }],
  sectors: [],
  cves: [{ ...relMeta, stixId: 'vulnerability--targeted', stixRelationId: `relationship--targeted-${identity.suffix}`, cveId: TARGETED_CVE_ID }],
  techniques: [],
});

describe('Intrusion set analyses (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let adminId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Intrusion Set Tenant' }, adminId);

    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .threatAnalyses.ingestBundle([buildThreat(new Date(Date.now() - THIRTY_DAYS_MS))], tenantId, 'stix-import');
    await services.withOrigin({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: true })
      .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
  });

  // The router output schemas strip unknown keys, so the activity grade only reaches consumers if
  // `activityFields` declares it. Asserting it over HTTP is what a service-level test cannot do.
  it('should expose the anchor provenance on list and getByCveId', async () => {
    const list = await client.query('threats.list', {}, { tenantId });

    expect(list.status).toBe(200);
    expect(list.json.result.data.items).toHaveLength(1);
    expect(list.json.result.data.items[0].anchorProvenance).toBe('observed');

    const byCve = await client.query('threats.getByCveId', { cveId: TARGETED_CVE_ID }, { tenantId });

    expect(byCve.status).toBe(200);
    expect(byCve.json.result.data[0].anchorProvenance).toBe('observed');
  });

  describe('sorting on the last observation', () => {
    const SEVEN_DAYS_MS = 7 * 86_400_000;

    beforeEach(async () => {
      const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });
      await scoped.threatAnalyses.ingestBundle([
        buildThreat(new Date(Date.now() - SEVEN_DAYS_MS), { suffix: 'recent', name: 'Recent Actor', mitreGroupId: 'G9001' }),
        buildThreat(null, { suffix: 'undated', name: 'Undated Actor', mitreGroupId: 'G9002' }),
      ], tenantId, 'stix-import');
      await services.withOrigin({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: true })
        .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
    });

    const namesSortedBy = async (sortDesc: boolean): Promise<Array<string>> => {
      const list = await client.query('threats.list', { sortBy: 'lastObservedAt', sortDesc }, { tenantId });
      expect(list.status).toBe(200);
      return list.json.result.data.items.map((item: { name: string }) => item.name);
    };

    it('should put the most recent observation first when descending, and the undated one last', async () => {
      expect(await namesSortedBy(true)).toEqual(['Recent Actor', 'Anchor Provenance Actor', 'Undated Actor']);
    });

    it('should still sort on the activity score, which XTM One\'s threat list sends', async () => {
      const list = await client.query('threats.list', { sortBy: 'activityScore', sortDesc: true }, { tenantId });

      expect(list.status).toBe(200);
      expect(list.json.result.data.items.map((item: { name: string }) => item.name)).toEqual(['Recent Actor', 'Anchor Provenance Actor', 'Undated Actor']);
    });

    it('should put the undated actor last on the activity score when ascending too', async () => {
      const list = await client.query('threats.list', { sortBy: 'activityScore', sortDesc: false }, { tenantId });

      expect(list.status).toBe(200);
      expect(list.json.result.data.items.map((item: { name: string }) => item.name)).toEqual(['Anchor Provenance Actor', 'Recent Actor', 'Undated Actor']);
    });

    it('should expose a null activity score for the undated actor and a number for the dated ones', async () => {
      const list = await client.query('threats.list', { sortBy: 'activityScore', sortDesc: true }, { tenantId });

      expect(list.json.result.data.items.map((item: { name: string, activityScore: number | null }) => [item.name, typeof item.activityScore])).toEqual([
        ['Recent Actor', 'number'],
        ['Anchor Provenance Actor', 'number'],
        ['Undated Actor', 'object'],
      ]);
      expect(list.json.result.data.items[2].activityScore).toBeNull();
    });

    it('should put the oldest observation first when ascending, and still the undated one last', async () => {
      expect(await namesSortedBy(false)).toEqual(['Anchor Provenance Actor', 'Recent Actor', 'Undated Actor']);
    });
  });

  it('should expose the anchor provenance on getDetail', async () => {
    const list = await client.query('threats.list', {}, { tenantId });
    const detail = await client.query('threats.getDetail', { id: list.json.result.data.items[0].id }, { tenantId });

    expect(detail.status).toBe(200);
    expect(detail.json.result.data.activity.anchorProvenance).toBe('observed');
  });

  // XTM One reads this output and its contract is public: the weight and the assumed age belong to
  // the relevance proof and the ranked rows only.
  it('should keep the activity weight and the assumed age out of getDetail', async () => {
    const list = await client.query('threats.list', {}, { tenantId });
    const detail = await client.query('threats.getDetail', { id: list.json.result.data.items[0].id }, { tenantId });

    expect(detail.status).toBe(200);
    expect(detail.json.result.data.activity).not.toHaveProperty('activityWeight');
    expect(detail.json.result.data.activity).not.toHaveProperty('unknownActivityAgeDays');
  });

  describe('deleteImported', () => {
    let threatId: string;

    beforeEach(async () => {
      const list = await client.query('threats.list', {}, { tenantId });
      threatId = list.json.result.data.items[0].id;
    });

    it('should delete an imported threat for a member of its tenant', async () => {
      const res = await client.mutation('threats.deleteImported', [threatId], { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual({ deleted: 1 });
      const list = await client.query('threats.list', {}, { tenantId });
      expect(list.json.result.data.items).toHaveLength(0);
    });

    it('should delete nothing when a member of another tenant names the threat', async () => {
      const outsider = await createUser(db);
      const otherTenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: otherTenantId, name: 'Other tenant' }, adminId);
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId })
        .tenants.addTenantUser(otherTenantId, outsider.userId);
      const outsiderClient = createTrpcTestClient(await getTestServer());
      await signInAs(outsiderClient, outsider.userId);

      const res = await outsiderClient.mutation('threats.deleteImported', [threatId], { tenantId: otherTenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual({ deleted: 0 });
      const list = await client.query('threats.list', {}, { tenantId });
      expect(list.json.result.data.items).toHaveLength(1);
    });

    it.each([
      ['an empty list', []],
      ['an id that is not a UUID', ['not-a-uuid']],
    ])('should refuse %s', async (_label, input) => {
      const res = await client.mutation('threats.deleteImported', input, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should refuse a call that names no tenant', async () => {
      const res = await client.mutation('threats.deleteImported', [threatId]);

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should reject an unauthenticated call', async () => {
      client.clearCookies();

      const res = await client.mutation('threats.deleteImported', [threatId], { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });
});
