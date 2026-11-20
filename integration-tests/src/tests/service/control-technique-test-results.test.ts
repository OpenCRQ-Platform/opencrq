import type { EventOrigin, IntegrationSource, PostureCrossing, TechniqueTestReading } from '@app/module';
import {
  assetEvidence,
  controlStateAt,
  controlTechniqueTestResults,
  controlValidationRepository,
  controlWorldSpec,
  crqIndicatorsRepository,
  DECLARED_LEVER,
  integrationSettings,
  mitreTechniquesData,
  phishingStageNameOf,
  STRENGTH_BY_RUNG,
  supportingAssets,
  supportingAssetSources,
  TECHNIQUE_T1003,
  TECHNIQUE_T1055,
  TECHNIQUE_T1078,
  testedEfficacy,
} from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const techniqueId = (externalId: string): string => mitreTechniquesData.find((technique) => technique.externalId === externalId)!.id;
const TECHNIQUE_T1059 = techniqueId('T1059');
const TECHNIQUE_T1021 = techniqueId('T1021');
const TECHNIQUE_T1046 = techniqueId('T1046');
const TECHNIQUE_T1055_001 = techniqueId('T1055.001');
const TECHNIQUE_T1055_011 = techniqueId('T1055.011');
const TECHNIQUE_T1055_012 = techniqueId('T1055.012');
const TECHNIQUE_T1566 = techniqueId('T1566');
const TECHNIQUE_T1498 = techniqueId('T1498');
const TECHNIQUE_T1498_001 = techniqueId('T1498.001');
const TECHNIQUE_T1566_001 = techniqueId('T1566.001');

interface Result {
  supportingAssetId: string,
  mitreTechniqueId?: string,
  expectationType?: 'detection' | 'prevention',
  securityPlatformType?: string,
  held: boolean,
  at?: Date,
  sourceScenarioId?: string,
}

const insertResult = async ({
  supportingAssetId,
  mitreTechniqueId = TECHNIQUE_T1055,
  expectationType = 'prevention',
  securityPlatformType = 'EDR',
  held,
  at = daysAgo(1),
  sourceScenarioId = 'scenario-1',
  tenantId,
}: Result & { tenantId: string }) => {
  const id = uuidv7();
  await db.insert(assetEvidence).values([{
    id,
    supportingAssetId,
    tenantId,
    mitreTechniqueId,
    expectationType,
    securityPlatformType,
    sourceScenarioId,
    sourceScenarioName: 'Endpoint drill',
    sourceSimulationId: 'simulation-1',
    evaluatedAt: at,
  }]);
  await insertSyncedVerdict(id, held ? 'dismissed' : 'applicable', at);
};

const insertAssets = async (
  tenantId: string,
  count: number,
  { categoryId = 'host', lastSeenAt = daysAgo(2) }: { categoryId?: 'host' | 'identity', lastSeenAt?: Date | null } = {},
): Promise<Array<string>> => {
  const ids = Array.from({ length: count }, () => uuidv7());
  await db.insert(supportingAssets).values(ids.map((id, index) => ({
    id,
    tenantId,
    name: `${categoryId} ${index + 1}`,
    exposure: 'internal' as const,
    categoryId,
    criticality: 'medium' as const,
    lastSeenAt,
  })));
  return ids;
};

const insertConnector = async (tenantId: string, source: IntegrationSource): Promise<string> => {
  const id = uuidv7();
  await db.insert(integrationSettings).values({ id, tenantId, source });
  return id;
};

const reportedBy = async (tenantId: string, supportingAssetId: string, connectorId: string) => {
  await db.insert(supportingAssetSources).values({
    id: uuidv7(),
    supportingAssetId,
    tenantId,
    connectorId,
    sourceAssetId: uuidv7(),
    reportedCategoryId: 'host',
  });
};

