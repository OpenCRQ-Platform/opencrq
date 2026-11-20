import type { EventOrigin } from '@app/module';
import {
  assetEvidence,
  controlCapabilityEdges,
  controlCapabilityTechniqueOverrides,
  controlProvenPostureHistory,
  securityPlatformFamilyControls,
  TECHNIQUE_T1027,
} from '@app/module';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Noon UTC today, so an instant an hour earlier is never replayed: it falls after the last midnight.
const NOW = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS + 12 * HOUR_MS);
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
const midnightOf = (instant: Date): Date => new Date(Math.floor(instant.getTime() / DAY_MS) * DAY_MS);

// The EDR platform family implements the EDR and EHB controls, and only EDR covers T1027, so a
// prevention result on it moves exactly one control's prevention counts.
const EDR_PLATFORM_TYPE = 'EDR';

describe('Proven posture history', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;
  let edrCapabilityId: string;

  const jobOrigin = (tenantId: string): EventOrigin => ({ type: 'job', tenantId, jobKind: 'proven-posture-record', interactive: false });

  const record = async (tenantId: string = adminTenantId, now: Date = NOW, signal?: AbortSignal) =>
    services.withOrigin(jobOrigin(tenantId)).controlValidation.recordProvenPostureHistory({ now, signal });

  const linesOf = async (tenantId: string = adminTenantId) => db
    .select()
    .from(controlProvenPostureHistory)
    .where(eq(controlProvenPostureHistory.tenantId, tenantId))
    .orderBy(asc(controlProvenPostureHistory.changedAt), asc(controlProvenPostureHistory.id));

  const edrPreventionLines = async (organizationId: string | null = null) => (await linesOf()).filter((line) =>
    line.capabilityId === edrCapabilityId && line.function === 'prevent' && line.organizationId === organizationId);

  const createAsset = async (name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id,
      name,
      description: null,
      ownerId: null,
      exposure: 'unknown',
      categoryId: 'host',
      criticality: 'unknown',
    });
    return id;
  };

  const insertResult = async (
    supportingAssetId: string,
    verdicts: Array<{ state: 'applicable' | 'dismissed', at: Date }>,
    options: { scenarioId?: string, evaluatedAt?: Date } = {},
  ): Promise<void> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId,
      tenantId: adminTenantId,
      mitreTechniqueId: TECHNIQUE_T1027,
      expectationType: 'prevention',
      securityPlatformType: EDR_PLATFORM_TYPE,
      sourceScenarioId: options.scenarioId ?? 'scenario-1',
      sourceScenarioName: 'Ransomware drill',
      sourceSimulationId: 'simulation-1',
      evaluatedAt: options.evaluatedAt ?? verdicts.at(-1)!.at,
    }]);
    for (const verdict of verdicts) {
      await insertSyncedVerdict(id, verdict.state, verdict.at);
    }
  };

  const reachableCapabilityIds = async (): Promise<Set<string>> => new Set((await db
    .selectDistinct({ capabilityId: securityPlatformFamilyControls.capabilityId })
    .from(securityPlatformFamilyControls)).map((row) => row.capabilityId));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    edrCapabilityId = capabilities.find((capability) => capability.externalId === 'EDR')!.id;
  });

  it('writes one tenant-level line per reachable control and credited function on the first run, tested or not', async () => {
    const reachable = await reachableCapabilityIds();
    const creditedKeys = new Set((await db
      .selectDistinct({ capabilityId: controlCapabilityEdges.capabilityId, function: controlCapabilityEdges.function })
      .from(controlCapabilityEdges)
      .where(inArray(controlCapabilityEdges.capabilityId, [...reachable])))
      .map((row) => `${row.capabilityId}:${row.function}`));

    const outcome = await record();

    const lines = await linesOf();
    expect(new Set(lines.map((line) => `${line.capabilityId}:${line.function}`))).toEqual(creditedKeys);
    expect(lines).toHaveLength(creditedKeys.size);
    expect(lines.every((line) => line.organizationId === null && line.tested === 0 && line.held === 0 && !line.replayed)).toBe(true);
    expect(lines.every((line) => line.credited > 0 && line.changedAt.getTime() === NOW.getTime())).toBe(true);
    expect(outcome).toEqual({ lines: creditedKeys.size, replayedLines: 0, replayedDays: 0 });
  });

  it('records nothing for a control no security platform family implements', async () => {
    const reachable = await reachableCapabilityIds();
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    const unreachable = capabilities.filter((capability) => !reachable.has(capability.id)).map((capability) => capability.id);
    expect(unreachable.length).toBeGreaterThan(0);

    await record();

    expect((await linesOf()).filter((line) => unreachable.includes(line.capabilityId))).toEqual([]);
  });

  it('writes nothing on a run where no count moved', async () => {
    await record();
    const before = await linesOf();

    const outcome = await record(adminTenantId, new Date(NOW.getTime() + HOUR_MS));

    expect(await linesOf()).toEqual(before);
    expect(outcome.lines).toBe(0);
  });

  it('writes one line for the control and function a new verdict moved, and no other', async () => {
    await record();
    const before = await linesOf();
    const assetId = await createAsset('Workstation');
    await insertResult(assetId, [{ state: 'applicable', at: new Date(NOW.getTime() - HOUR_MS) }]);
    const later = new Date(NOW.getTime() + HOUR_MS);

    await record(adminTenantId, later);

    const added = (await linesOf()).filter((line) => !before.some((previous) => previous.id === line.id));
    expect(added).toEqual([expect.objectContaining({
      capabilityId: edrCapabilityId,
      function: 'prevent',
      organizationId: null,
      tested: 1,
      held: 0,
      changedAt: later,
      replayed: false,
    })]);
    expect(added[0].credited).toBe(before.find((line) => line.capabilityId === edrCapabilityId && line.function === 'prevent')!.credited);
  });

  it('closes a control’s line when the tenant removes its last credited technique, and reopens it when the coverage returns', async () => {
    await record();
    const [opened] = await edrPreventionLines();
    const catalogueEdges = await db
      .select({ techniqueId: controlCapabilityEdges.mitreTechniqueId })
      .from(controlCapabilityEdges)
      .where(and(eq(controlCapabilityEdges.capabilityId, edrCapabilityId), eq(controlCapabilityEdges.function, 'prevent')));
    await db.insert(controlCapabilityTechniqueOverrides).values(catalogueEdges.map(({ techniqueId }) => ({
      id: uuidv7(),
      tenantId: adminTenantId,
      capabilityId: edrCapabilityId,
      mitreTechniqueId: techniqueId,
      kind: 'removed' as const,
      function: 'prevent' as const,
    })));
    const removedAt = new Date(NOW.getTime() + HOUR_MS);

    await record(adminTenantId, removedAt);
    await record(adminTenantId, new Date(NOW.getTime() + 2 * HOUR_MS));
    await db.delete(controlCapabilityTechniqueOverrides).where(eq(controlCapabilityTechniqueOverrides.tenantId, adminTenantId));
    const restoredAt = new Date(NOW.getTime() + 3 * HOUR_MS);
    await record(adminTenantId, restoredAt);

    expect((await edrPreventionLines()).map(({ credited, tested, held, changedAt }) => ({ credited, tested, held, changedAt }))).toEqual([
      { credited: opened.credited, tested: 0, held: 0, changedAt: NOW },
      { credited: 0, tested: 0, held: 0, changedAt: removedAt },
      { credited: opened.credited, tested: 0, held: 0, changedAt: restoredAt },
    ]);
  });

  it('writes nothing when the run is aborted, past to replay included', async () => {
    const assetId = await createAsset('Workstation');
    await insertResult(assetId, [{ state: 'dismissed', at: daysAgo(30) }]);
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(record(adminTenantId, NOW, controller.signal)).rejects.toThrow('cancelled');

    expect(await linesOf()).toEqual([]);
  });

  it('records a closed scope over its own assets and an open scope with the tenant counts', async () => {
    const inside = await createAsset('Inside the scope');
    const outside = await createAsset('Outside the scope');
    await insertResult(inside, [{ state: 'dismissed', at: new Date(NOW.getTime() - HOUR_MS) }], { scenarioId: 'scenario-a' });
    await insertResult(outside, [{ state: 'applicable', at: new Date(NOW.getTime() - HOUR_MS) }], { scenarioId: 'scenario-b' });
    const closedId = uuidv7();
    const openId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: closedId, name: 'Payments platform' },
      { id: openId, name: 'Whole estate' },
    ]);
    await services.withOrigin(adminOrigin).organizations.updateOrganization(closedId, {
      estateMode: 'closed',
      mapping: { added: [inside], removed: [] },
    });

    await record();

    expect(await edrPreventionLines(null)).toEqual([expect.objectContaining({ tested: 1, held: 0 })]);
    expect(await edrPreventionLines(openId)).toEqual([expect.objectContaining({ tested: 1, held: 0 })]);
    expect(await edrPreventionLines(closedId)).toEqual([expect.objectContaining({ tested: 1, held: 1 })]);
  });

  it('trims the lines past a year but keeps the one in force at the cut-off', async () => {
    const line = (changedAt: Date) => ({
      id: uuidv7(),
      tenantId: adminTenantId,
      capabilityId: edrCapabilityId,
      organizationId: null,
      function: 'prevent' as const,
      credited: 5,
      tested: 0,
      held: 0,
      changedAt,
    });
    await db.insert(controlProvenPostureHistory).values([line(daysAgo(400)), line(daysAgo(380)), line(daysAgo(10))]);

    await record();

    expect((await edrPreventionLines()).map((kept) => kept.changedAt)).toEqual(expect.arrayContaining([daysAgo(380), daysAgo(10)]));
    expect((await edrPreventionLines()).map((kept) => kept.changedAt)).not.toContainEqual(daysAgo(400));
  });

  it('replays the past once per UTC day before writing the present line', async () => {
    const assetId = await createAsset('Workstation');
    await insertResult(assetId, [
      { state: 'dismissed', at: daysAgo(30) },
      { state: 'applicable', at: daysAgo(10) },
      { state: 'dismissed', at: new Date(NOW.getTime() - HOUR_MS) },
    ]);

    const outcome = await record();

    expect((await edrPreventionLines()).map(({ tested, held, changedAt, replayed }) => ({ tested, held, changedAt, replayed }))).toEqual([
      { tested: 1, held: 1, changedAt: midnightOf(daysAgo(29)), replayed: true },
      { tested: 1, held: 0, changedAt: midnightOf(daysAgo(9)), replayed: true },
      { tested: 1, held: 1, changedAt: NOW, replayed: false },
    ]);
    expect(outcome.replayedDays).toBe(30);
  });

  it('never reads nor touches another tenant’s lines', async () => {
    const tenantBId = await createTenant(services, adminUserId);
    await record(tenantBId);
    const tenantBLines = await linesOf(tenantBId);
    expect(tenantBLines.length).toBeGreaterThan(0);

    await record();

    expect(await linesOf(tenantBId)).toEqual(tenantBLines);
    // Had the run read the other tenant's lines as its own, an identical estate would owe none.
    expect(await linesOf()).toHaveLength(tenantBLines.length);
  });
});
