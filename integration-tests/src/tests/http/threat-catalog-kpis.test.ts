import { STRONG_OUTCOME_MATCH_SCORE, THREAT_RELEVANCE_DEFAULTS } from '@app/module/client';
import { attackOutcomes, cve, threatAnalyses, threatAnalysisCves, threatOutcomeScores, uniqueFindingScores } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { signInAsFirstAdmin } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

const ADMIN_EMAIL = 'admin@test.com';
const BELOW_GATE = THREAT_RELEVANCE_DEFAULTS.confidenceGate - 1;

type CveClaim = string | { cveId: string, relConfidence: number };

describe('threats.getCatalogKpis (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;
  let otherTenantId: string;
  const caseTenantIds = new Map<string, string>();

  const insertOutcome = async (tenant: string): Promise<string> => {
    const id = uuidv7();
    await db.insert(attackOutcomes).values([{ id, tenantId: tenant, name: `Outcome ${id}`, description: null, referenceDwellDays: 7 }]);
    return id;
  };

  const insertThreat = async (
    tenant: string,
    options: { scores?: Array<{ outcomeId: string, score: number, isTop: boolean }>, cves?: Array<CveClaim> },
  ): Promise<void> => {
    const id = uuidv7();
    await db.insert(threatAnalyses).values([{
      id, tenantId: tenant, stixId: `intrusion-set--${id}`, entityType: 'intrusion-set', kind: 'connector', name: `Threat ${id}`, markingRefs: [],
    }]);
    if (options.scores?.length) {
      await db.insert(threatOutcomeScores).values(options.scores.map(({ outcomeId, score, isTop }) => ({
        analysisId: id, attackOutcomeId: outcomeId, tenantId: tenant, score, isTop,
      })));
    }
    if (options.cves?.length) {
      await db.insert(threatAnalysisCves).values(options.cves.map((claim) => {
        const { cveId, relConfidence } = typeof claim === 'string' ? { cveId: claim, relConfidence: null } : claim;
        return { id: uuidv7(), analysisId: id, stixId: `vulnerability--${uuidv7()}`, stixRelationId: `relationship--${uuidv7()}`, cveId, relConfidence };
      }));
    }
  };

  const insertCve = async (tenant: string, cveId: string, uniqueFindingIn: 'estate' | 'organization' | 'nowhere'): Promise<void> => {
    const id = uuidv7();
    await db.insert(cve).values([{ id, tenantId: tenant, cveId, epss: null, kev: null }]);
    if (uniqueFindingIn === 'nowhere') {
      return;
    }
    let organizationId: string | null = null;
    if (uniqueFindingIn === 'organization') {
      organizationId = uuidv7();
      await services.withOrigin({ type: 'client', userId: adminId, tenantId: tenant })
        .organizations.createOrganizations([{ id: organizationId, name: `Scope ${organizationId}` }]);
    }
    await db.insert(uniqueFindingScores).values([{
      id: uuidv7(), tenantId: tenant, organizationId, cveId: id, score: 50, band: 'medium', worstScore: 50, affectedAssetCount: 1, firstSeenAt: new Date(),
    }]);
  };

  const createTenant = async (name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id, name }, adminId);
    return id;
  };

  const kpisOf = async (tenant: string) => (await client.query('threats.getCatalogKpis', undefined, { tenantId: tenant })).json.result.data;

  beforeAll(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = await createTenant('Catalog Tenant');
    otherTenantId = await createTenant('Other Tenant');

    const [first, second] = [await insertOutcome(tenantId), await insertOutcome(tenantId)];
    await insertThreat(tenantId, { scores: [{ outcomeId: first, score: STRONG_OUTCOME_MATCH_SCORE, isTop: true }], cves: ['CVE-2026-0701', 'CVE-2026-0702'] });
    await insertThreat(tenantId, { scores: [{ outcomeId: first, score: STRONG_OUTCOME_MATCH_SCORE - 0.0001, isTop: true }], cves: ['CVE-2026-0701'] });
    await insertThreat(tenantId, {
      scores: [{ outcomeId: second, score: 0.9, isTop: true }, { outcomeId: first, score: 0.7, isTop: false }],
    });
    await insertThreat(tenantId, {});
    await insertCve(tenantId, 'CVE-2026-0701', 'estate');
    await insertCve(tenantId, 'CVE-2026-0702', 'nowhere');
    await insertCve(tenantId, 'CVE-2026-0704', 'estate');

    const otherOutcome = await insertOutcome(otherTenantId);
    await insertThreat(otherTenantId, { scores: [{ outcomeId: otherOutcome, score: 0.95, isTop: true }], cves: ['CVE-2026-0701'] });
    await insertCve(otherTenantId, 'CVE-2026-0701', 'estate');
    await insertCve(otherTenantId, 'CVE-2026-0702', 'estate');

    const cases: Array<[string, Array<CveClaim>, Array<[string, 'estate' | 'organization' | 'nowhere']>]> = [
      ['spelling', [' cve-2026-0701 ', 'CVE-2026-0701'], [['CVE-2026-0701', 'estate']]],
      ['organization', ['CVE-2026-0707'], [['CVE-2026-0707', 'organization']]],
      ['uncatalogued', ['CVE-2026-0705'], []],
      ['gated', [{ cveId: 'CVE-2026-0706', relConfidence: BELOW_GATE }], [['CVE-2026-0706', 'estate']]],
    ];
    for (const [name, claims, cves] of cases) {
      const id = await createTenant(`${name} Tenant`);
      caseTenantIds.set(name, id);
      await insertThreat(id, { cves: claims });
      for (const [cveId, uniqueFindingIn] of cves) {
        await insertCve(id, cveId, uniqueFindingIn);
      }
    }
  }, 600_000);

  it('should count once each threat whose top outcome match reaches the strong threshold, the threshold itself included', async () => {
    expect((await kpisOf(tenantId)).strongOutcomeMatches).toBe(2);
  });

  it('should count the targeted CVEs the estate holds a unique finding for, leaving out the absent ones and the ones no threat targets', async () => {
    expect(await kpisOf(tenantId)).toMatchObject({ targetedCves: 2, targetedCvesOnEstate: 1 });
  });

  it('should serve the catalog volumes beside the counts', async () => {
    expect(await kpisOf(tenantId)).toMatchObject({ threatActors: 0, intrusionSets: 4, campaigns: 0 });
  });

  it('should count only the threats and the estate of the tenant named', async () => {
    expect(await kpisOf(otherTenantId)).toMatchObject({ intrusionSets: 1, strongOutcomeMatches: 1, targetedCves: 1, targetedCvesOnEstate: 1 });
  });

  it('should count each stored spelling of a CVE id apart, as the list\'s CVE column does, on the estate only where that spelling has a unique finding', async () => {
    expect(await kpisOf(caseTenantIds.get('spelling')!)).toMatchObject({ targetedCves: 2, targetedCvesOnEstate: 1 });
  });

  it('should not count on the estate a CVE whose only unique finding belongs to a risk scope', async () => {
    expect(await kpisOf(caseTenantIds.get('organization')!)).toMatchObject({ targetedCves: 1, targetedCvesOnEstate: 0 });
  });

  it('should count as targeted but not on the estate a CVE the tenant has no catalogue row for', async () => {
    expect(await kpisOf(caseTenantIds.get('uncatalogued')!)).toMatchObject({ targetedCves: 1, targetedCvesOnEstate: 0 });
  });

  it('should count neither way a CVE claimed below the confidence gate', async () => {
    expect(await kpisOf(caseTenantIds.get('gated')!)).toMatchObject({ targetedCves: 0, targetedCvesOnEstate: 0 });
  });
});
