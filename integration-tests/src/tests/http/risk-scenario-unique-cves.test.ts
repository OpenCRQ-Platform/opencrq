import type { EventOrigin } from '@app/module';
import { attackOutcomeMixtures, crqCveWhatIfResults, cve, PRICE_RUN_PROFILE, supportToPrimaryLinks, TECHNIQUE_T1003 } from '@app/module';
import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { DISMISSED_FLAW, EXPOSED_ESTATE, LATER_LISTED_FLAW, LOG4SHELL, MINOR_FLAW, recomputeFindingScores, runAttackRun, seedAttackRunScenario, seedOutdatedCveRun, UNKNOWN_EXPOSURE_FLAW } from '../../helpers/attack-run-scenario';
import { createTenant } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

interface UniqueCve {
  cveId: string,
  gain: { state: string, mean?: number, p10?: number | null, p90?: number | null },
}

const services = createTestServices(db);

const openTenant = async () => {
  await truncateAllTables(db);
  const client = createTrpcTestClient(await getTestServer());
  const adminId = uuidv7();
  await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
  const tenantId = await createTenant(services, adminId);
  const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };
  await services.withOrigin(origin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 100 });
  return { client, adminId, tenantId, origin };
};

/**
 * The CVEs a risk scenario's Findings tab lists, with what fixing each is worth. The estate is the
 * risk scope's, not the blast radius of the scenario, and the gain is read from the run that
 * computed the CVE values. Every describe builds its fixture once, since its tests only read.
 */