describe('per-technique test results', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;
  let edrId: string;
  let hosts: Array<string>;
  let labVms: Array<string>;
  let scopeId: string;

  const scoped = (origin: EventOrigin = adminOrigin) => services.withOrigin(origin);
  const measure = (crossings: ReadonlyArray<PostureCrossing> = []) =>
    scoped().controlValidation.measureTechniqueTestResults({ now: new Date(), crossings });
  const insert = (result: Result) => insertResult({ tenantId, ...result });
  const storedResults = (origin: EventOrigin, mitreTechniqueId: string, level: string | null) =>
    controlValidationRepository.findTechniqueTestResultsOfTechniques(repositoryContextOf(db, origin), [mitreTechniqueId], level);
  const edrResults = async (mitreTechniqueId: string, level: string | null) =>
    (await storedResults(adminOrigin, mitreTechniqueId, level))
      .filter((row) => row.capabilityId === edrId)
      .sort((first, second) => first.function.localeCompare(second.function));
  const edrBooking = async (organizationId: string) => (await db.select().from(controlTechniqueTestResults))
    .filter((row) => row.capabilityId === edrId && row.organizationId === organizationId && row.function === 'prevent' && row.mitreTechniqueId === TECHNIQUE_T1055)
    .map(({ bookedRate, bookedHostsTested, bookedScopeHosts }) => ({ bookedRate, bookedHostsTested, bookedScopeHosts }));
  /** A stored row the derivation would write for a control on a technique it does not cover: one test, failed, on one host of 20. */
  const storeFailedTest = async (
    { mitreTechniqueId, grain, organizationId = null, tenant = tenantId }: { mitreTechniqueId: string, grain: 'technique' | 'sub_technique', organizationId?: string | null, tenant?: string },
  ) => db.insert(controlTechniqueTestResults).values([{
    id: uuidv7(),
    tenantId: tenant,
    capabilityId: edrId,
    organizationId,
    function: 'prevent',
    mitreTechniqueId,
    grain,
    rate: 0,
    tests: 1,
    heldTests: 0,
    hostsTested: 1,
    scopeHosts: 20,
  }]);
  const FAILED_TEST = { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 20, share: 0.05 };
  const capabilityIdOf = async (externalId: string) =>
    (await scoped().controlCapabilities.getControlCapabilities()).find((capability) => capability.externalId === externalId)!.id;
  /** What the engine prices a control at on its phishing stage, at L2 / L2: the stage anchor times the coverage. */
  const engineStageDeclared = (capabilityExternalId: string, stageTechniqueExternalId: string): number =>
    controlStateAt(
      controlWorldSpec({ capabilityExternalId, strengthRung: 'L2', coverageBucket: 'L2' }, { phishingStage: phishingStageNameOf([stageTechniqueExternalId]) }),
      DECLARED_LEVER,
    ).phishingStageEfficacy!;
  /** One stored result of a control at the tenant level: 1 held of 4 tests, on 4 of 20 hosts. */
  const ONE_HELD_OF_FOUR = { rate: 0.25, tests: 4, heldTests: 1, hostsTested: 4, scopeHosts: 20 };
  const storeOneHeldOfFour = (capabilityId: string, mitreTechniqueId: string) => db.insert(controlTechniqueTestResults).values([{
    id: uuidv7(), tenantId, capabilityId, organizationId: null, function: 'prevent', mitreTechniqueId, grain: 'technique', ...ONE_HELD_OF_FOUR,
  }]);
  const engineFigures = (reading: TechniqueTestReading) => ({ efficacy: reading.covered ? reading.efficacy : null, tested: reading.tested });
  const otherTenant = async (): Promise<{ tenantId: string, origin: EventOrigin }> => {
    const otherTenantId = await createTenant(services, adminUserId);
    return { tenantId: otherTenantId, origin: { type: 'client', userId: adminUserId, tenantId: otherTenantId } };
  };

  /** The worked example: 20 hosts, 2 of them lab VMs only OpenAEV knows, which alone were tested on T1003 and T1046 (a detection, the only function EDR scores it on). */
  const insertWorkedExample = async () => {
    for (const [index, supportingAssetId] of hosts.slice(0, 10).entries()) {
      await insert({ supportingAssetId, held: index === 0 });
      await insert({ supportingAssetId, expectationType: 'detection', held: true });
    }
    for (const supportingAssetId of hosts.slice(0, 15)) {
      await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1059, held: true });
    }
    await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1021, held: false });
    for (const supportingAssetId of labVms) {
      await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1003, held: false });
      await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1046, expectationType: 'detection', held: false });
    }
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
    await scoped().crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 90 });
    const capabilities = await scoped().controlCapabilities.getControlCapabilities();
    edrId = capabilities.find((capability) => capability.externalId === 'EDR')!.id;
    hosts = await insertAssets(tenantId, 18);
    labVms = await insertAssets(tenantId, 2);
    const openaevId = await insertConnector(tenantId, 'openaev');
    for (const labVm of labVms) {
      await reportedBy(tenantId, labVm, openaevId);
    }
    scopeId = uuidv7();
    await scoped().organizations.createOrganizations([{ id: scopeId, name: 'Whole estate' }]);
    await scoped().controlCapabilities.upsertAssessment(edrId, 'L2', 'L2', null);
  });

  describe('measuring', () => {
    it('stores the worked example\'s tests, rate, hosts tested and scope hosts, at the tenant level and in each scope', async () => {
      await insertWorkedExample();

      await measure();

      for (const level of [null, scopeId]) {
        expect(await edrResults(TECHNIQUE_T1055, level)).toEqual([
          { capabilityId: edrId, function: 'detect', mitreTechniqueId: TECHNIQUE_T1055, grain: 'technique', rate: 1, tests: 10, heldTests: 10, hostsTested: 10, scopeHosts: 20 },
          { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1055, grain: 'technique', rate: 0.1, tests: 10, heldTests: 1, hostsTested: 10, scopeHosts: 20 },
        ]);
        expect(await edrResults(TECHNIQUE_T1059, level)).toEqual([
          { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1059, grain: 'technique', rate: 1, tests: 15, heldTests: 15, hostsTested: 15, scopeHosts: 20 },
        ]);
        expect(await edrResults(TECHNIQUE_T1021, level)).toEqual([
          { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1021, grain: 'technique', rate: 0, tests: 1, heldTests: 0, hostsTested: 1, scopeHosts: 20 },
        ]);
        expect(await edrResults(TECHNIQUE_T1003, level)).toEqual([
          { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1003, grain: 'technique', rate: 0, tests: 2, heldTests: 0, hostsTested: 2, scopeHosts: 20 },
        ]);
        expect(await edrResults(TECHNIQUE_T1046, level)).toEqual([
          { capabilityId: edrId, function: 'detect', mitreTechniqueId: TECHNIQUE_T1046, grain: 'technique', rate: 0, tests: 2, heldTests: 0, hostsTested: 2, scopeHosts: 20 },
        ]);
      }
    });

    it('counts a lab VM, a host unseen for months and a host never seen among the scope hosts and their results, and no identity', async () => {
      const [unseen] = await insertAssets(tenantId, 1, { lastSeenAt: daysAgo(200) });
      const [neverSeen] = await insertAssets(tenantId, 1, { lastSeenAt: null });
      const [identity] = await insertAssets(tenantId, 1, { categoryId: 'identity' });
      await insert({ supportingAssetId: labVms[0], held: true });
      for (const supportingAssetId of [unseen, neverSeen, identity]) {
        await insert({ supportingAssetId, held: false });
      }

      await measure();

      expect(await edrResults(TECHNIQUE_T1055, null)).toEqual([
        { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1055, grain: 'technique', rate: 1 / 3, tests: 3, heldTests: 1, hostsTested: 3, scopeHosts: 22 },
      ]);
    });

    it('reads a closed scope on its own hosts', async () => {
      const closedId = uuidv7();
      await scoped().organizations.createOrganizations([{ id: closedId, name: 'Five hosts', estateMode: 'closed', mappedAssetIds: hosts.slice(0, 5) }]);
      await insert({ supportingAssetId: hosts[0], held: false });
      await insert({ supportingAssetId: hosts[10], held: true });

      await measure();

      expect(await edrResults(TECHNIQUE_T1055, closedId)).toEqual([expect.objectContaining({ rate: 0, hostsTested: 1, scopeHosts: 5 })]);
      expect(await edrResults(TECHNIQUE_T1055, null)).toEqual([expect.objectContaining({ rate: 0.5, hostsTested: 2, scopeHosts: 20 })]);
    });

    it('counts each scenario and each sub-technique tested on a host as a test, and the host once', async () => {
      await insert({ supportingAssetId: hosts[0], held: false, at: daysAgo(10) });
      await insert({ supportingAssetId: hosts[0], held: true, sourceScenarioId: 'scenario-2' });
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1055_012, held: true });
      await insert({ supportingAssetId: hosts[1], mitreTechniqueId: TECHNIQUE_T1055_012, held: false });

      await measure();

      expect(await edrResults(TECHNIQUE_T1055, null)).toEqual([expect.objectContaining({ rate: 0.5, tests: 4, heldTests: 2, hostsTested: 2 })]);
    });

    it('counts the findings of every platform type implementing a control as tests of their own, a host both reached counting once', async () => {
      // XDR implements the EDR as EDR does; a platform type implementing no control counts nowhere.
      await insert({ supportingAssetId: hosts[0], held: false });
      await insert({ supportingAssetId: hosts[0], securityPlatformType: 'XDR', held: true });
      await insert({ supportingAssetId: hosts[1], securityPlatformType: 'XDR', held: true });
      await insert({ supportingAssetId: hosts[2], securityPlatformType: 'NO_SUCH_PLATFORM', held: false });

      await measure();

      expect(await edrResults(TECHNIQUE_T1055, null)).toEqual([expect.objectContaining({ tests: 3, heldTests: 2, hostsTested: 2 })]);
    });

    it('counts a sub-technique\'s own row on its own tests and hosts, apart from its siblings\' and the parent\'s', async () => {
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1055_012, held: false });
      await insert({ supportingAssetId: hosts[1], mitreTechniqueId: TECHNIQUE_T1055_011, held: true });
      await insert({ supportingAssetId: hosts[2], held: true });

      await measure();

      expect(await edrResults(TECHNIQUE_T1055, null)).toEqual([expect.objectContaining({ grain: 'technique', tests: 3, heldTests: 2, hostsTested: 3 })]);
      expect(await edrResults(TECHNIQUE_T1055_012, null)).toEqual([expect.objectContaining({ grain: 'sub_technique', tests: 1, heldTests: 0, hostsTested: 1 })]);
      expect(await edrResults(TECHNIQUE_T1055_011, null)).toEqual([expect.objectContaining({ grain: 'sub_technique', tests: 1, heldTests: 1, hostsTested: 1 })]);
    });

    it('stores a test for every control its platform type implements, at both grains, on a technique the control declares nothing on', async () => {
      // EDR detects network floods and prevents none.
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1498_001, held: false });

      await measure();

      for (const level of [null, scopeId]) {
        expect(await edrResults(TECHNIQUE_T1498, level)).toEqual([
          { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1498, grain: 'technique', rate: 0, tests: 1, heldTests: 0, hostsTested: 1, scopeHosts: 20 },
        ]);
        expect(await edrResults(TECHNIQUE_T1498_001, level)).toEqual([
          { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1498_001, grain: 'sub_technique', rate: 0, tests: 1, heldTests: 0, hostsTested: 1, scopeHosts: 20 },
        ]);
      }
    });

    it('stores nothing once every result is past the validation validity window', async () => {
      await insert({ supportingAssetId: hosts[0], held: false, at: daysAgo(91) });

      await measure();

      expect(await db.select().from(controlTechniqueTestResults)).toEqual([]);
    });

    it('writes nothing when a sync moved nothing', async () => {
      await insertWorkedExample();
      await measure();

      expect(await measure()).toEqual({ written: 0, deleted: 0, crossings: [] });
    });
  });

  describe('booking the levers', () => {
    it('books a scope\'s levers again when a technique\'s efficacy moves by 5 points from the result they were priced on', async () => {
      // At L2 / L2 the declaration reads about 50 %: 4 failures out of 20 hosts read 40 %.
      for (const supportingAssetId of hosts.slice(0, 4)) {
        await insert({ supportingAssetId, held: false });
      }
      expect((await measure()).crossings).toEqual([{ capabilityId: edrId, axes: [], organizationIds: [scopeId] }]);

      await insert({ supportingAssetId: hosts[4], held: false });
      expect((await measure()).crossings).toEqual([]);

      for (const supportingAssetId of hosts.slice(5, 7)) {
        await insert({ supportingAssetId, held: false });
      }
      expect((await measure()).crossings).toEqual([{ capabilityId: edrId, axes: [], organizationIds: [scopeId] }]);
    });

    it('books a scope\'s levers again when its results age out and the technique reads its declaration', async () => {
      for (const supportingAssetId of hosts.slice(0, 3)) {
        await insert({ supportingAssetId, held: false });
      }
      await measure();
      await db.update(assetEvidence).set({ evaluatedAt: daysAgo(100), latestVerdictObservedAt: daysAgo(100) });

      expect(await measure()).toMatchObject({ written: 0, crossings: [{ capabilityId: edrId, axes: [], organizationIds: [scopeId] }] });
      expect(await db.select().from(controlTechniqueTestResults)).toEqual([]);
    });

    it('never books a scope\'s levers on a sub-technique\'s own row, which the parent\'s does not move', async () => {
      // On its own the sub-technique reads 2 failures out of 20 hosts, 5 points under the L2 / L2 declaration; the parent holds 20 of 22.
      for (const supportingAssetId of [...hosts, ...labVms]) {
        await insert({ supportingAssetId, held: true });
      }
      for (const supportingAssetId of hosts.slice(0, 2)) {
        await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1055_012, held: false });
      }

      expect((await measure()).crossings).toEqual([]);
      expect(await edrResults(TECHNIQUE_T1055_012, scopeId)).toEqual([expect.objectContaining({ grain: 'sub_technique', rate: 0, tests: 2, hostsTested: 2 })]);
      const subTechniqueRows = (await db.select().from(controlTechniqueTestResults)).filter((row) => row.grain === 'sub_technique');
      expect(subTechniqueRows.length).toBeGreaterThan(0);
      expect(subTechniqueRows.every((row) => row.bookedRate === null)).toBe(true);
    });

    it('never books a scope\'s levers on a technique the control declares nothing on, which the engine does not read', async () => {
      for (const supportingAssetId of [...hosts, ...labVms]) {
        await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1498, held: false });
      }

      expect((await measure()).crossings).toEqual([]);
      const rows = (await db.select().from(controlTechniqueTestResults))
        .filter((row) => row.capabilityId === edrId && row.mitreTechniqueId === TECHNIQUE_T1498);
      expect(rows.map(({ organizationId, rate, bookedRate }) => ({ organizationId, rate, bookedRate })).sort((first, second) => Number(first.organizationId !== null) - Number(second.organizationId !== null))).toEqual([
        { organizationId: null, rate: 0, bookedRate: null },
        { organizationId: scopeId, rate: 0, bookedRate: null },
      ]);
    });

    it('keeps a scope\'s booking when only successes came in', async () => {
      for (const supportingAssetId of hosts.slice(0, 15)) {
        await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1059, held: true });
      }
      expect((await measure()).crossings).toEqual([]);
    });

    it('books a scope\'s email security again when its phishing stage moves, which the shared scale does not see', async () => {
      const segId = (await scoped().controlCapabilities.getControlCapabilities()).find((capability) => capability.externalId === 'SEG')!.id;
      await scoped().controlCapabilities.upsertAssessment(segId, 'L2', 'L2', null);
      const everyHost = [...hosts, ...labVms];
      const seg = (crossings: ReadonlyArray<PostureCrossing>) => crossings.filter((crossing) => crossing.capabilityId === segId);
      for (const supportingAssetId of everyHost) {
        await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1566, securityPlatformType: 'XDR', held: true, at: daysAgo(3) });
      }
      expect(seg((await measure()).crossings)).toEqual([]);

      // 20 held of 36 tests: 56 %, above the shared scale's 50 % at L2 / L2, 12 points below the delivery anchor's 68 %.
      for (const supportingAssetId of everyHost.slice(0, 16)) {
        await insert({ supportingAssetId, mitreTechniqueId: TECHNIQUE_T1566, securityPlatformType: 'XDR', held: false, sourceScenarioId: 'scenario-2' });
      }
      expect(seg((await measure()).crossings)).toEqual([{ capabilityId: segId, axes: [], organizationIds: [scopeId] }]);
    });

    describe('beside a posture move', () => {
      // 25 hosts: each failure moves the L2 / L2 declaration by 2 points, so two of them stay under the step.
      const failOn = async (supportingAssetIds: ReadonlyArray<string>) => {
        for (const supportingAssetId of supportingAssetIds) {
          await insert({ supportingAssetId, held: false });
        }
      };
      beforeEach(async () => {
        await insertAssets(tenantId, 5);
      });

      it('keeps the booking of a scope whose own declaration pins the axes the move crossed, until its results move by the step', async () => {
        await scoped().controlCapabilities.declareScopePosture(scopeId, edrId, { strengthRung: 'L2', coverageBucket: 'L2', comment: null });
        await failOn(hosts.slice(0, 2));

        expect((await measure([{ capabilityId: edrId, axes: ['strength', 'coverage'] }])).crossings).toEqual([]);
        expect(await edrBooking(scopeId)).toEqual([{ bookedRate: null, bookedHostsTested: null, bookedScopeHosts: null }]);

        await failOn(hosts.slice(2, 4));
        expect((await measure()).crossings).toEqual([{ capabilityId: edrId, axes: [], organizationIds: [scopeId] }]);
      });

      it('books today\'s results in a scope that leaves a crossed axis to the tenant', async () => {
        await scoped().controlCapabilities.declareScopePosture(scopeId, edrId, { strengthRung: 'L2', coverageBucket: null, comment: null });
        await failOn(hosts.slice(0, 2));

        await measure([{ capabilityId: edrId, axes: ['coverage'] }]);
        expect(await edrBooking(scopeId)).toEqual([{ bookedRate: 0, bookedHostsTested: 2, bookedScopeHosts: 25 }]);

        await failOn(hosts.slice(2, 4));
        expect((await measure()).crossings).toEqual([]);
      });
    });
  });

  describe('the attack run inputs', () => {
    it('hand the engine the scope\'s results, by technique external id', async () => {
      await insertWorkedExample();
      await measure();

      const controls = await crqIndicatorsRepository.findAttackRunControlInputs(
        repositoryContextOf(db, adminOrigin),
        [TECHNIQUE_T1055, TECHNIQUE_T1003],
        tenantId,
        scopeId,
      );
      const edr = controls.find((control) => control.controlId === edrId)!;
      const key = (cell: { function: string, techniqueExternalId: string }): string => `${cell.function}|${cell.techniqueExternalId}`;
      expect([...edr.tested].sort((first, second) => key(first).localeCompare(key(second)))).toEqual([
        { function: 'detect', techniqueExternalId: 'T1055', rate: 1, hostsTested: 10, scopeHosts: 20 },
        { function: 'prevent', techniqueExternalId: 'T1003', rate: 0, hostsTested: 2, scopeHosts: 20 },
        { function: 'prevent', techniqueExternalId: 'T1055', rate: 0.1, hostsTested: 10, scopeHosts: 20 },
      ]);
    });

    it('hand the engine a sub-technique\'s result under its parent technique, and never the sub-technique\'s own row', async () => {
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1055_012, held: false });
      await insert({ supportingAssetId: hosts[1], held: true });
      await measure();

      expect(await edrResults(TECHNIQUE_T1055_012, scopeId)).toEqual([
        { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1055_012, grain: 'sub_technique', rate: 0, tests: 1, heldTests: 0, hostsTested: 1, scopeHosts: 20 },
      ]);
      expect(await edrResults(TECHNIQUE_T1055, scopeId)).toEqual([
        { capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1055, grain: 'technique', rate: 0.5, tests: 2, heldTests: 1, hostsTested: 2, scopeHosts: 20 },
      ]);
      const controls = await crqIndicatorsRepository.findAttackRunControlInputs(repositoryContextOf(db, adminOrigin), [TECHNIQUE_T1055, TECHNIQUE_T1055_012], tenantId, scopeId);
      expect(controls.find((control) => control.controlId === edrId)!.tested).toEqual([
        { function: 'prevent', techniqueExternalId: 'T1055', rate: 0.5, hostsTested: 2, scopeHosts: 20 },
      ]);
    });
  });

  describe('reading a technique', () => {
    const L2_L2 = { strengthRung: 'L2', coverageBucket: 'L2', strength: STRENGTH_BY_RUNG.L2, coverage: 0.7, phishingStage: null };
    /** L2 strength and L2 coverage on the engine's scale, about 50 %. */
    const DECLARED = STRENGTH_BY_RUNG.L2 * 0.7;
    const edrReadings = async (mitreTechniqueId: string, level: string | null, origin: EventOrigin = adminOrigin) =>
      (await scoped(origin).controlValidation.getTechniqueTestReadings(mitreTechniqueId, level))
        .filter((reading) => reading.capabilityId === edrId)
        .sort((first, second) => first.function.localeCompare(second.function));
    const edrPrevention = async (mitreTechniqueId: string, level: string | null = null) =>
      (await edrReadings(mitreTechniqueId, level)).find((reading) => reading.function === 'prevent');

    it('reads the worked example\'s tests and efficacy on each technique, against the declared 50 %', async () => {
      await insertWorkedExample();
      await measure();

      for (const level of [null, scopeId]) {
        expect(await edrReadings(TECHNIQUE_T1055, level)).toEqual([
          {
            covered: true,
            capabilityId: edrId,
            capabilityExternalId: 'EDR',
            capabilityName: expect.any(String),
            capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' },
            function: 'detect',
            mitreTechniqueId: TECHNIQUE_T1055,
            familyTechniqueId: TECHNIQUE_T1055,
            declaration: L2_L2,
            declared: DECLARED,
            efficacy: DECLARED,
            tested: { tests: 10, heldTests: 10, rate: 1, hostsTested: 10, scopeHosts: 20, share: 0.5 },
            parentEfficacy: null,
          },
          {
            covered: true,
            capabilityId: edrId,
            capabilityExternalId: 'EDR',
            capabilityName: expect.any(String),
            capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' },
            function: 'prevent',
            mitreTechniqueId: TECHNIQUE_T1055,
            familyTechniqueId: TECHNIQUE_T1055,
            declaration: L2_L2,
            declared: DECLARED,
            efficacy: expect.closeTo(0.30, 2),
            tested: { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 },
            parentEfficacy: null,
          },
        ]);
        expect((await edrReadings(TECHNIQUE_T1059, level)).map(engineFigures)).toEqual([
          { efficacy: DECLARED, tested: null },
          { efficacy: DECLARED, tested: { tests: 15, heldTests: 15, rate: 1, hostsTested: 15, scopeHosts: 20, share: 0.75 } },
        ]);
        expect((await edrReadings(TECHNIQUE_T1003, level)).map(engineFigures))
          .toEqual([
            { efficacy: DECLARED, tested: null },
            // Failed on the 2 lab VMs of 20 hosts: about 45 %.
            { efficacy: expect.closeTo(DECLARED * 0.9, 12), tested: { tests: 2, heldTests: 0, rate: 0, hostsTested: 2, scopeHosts: 20, share: 0.1 } },
          ]);
      }
    });

    it('reads email security on its phishing stage at the stage anchor the engine prices it at, audited by the stage\'s result', async () => {
      const segId = await capabilityIdOf('SEG');
      await scoped().controlCapabilities.upsertAssessment(segId, 'L2', 'L2', null);
      await storeOneHeldOfFour(segId, TECHNIQUE_T1566);
      const declared = engineStageDeclared('SEG', 'T1566');
      expect(declared).not.toBeCloseTo(DECLARED, 2);

      const readings = await scoped().controlValidation.getTechniqueTestReadings(TECHNIQUE_T1566, null);
      const prevention = readings.find((reading) => reading.capabilityId === segId && reading.function === 'prevent');
      expect(prevention).toMatchObject({
        covered: true,
        declaration: { strengthRung: 'L2', coverageBucket: 'L2', coverage: 0.7, phishingStage: 'delivery' },
        declared,
        efficacy: testedEfficacy(declared, ONE_HELD_OF_FOUR),
      });
      const detection = readings.find((reading) => reading.capabilityId === segId && reading.function === 'detect');
      expect(detection === undefined || (detection.covered && detection.declaration?.phishingStage === null)).toBe(true);
    });

    it('reads a sub-technique on its own tests and efficacy, beside the efficacy the engine reads on its parent', async () => {
      const edrOnSubTechnique = (await scoped().controlCapabilities.getCapabilitiesForTechnique(TECHNIQUE_T1055_012))
        .filter((control) => control.id === edrId);
      expect(edrOnSubTechnique.map(({ function: fn, inheritedFrom }) => ({ fn, inheritedFrom })))
        .toContainEqual({ fn: 'prevent', inheritedFrom: null });
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1055_012, held: false });
      await insert({ supportingAssetId: hosts[1], held: true });
      await measure();

      for (const level of [null, scopeId]) {
        expect(await edrPrevention(TECHNIQUE_T1055_012, level)).toEqual({
          covered: true,
          capabilityId: edrId,
          capabilityExternalId: 'EDR',
          capabilityName: expect.any(String),
          capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' },
          function: 'prevent',
          mitreTechniqueId: TECHNIQUE_T1055_012,
          familyTechniqueId: TECHNIQUE_T1055,
          declaration: L2_L2,
          declared: DECLARED,
          // Its one failed test, on 1 host of 20.
          efficacy: expect.closeTo(DECLARED * 0.95, 12),
          tested: { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 20, share: 0.05 },
          // The family's 2 tests, one held, on 2 hosts of 20.
          parentEfficacy: expect.closeTo(DECLARED - 0.1 * (DECLARED - 0.5), 12),
        });
        expect(await edrPrevention(TECHNIQUE_T1055, level)).toMatchObject({
          tested: { tests: 2, heldTests: 1, hostsTested: 2 },
          parentEfficacy: null,
        });
      }
    });

    it('reads a sub-technique with no test of its own as not tested on its declaration, whatever its parent\'s', async () => {
      await insert({ supportingAssetId: hosts[0], held: false });
      await measure();

      expect(await edrPrevention(TECHNIQUE_T1055_012)).toMatchObject({
        tested: null,
        efficacy: DECLARED,
        parentEfficacy: expect.closeTo(DECLARED * 0.95, 12),
      });
    });

    it('reads a sub-technique as not covered once the tenant removed its parent, which the engine then reads nowhere for the control', async () => {
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1055_012, held: false });
      await measure();
      await scoped().controlCapabilities.removeTechnique(edrId, TECHNIQUE_T1055, 'prevent');

      expect(await edrPrevention(TECHNIQUE_T1055_012)).toEqual(expect.objectContaining({ covered: false, tested: FAILED_TEST }));
    });

    it('reads a scope on its own hosts and its own declaration', async () => {
      const closedId = uuidv7();
      await scoped().organizations.createOrganizations([{ id: closedId, name: 'Five hosts', estateMode: 'closed', mappedAssetIds: hosts.slice(0, 5) }]);
      await scoped().controlCapabilities.declareScopePosture(closedId, edrId, { strengthRung: 'L3', coverageBucket: null, comment: null });
      await insert({ supportingAssetId: hosts[0], held: false });
      await insert({ supportingAssetId: hosts[10], held: true });
      await measure();

      const scopeDeclared = STRENGTH_BY_RUNG.L3 * 0.7;
      expect(await edrReadings(TECHNIQUE_T1055, closedId)).toEqual([expect.objectContaining({ function: 'detect', tested: null }), expect.objectContaining({
        function: 'prevent',
        declaration: { ...L2_L2, strengthRung: 'L3', strength: STRENGTH_BY_RUNG.L3 },
        declared: scopeDeclared,
        efficacy: expect.closeTo(scopeDeclared * 0.8, 12),
        tested: { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 5, share: 0.2 },
      })]);
      expect(await edrReadings(TECHNIQUE_T1055, null)).toEqual([expect.objectContaining({ function: 'detect', tested: null }), expect.objectContaining({
        function: 'prevent',
        declared: DECLARED,
        tested: { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 },
      })]);
    });

    it('reads a control\'s results on a technique it does not cover as not covered, with no engine figure, at each level', async () => {
      const preventing = (await scoped().controlCapabilities.getCapabilitiesForTechnique(TECHNIQUE_T1566))
        .filter((control) => control.id === edrId && control.function === 'prevent');
      expect(preventing).toEqual([]);
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566, grain: 'technique' });
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566, grain: 'technique', organizationId: scopeId });

      for (const level of [null, scopeId]) {
        expect(await edrPrevention(TECHNIQUE_T1566, level)).toEqual({
          covered: false,
          capabilityId: edrId,
          capabilityExternalId: 'EDR',
          capabilityName: expect.any(String),
          capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' },
          function: 'prevent',
          mitreTechniqueId: TECHNIQUE_T1566,
          familyTechniqueId: TECHNIQUE_T1566,
          tested: FAILED_TEST,
        });
      }
    });

    it('reads the derivation\'s result of a control on a technique it does not cover as not covered, on both pages', async () => {
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1566_001, held: false });
      await measure();

      expect(await edrPrevention(TECHNIQUE_T1566)).toEqual(expect.objectContaining({ covered: false, tested: FAILED_TEST }));
      expect(await edrPrevention(TECHNIQUE_T1566_001)).toEqual(expect.objectContaining({ covered: false, familyTechniqueId: TECHNIQUE_T1566, tested: FAILED_TEST }));
      const onControl = (await scoped().controlValidation.getControlTechniqueTestReadings(edrId, 'prevent', null)).filter((reading) => !reading.covered && reading.tested !== null);
      expect(onControl.map((reading) => reading.techniqueExternalId).sort()).toEqual(['T1566', 'T1566.001']);
    });

    it('reads a sub-technique\'s own row as not covered where the control covers neither it nor its parent, under the parent\'s family', async () => {
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566, grain: 'technique' });
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566_001, grain: 'sub_technique' });

      expect(await edrPrevention(TECHNIQUE_T1566_001)).toEqual(expect.objectContaining({
        covered: false,
        familyTechniqueId: TECHNIQUE_T1566,
        tested: FAILED_TEST,
      }));
    });

    it('reads a control the tenant removed from the technique as not covered, its results kept', async () => {
      await insert({ supportingAssetId: hosts[0], held: false });
      await measure();
      await scoped().controlCapabilities.removeTechnique(edrId, TECHNIQUE_T1055, 'prevent');

      expect(await edrPrevention(TECHNIQUE_T1055)).toEqual(expect.objectContaining({
        covered: false,
        tested: FAILED_TEST,
      }));
    });

    it('keeps a control\'s results on a technique it does not cover to their tenant', async () => {
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566, grain: 'technique' });
      const other = await otherTenant();

      expect(await edrPrevention(TECHNIQUE_T1566)).toMatchObject({ covered: false });
      expect((await edrReadings(TECHNIQUE_T1566, null, other.origin)).filter((reading) => reading.function === 'prevent')).toEqual([]);
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566, grain: 'technique', tenant: other.tenantId });
      expect((await edrReadings(TECHNIQUE_T1566, null, other.origin)).filter((reading) => reading.function === 'prevent'))
        .toEqual([expect.objectContaining({ covered: false, tested: FAILED_TEST })]);
    });

    it('reads another tenant\'s technique on that tenant\'s results alone, and refuses it this tenant\'s scope', async () => {
      await insertWorkedExample();
      await measure();
      const other = await otherTenant();
      const [otherHost] = await insertAssets(other.tenantId, 1);
      await insertResult({ tenantId: other.tenantId, supportingAssetId: otherHost, held: true });
      await scoped(other.origin).controlValidation.measureTechniqueTestResults({ now: new Date() });

      expect((await edrReadings(TECHNIQUE_T1055, null, other.origin)).map((reading) => ({ fn: reading.function, declared: reading.covered ? reading.declared : null, tested: reading.tested }))).toEqual([
        { fn: 'detect', declared: 0, tested: null },
        { fn: 'prevent', declared: 0, tested: { tests: 1, heldTests: 1, rate: 1, hostsTested: 1, scopeHosts: 1, share: 1 } },
      ]);
      await expect(scoped(other.origin).controlValidation.getTechniqueTestReadings(TECHNIQUE_T1055, scopeId)).rejects.toThrow();
    });
  });

  describe('reading a control', () => {
    const L2_L2 = { strengthRung: 'L2', coverageBucket: 'L2', strength: STRENGTH_BY_RUNG.L2, coverage: 0.7, phishingStage: null };
    const DECLARED = STRENGTH_BY_RUNG.L2 * 0.7;
    const controlReadings = async (capabilityFunction: 'prevent' | 'detect', level: string | null, origin: EventOrigin = adminOrigin) =>
      scoped(origin).controlValidation.getControlTechniqueTestReadings(edrId, capabilityFunction, level);
    const testedOf = (readings: Awaited<ReturnType<typeof controlReadings>>) =>
      new Map(readings.filter((reading) => reading.tested !== null).map((reading) => [reading.mitreTechniqueId, reading]));
    const readingOn = async (mitreTechniqueId: string, level: string | null = null) =>
      (await controlReadings('prevent', level)).find((reading) => reading.mitreTechniqueId === mitreTechniqueId);

    it('reads every technique the control covers on the function, the tested ones against the declared 50 %', async () => {
      await insertWorkedExample();
      await measure();

      for (const level of [null, scopeId]) {
        const prevention = await controlReadings('prevent', level);
        const covered = (await scoped().controlCapabilities.getControlCapability(edrId))!.edges
          .filter((edge) => edge.function === 'prevent' && edge.state !== 'removed')
          .map((edge) => edge.techniqueId);
        expect(prevention.map((reading) => reading.mitreTechniqueId).sort()).toEqual(covered.toSorted());
        const tested = testedOf(prevention);
        // Every test of the example ran on a technique, so no sub-technique reads one.
        expect([...tested.keys()].sort()).toEqual([TECHNIQUE_T1003, TECHNIQUE_T1021, TECHNIQUE_T1055, TECHNIQUE_T1059].filter((id) => covered.includes(id)).sort());
        expect(tested.get(TECHNIQUE_T1055)).toEqual({
          covered: true,
          capabilityId: edrId,
          function: 'prevent',
          mitreTechniqueId: TECHNIQUE_T1055,
          techniqueExternalId: 'T1055',
          techniqueName: expect.any(String),
          familyTechniqueId: TECHNIQUE_T1055,
          declaration: L2_L2,
          declared: DECLARED,
          efficacy: expect.closeTo(0.30, 2),
          tested: { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 },
          parentEfficacy: null,
        });
        expect(tested.get(TECHNIQUE_T1059)).toMatchObject({ efficacy: DECLARED, tested: { heldTests: 15, tests: 15 } });
        expect(prevention.flatMap((reading) => (reading.covered && reading.tested === null ? [reading.efficacy] : [])).every((efficacy) => efficacy === DECLARED)).toBe(true);

        const detection = testedOf(await controlReadings('detect', level));
        expect(detection.get(TECHNIQUE_T1055)).toMatchObject({ function: 'detect', efficacy: DECLARED, tested: { heldTests: 10, tests: 10 } });
        expect(detection.get(TECHNIQUE_T1046)).toMatchObject({ tested: { heldTests: 0, tests: 2, hostsTested: 2, scopeHosts: 20 } });
        expect(detection.has(TECHNIQUE_T1059)).toBe(false);
      }
    });

    it('reads a technique the tenant removed as not covered, its results kept, since the engine prices it nowhere', async () => {
      await insertWorkedExample();
      await measure();
      await scoped().controlCapabilities.removeTechnique(edrId, TECHNIQUE_T1059, 'prevent');

      const prevention = await controlReadings('prevent', null);

      expect(prevention.filter((reading) => reading.mitreTechniqueId === TECHNIQUE_T1059)).toEqual([expect.objectContaining({
        covered: false,
        tested: { tests: 15, heldTests: 15, rate: 1, hostsTested: 15, scopeHosts: 20, share: 0.75 },
      })]);
      expect(testedOf(prevention).get(TECHNIQUE_T1055)).toMatchObject({ covered: true });
    });

    it('reads the results on techniques the control does not cover as not covered, both grains, at each level', async () => {
      for (const organizationId of [null, scopeId]) {
        await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566, grain: 'technique', organizationId });
        await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566_001, grain: 'sub_technique', organizationId });
      }

      for (const level of [null, scopeId]) {
        const prevention = await controlReadings('prevent', level);
        expect(prevention.filter((reading) => !reading.covered).toSorted((first, second) => second.techniqueExternalId.localeCompare(first.techniqueExternalId))).toEqual([
          {
            covered: false,
            capabilityId: edrId,
            function: 'prevent',
            mitreTechniqueId: TECHNIQUE_T1566_001,
            techniqueExternalId: 'T1566.001',
            techniqueName: expect.any(String),
            familyTechniqueId: TECHNIQUE_T1566,
            tested: FAILED_TEST,
          },
          {
            covered: false,
            capabilityId: edrId,
            function: 'prevent',
            mitreTechniqueId: TECHNIQUE_T1566,
            techniqueExternalId: 'T1566',
            techniqueName: expect.any(String),
            familyTechniqueId: TECHNIQUE_T1566,
            tested: FAILED_TEST,
          },
        ]);
        expect(prevention.filter((reading) => reading.covered).every((reading) => reading.mitreTechniqueId !== TECHNIQUE_T1566)).toBe(true);
      }
    });

    it('keeps a sub-technique\'s row covered where the control covers only its parent, which the engine prices', async () => {
      await scoped().controlCapabilities.removeTechnique(edrId, TECHNIQUE_T1055_012, 'prevent');
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1055_012, grain: 'sub_technique' });

      expect((await controlReadings('prevent', null)).filter((reading) => !reading.covered)).toEqual([]);
    });

    it('keeps a control\'s results on a technique it does not cover to their tenant', async () => {
      const other = await otherTenant();
      await storeFailedTest({ mitreTechniqueId: TECHNIQUE_T1566, grain: 'technique', tenant: other.tenantId });

      expect((await controlReadings('prevent', null)).filter((reading) => !reading.covered)).toEqual([]);
      expect((await controlReadings('prevent', null, other.origin)).filter((reading) => !reading.covered))
        .toEqual([expect.objectContaining({ mitreTechniqueId: TECHNIQUE_T1566, tested: FAILED_TEST })]);
    });

    it('reads a sub-technique on its own tests, its parent on the family\'s, each sub-technique carrying the parent\'s efficacy', async () => {
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1055_012, held: false });
      await insert({ supportingAssetId: hosts[1], held: true });
      await measure();
      const parentEfficacy = expect.closeTo(DECLARED - 0.1 * (DECLARED - 0.5), 12);

      expect(await readingOn(TECHNIQUE_T1055_012)).toMatchObject({
        familyTechniqueId: TECHNIQUE_T1055,
        tested: { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 20, share: 0.05 },
        efficacy: expect.closeTo(DECLARED * 0.95, 12),
        parentEfficacy,
      });
      expect(await readingOn(TECHNIQUE_T1055)).toMatchObject({
        tested: { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 },
        efficacy: parentEfficacy,
        parentEfficacy: null,
      });
      expect(await readingOn(TECHNIQUE_T1055_001)).toMatchObject({ tested: null, efficacy: DECLARED, parentEfficacy });
    });

    it('reads a sub-technique as not covered once the tenant removed its parent, which the engine then reads nowhere for the control', async () => {
      await insert({ supportingAssetId: hosts[0], mitreTechniqueId: TECHNIQUE_T1055_012, held: false });
      await measure();
      await scoped().controlCapabilities.removeTechnique(edrId, TECHNIQUE_T1055, 'prevent');

      expect(await readingOn(TECHNIQUE_T1055_012)).toEqual(expect.objectContaining({ covered: false, tested: FAILED_TEST }));
      expect(await readingOn(TECHNIQUE_T1055)).toEqual(expect.objectContaining({ covered: false, tested: FAILED_TEST }));
    });

    it('reads a technique the engine reads through the control\'s phishing stage as covered, with no edge on it', async () => {
      const segId = (await scoped().controlCapabilities.getControlCapabilities()).find((capability) => capability.externalId === 'SEG')!.id;
      const segEdges = (await scoped().controlCapabilities.getControlCapability(segId))!.edges
        .filter((edge) => edge.function === 'prevent' && edge.techniqueExternalId.startsWith('T1566'));
      await scoped().controlCapabilities.removeTechnique(segId, TECHNIQUE_T1566, 'prevent');
      expect(segEdges.some((edge) => edge.techniqueExternalId === 'T1566.001')).toBe(true);
      await db.insert(controlTechniqueTestResults).values([{
        id: uuidv7(), tenantId, capabilityId: segId, organizationId: null, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1566,
        grain: 'technique', rate: 0, tests: 1, heldTests: 0, hostsTested: 1, scopeHosts: 20,
      }]);

      const reading = (await scoped().controlValidation.getControlTechniqueTestReadings(segId, 'prevent', null))
        .find((entry) => entry.mitreTechniqueId === TECHNIQUE_T1566);
      expect(reading).toEqual(expect.objectContaining({ covered: true, tested: FAILED_TEST }));
    });

    it('reads multi-factor authentication on its credential stage at the stage anchor the engine prices it at, and only there', async () => {
      const idpId = await capabilityIdOf('IDP');
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await storeOneHeldOfFour(idpId, TECHNIQUE_T1078);
      const declared = engineStageDeclared('IDP', 'T1078');
      expect(declared).not.toBeCloseTo(DECLARED, 2);

      const prevention = await scoped().controlValidation.getControlTechniqueTestReadings(idpId, 'prevent', null);
      expect(prevention.find((reading) => reading.mitreTechniqueId === TECHNIQUE_T1078)).toMatchObject({
        covered: true,
        declaration: { strengthRung: 'L2', coverageBucket: 'L2', phishingStage: 'credential' },
        declared,
        efficacy: testedEfficacy(declared, ONE_HELD_OF_FOUR),
      });
      const elsewhere = prevention.filter((reading) => reading.covered && reading.mitreTechniqueId !== TECHNIQUE_T1078 && reading.familyTechniqueId !== TECHNIQUE_T1078);
      expect(elsewhere.length).toBeGreaterThan(0);
      expect(elsewhere.every((reading) => reading.covered && reading.declared === DECLARED && reading.declaration?.phishingStage === null)).toBe(true);
    });

    it('reads a scope on its own hosts and its own declaration', async () => {
      const closedId = uuidv7();
      await scoped().organizations.createOrganizations([{ id: closedId, name: 'Five hosts', estateMode: 'closed', mappedAssetIds: hosts.slice(0, 5) }]);
      await scoped().controlCapabilities.declareScopePosture(closedId, edrId, { strengthRung: 'L3', coverageBucket: null, comment: null });
      await insert({ supportingAssetId: hosts[0], held: false });
      await insert({ supportingAssetId: hosts[10], held: true });
      await measure();

      const scopeDeclared = STRENGTH_BY_RUNG.L3 * 0.7;
      expect(await readingOn(TECHNIQUE_T1055, closedId)).toMatchObject({
        declaration: { ...L2_L2, strengthRung: 'L3', strength: STRENGTH_BY_RUNG.L3 },
        declared: scopeDeclared,
        efficacy: expect.closeTo(scopeDeclared * 0.8, 12),
        tested: { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 5, share: 0.2 },
      });
      expect(await readingOn(TECHNIQUE_T1055)).toMatchObject({
        declared: DECLARED,
        tested: { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 },
      });
    });

    it('reads another tenant\'s control on that tenant\'s results and declaration alone, and refuses it this tenant\'s scope', async () => {
      await insertWorkedExample();
      await measure();
      const other = await otherTenant();
      const [otherHost] = await insertAssets(other.tenantId, 1);
      await insertResult({ tenantId: other.tenantId, supportingAssetId: otherHost, held: true });
      await scoped(other.origin).controlValidation.measureTechniqueTestResults({ now: new Date() });

      const prevention = await controlReadings('prevent', null, other.origin);

      expect([...testedOf(prevention).values()].map(({ mitreTechniqueId, tested }) => ({ mitreTechniqueId, tested }))).toEqual([
        { mitreTechniqueId: TECHNIQUE_T1055, tested: { tests: 1, heldTests: 1, rate: 1, hostsTested: 1, scopeHosts: 1, share: 1 } },
      ]);
      expect(prevention.every((reading) => !reading.covered || reading.declared === 0)).toBe(true);
      await expect(controlReadings('prevent', scopeId, other.origin)).rejects.toThrow();
    });
  });

  describe('tenant isolation', () => {
    it('keeps each tenant\'s results to itself', async () => {
      await insertWorkedExample();
      await measure();
      const other = await otherTenant();
      const [otherHost] = await insertAssets(other.tenantId, 1);
      await insertResult({ tenantId: other.tenantId, supportingAssetId: otherHost, held: true });

      await scoped(other.origin).controlValidation.measureTechniqueTestResults({ now: new Date() });

      expect((await storedResults(other.origin, TECHNIQUE_T1055, null)).filter((row) => row.capabilityId === edrId))
        .toEqual([{ capabilityId: edrId, function: 'prevent', mitreTechniqueId: TECHNIQUE_T1055, grain: 'technique', rate: 1, tests: 1, heldTests: 1, hostsTested: 1, scopeHosts: 1 }]);
      expect(await edrResults(TECHNIQUE_T1055, null)).toHaveLength(2);
      const context = repositoryContextOf(db, other.origin);
      const seenByOther = await context.db.select().from(context.views.controlTechniqueTestResults);
      expect(seenByOther.length).toBeGreaterThan(0);
      expect(seenByOther.every((row) => row.tenantId === other.tenantId)).toBe(true);
    });

    it('refuses a write naming another tenant', async () => {
      const other = await otherTenant();
      const { db: protectedDb } = repositoryContextOf(db, other.origin);

      await expect(protectedDb.insert(controlTechniqueTestResults).values([{
        id: uuidv7(),
        tenantId,
        capabilityId: edrId,
        organizationId: null,
        function: 'prevent',
        mitreTechniqueId: TECHNIQUE_T1055,
        grain: 'technique',
        rate: 0,
        tests: 1,
        heldTests: 0,
        hostsTested: 1,
        scopeHosts: 1,
      }])).rejects.toThrow();
    });
  });
});