describe('Risk scenario unique CVEs (HTTP/tRPC)', () => {
  describe('after a full run', () => {
    let client: ReturnType<typeof createTrpcTestClient>;
    let tenantId: string;
    let otherTenantId: string;
    let origin: EventOrigin;
    let riskScenarioId: string;
    let fullRunId: string;
    let webServerIds: Array<string>;

    const list = async (input: Record<string, unknown> = {}) => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId, ...input }, { tenantId });
      expect(res.status).toBe(200);
      return res.json.result.data;
    };

    beforeAll(async () => {
      let adminId: string;
      ({ client, tenantId, origin, adminId } = await openTenant());
      const seeded = await seedAttackRunScenario(services, origin, tenantId, EXPOSED_ESTATE);
      riskScenarioId = seeded.riskScenarioId;
      webServerIds = ['Web server 1', 'Web server 2'].map((name) => seeded.assetIdByName.get(name)!);
      ({ runId: fullRunId } = await runAttackRun(services, origin, riskScenarioId, tenantId));
      await services.withOrigin(origin).supportingAssets.createEvidence({
        id: uuidv7(),
        supportingAssetId: webServerIds[0],
        mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'prevention',
        userId: adminId,
      });
      await recomputeFindingScores(services, origin);
      otherTenantId = await createTenant(services, adminId);
    }, 600_000);

    it('should read an amount equal to the stored what-if row of the run for a priced CVE', async () => {
      const [stored] = await db
        .select({ mean: crqCveWhatIfResults.aleReductionMean, p10: crqCveWhatIfResults.aleReductionP10, p90: crqCveWhatIfResults.aleReductionP90 })
        .from(crqCveWhatIfResults)
        .innerJoin(cve, eq(cve.id, crqCveWhatIfResults.cveId))
        .where(and(eq(crqCveWhatIfResults.runId, fullRunId), eq(cve.cveId, LOG4SHELL.cveId)));
      expect(stored.mean).toBeGreaterThan(0);

      const { items } = await list();

      const log4shell = items.find((item: UniqueCve) => item.cveId === LOG4SHELL.cveId);
      expect(log4shell.gain).toEqual({ state: 'amount', mean: stored.mean, p10: stored.p10, p90: stored.p90 });
    });

    it('should read the latest run\'s mean annual loss as the baseline the gain is a share of', async () => {
      const { baselineAle } = await list();

      const latest = await client.query('crqIndicators.getLatestRun', { riskScenarioId }, { tenantId });
      expect(baselineAle).toBe(latest.json.result.data.aleMean);
    });

    it('should read not-priced for a CVE at the base threat, which no run prices', async () => {
      const { items } = await list();

      expect(items.find((item: UniqueCve) => item.cveId === MINOR_FLAW.cveId).gain).toEqual({ state: 'not-priced' });
    });

    it('should sort by gain by default, a CVE with no amount last whichever way it runs', async () => {
      const names = (items: Array<UniqueCve>) => items.map((item) => item.cveId);

      expect(names((await list()).items)).toEqual([LOG4SHELL.cveId, MINOR_FLAW.cveId]);
      expect(names((await list({ sortBy: 'gain', sortDesc: false })).items)).toEqual([LOG4SHELL.cveId, MINOR_FLAW.cveId]);
      expect(names((await list({ sortBy: 'name', sortDesc: true })).items)).toEqual([MINOR_FLAW.cveId, LOG4SHELL.cveId]);
    });

    it('should list the CVEs of assets the scope holds that no primary asset of the scenario depends on', async () => {
      expect(await db.select().from(supportToPrimaryLinks).where(inArray(supportToPrimaryLinks.supportingAssetId, webServerIds))).toEqual([]);

      const { items, total } = await list();

      expect(total).toBe(2);
      expect(items.map((item: UniqueCve) => item.cveId).toSorted()).toEqual([LOG4SHELL.cveId, MINOR_FLAW.cveId]);
    });

    it('should leave out a technique finding of the scope, which is no CVE', async () => {
      const { items, total } = await list();

      expect(total).toBe(2);
      expect(items.map((item: UniqueCve) => item.cveId).toSorted()).toEqual([LOG4SHELL.cveId, MINOR_FLAW.cveId]);
    });

    it('should answer NOT_FOUND to another tenant for a scenario it does not hold', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId: otherTenantId });

      expect(res.status).toBe(404);
      expect(res.json.error.data.code).toBe('NOT_FOUND');
    });

    describe('the Findings page', () => {
      it('should still refuse to sort by gain, which only a scenario naming a run can', async () => {
        const res = await client.query('findingScore.listUniqueFindings', { sortBy: 'gain' }, { tenantId });

        expect(res.status).toBe(400);
        expect(res.json.error.data.code).toBe('BAD_REQUEST');
      });

      it('should keep its rows free of the gain figures and the CVE reference', async () => {
        const { items, total } = await services.withOrigin(origin).findingScore.listUniqueFindings({
          page: 1, limit: 50, source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
        });

        expect(total).toBeGreaterThan(0);
        for (const item of items) {
          expect(Object.keys(item).filter((key) => key.startsWith('gain') || key === 'cveRef')).toEqual([]);
        }
      });
    });
  });

  describe('once a price run follows the run that computed the CVE values', () => {
    let client: ReturnType<typeof createTrpcTestClient>;
    let tenantId: string;
    let riskScenarioId: string;

    beforeAll(async () => {
      let origin: EventOrigin;
      ({ client, tenantId, origin } = await openTenant());
      ({ riskScenarioId } = await seedAttackRunScenario(services, origin, tenantId, EXPOSED_ESTATE));
      await runAttackRun(services, origin, riskScenarioId, tenantId);
      await runAttackRun(services, origin, riskScenarioId, tenantId, PRICE_RUN_PROFILE);
      // The minor flaw gains a signal the run that priced the CVEs did not see.
      await db.update(cve)
        .set({ kev: true, kevUpdatedAt: new Date() })
        .where(and(eq(cve.tenantId, tenantId), eq(cve.cveId, MINOR_FLAW.cveId)));
      await recomputeFindingScores(services, origin);
    }, 600_000);

    it('should read changed-since for a CVE with no row that fills the pricing condition today', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.status).toBe(200);
      const { items } = res.json.result.data;
      expect(items.find((item: UniqueCve) => item.cveId === MINOR_FLAW.cveId).gain).toEqual({ state: 'changed-since' });
    });

    it('should keep the amount of a CVE the older run priced', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      const log4shell = res.json.result.data.items.find((item: UniqueCve) => item.cveId === LOG4SHELL.cveId);
      expect(log4shell.gain.state).toBe('amount');
    });
  });

  describe('once the pricing condition is read as of today, over a run that a later one outdated', () => {
    let client: ReturnType<typeof createTrpcTestClient>;
    let tenantId: string;
    let origin: EventOrigin;
    let riskScenarioId: string;

    const gains = async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });
      expect(res.status).toBe(200);
      return new Map<string, UniqueCve['gain']>(res.json.result.data.items.map((item: UniqueCve) => [item.cveId, item.gain]));
    };

    beforeAll(async () => {
      ({ client, tenantId, origin } = await openTenant());
      ({ riskScenarioId } = await seedOutdatedCveRun(services, origin, tenantId));
    }, 600_000);

    it('should read changed-since for a flaw a CISA listing gave the threat since the run', async () => {
      expect((await gains()).get(LATER_LISTED_FLAW.cveId)).toEqual({ state: 'changed-since' });
    });

    it('should read changed-since for a flaw under the threat floor that an actor of the mixture cites', async () => {
      expect((await gains()).get(MINOR_FLAW.cveId)).toEqual({ state: 'changed-since' });
    });

    it('should keep the amount the older run stored for the flaw it priced', async () => {
      expect((await gains()).get(LOG4SHELL.cveId)?.state).toBe('amount');
    });

    it('should read not-priced for a flaw whose only opening sits on an asset of unknown exposure, which the tenant counts as internal', async () => {
      expect((await gains()).get(UNKNOWN_EXPOSURE_FLAW.cveId)).toEqual({ state: 'not-priced' });
    });

    it('should read not-priced for a flaw whose only opening is on a dismissed finding', async () => {
      expect((await gains()).get(DISMISSED_FLAW.cveId)).toEqual({ state: 'not-priced' });
    });

    it('should read changed-since for the unknown-exposure flaw once the tenant counts unknown as internet-facing', async () => {
      await services.withOrigin(origin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });

      expect((await gains()).get(UNKNOWN_EXPOSURE_FLAW.cveId)).toEqual({ state: 'changed-since' });
    });

    it('should not say the mixture is pending while the job has stored it', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.json.result.data.mixturePending).toBe(false);
    });

    // Last of the describe: it deletes the stored mixture the tests above read.
    it('should say the mixture is pending, the flaw only an actor cites then unknown, once the stored mixture is gone', async () => {
      await db.delete(attackOutcomeMixtures).where(eq(attackOutcomeMixtures.tenantId, tenantId));

      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.json.result.data.mixturePending).toBe(true);
      expect((await gains()).get(MINOR_FLAW.cveId)).toEqual({ state: 'not-priced' });
    });
  });

  describe('in a closed risk scope', () => {
    let client: ReturnType<typeof createTrpcTestClient>;
    let tenantId: string;
    let riskScenarioId: string;

    beforeAll(async () => {
      let origin: EventOrigin;
      ({ client, tenantId, origin } = await openTenant());
      const seeded = await seedAttackRunScenario(services, origin, tenantId, EXPOSED_ESTATE);
      riskScenarioId = seeded.riskScenarioId;
      // Web server 2, which carries the minor flaw, stays outside the mapping.
      await services.withOrigin(origin).organizations.updateOrganization(seeded.organizationId, {
        estateMode: 'closed',
        mapping: { added: [seeded.assetIdByName.get('Web server 1')!, seeded.assetIdByName.get('Crown jewel 1')!], removed: [] },
      });
      await recomputeFindingScores(services, origin);
    }, 600_000);

    it('should list the CVEs of the mapped assets and not those of an asset the scope does not map', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.status).toBe(200);
      const { items, total } = res.json.result.data;
      expect(items.map((item: UniqueCve) => item.cveId)).toEqual([LOG4SHELL.cveId]);
      expect(total).toBe(1);
    });

    it('should read not-computed for every CVE before any full run has computed the CVE values', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.status).toBe(200);
      const { items } = res.json.result.data;
      expect(items.map((item: UniqueCve) => item.gain)).toEqual([{ state: 'not-computed' }]);
    });

    it('should not say the mixture is pending before any run while the job has stored it', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.json.result.data.mixturePending).toBe(false);
    });

    // Last of the describe: it deletes the stored mixture the tests above read.
    it('should say the mixture is pending before any run once the stored mixture is gone', async () => {
      await db.delete(attackOutcomeMixtures).where(eq(attackOutcomeMixtures.tenantId, tenantId));

      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.json.result.data.mixturePending).toBe(true);
    });
  });

  describe('for a scenario whose run had no annual loss exposure', () => {
    let client: ReturnType<typeof createTrpcTestClient>;
    let tenantId: string;
    let riskScenarioId: string;

    beforeAll(async () => {
      let origin: EventOrigin;
      ({ client, tenantId, origin } = await openTenant());
      ({ riskScenarioId } = await seedAttackRunScenario(services, origin, tenantId, { ...EXPOSED_ESTATE, tef: false }));
      await runAttackRun(services, origin, riskScenarioId, tenantId);
    }, 600_000);

    it('should read no-ale for every CVE, the priced ones included', async () => {
      const res = await client.query('riskScenarios.listUniqueCvesForRiskScenario', { riskScenarioId }, { tenantId });

      expect(res.status).toBe(200);
      const { items, baselineAle } = res.json.result.data;
      expect(baselineAle).toBeNull();
      expect(items.map((item: UniqueCve) => item.cveId)).toContain(LOG4SHELL.cveId);
      expect(new Set(items.map((item: UniqueCve) => item.gain.state))).toEqual(new Set(['no-ale']));
    });
  });
});