describe('a sync that moves a control\'s efficacy on a technique', () => {
  it('rebooks the control\'s levers for the scenario, whose ALE rises at its next run', async () => {
    await truncateAllTables(db);
    const { origin, tenantId } = await createTenantWithAdmin(services);
    const scoped = services.withOrigin(origin);
    await scoped.crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 100 });
    const { organizationId, riskScenarioId, assetIdByName } = await seedAttackRunScenario(services, origin, tenantId);
    const edrId = (await scoped.controlCapabilities.getControlCapabilities()).find((capability) => capability.externalId === 'EDR')!.id;
    await scoped.controlCapabilities.upsertAssessment(edrId, 'L3', 'L3', null);
    const before = await runAttackRun(services, origin, riskScenarioId, tenantId);

    for (let index = 1; index <= 10; index += 1) {
      await insertResult({ tenantId, supportingAssetId: assetIdByName.get(`Workstation ${index}`)!, mitreTechniqueId: TECHNIQUE_T1059, held: false });
    }
    const { crossings } = await scoped.controlValidation.measureTechniqueTestResults({ now: new Date() });

    expect(crossings).toEqual([{ capabilityId: edrId, axes: [], organizationIds: [organizationId] }]);
    expect(await scoped.crqIndicators.getScenariosRepricedByCrossings(crossings, tenantId))
      .toEqual([expect.objectContaining({ riskScenarioId, controlIds: expect.arrayContaining([edrId]) })]);
    const after = await runAttackRun(services, origin, riskScenarioId, tenantId);
    expect(after.result.ale.mean).toBeGreaterThan(before.result.ale.mean);
  });
});
