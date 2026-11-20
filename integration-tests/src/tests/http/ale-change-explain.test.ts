import type { ActorClass, AssetCategory, CoverageBucket, CrqReachGapKind, EventOrigin, StrengthRung } from '@app/module';
import {
  assetEvidence,
  assetEvidenceHistory,
  assetPostureHistory,
  controlCapabilities,
  controlCapabilityAssessmentEvents,
  crqControlWhatIfResults,
  crqIndicatorGroupScores,
  crqIndicatorRunReachGaps,
  crqIndicatorRuns,
  cve,
  mitreTechniques,
  organizations,
  supportingAssets,
  tefEstimates,
  uniqueFindingScoreHistory,
} from '@app/module';
import { pricedFraction, TEF_EVERY_SIZE } from '@app/module/client';
import { asc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { testFeatureFlags } from '../../setup/mock';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

const RUN_DEFAULTS = {
  iterations: 10_000,
  vulnerabilityP5: 0.1,
  vulnerabilityP50: 0.2,
  vulnerabilityP95: 0.3,
  tefMin: 1,
  tefLikely: 4,
  tefMax: 7,
  techniqueCount: 40,
  coveredTechniqueCount: 30,
  outcomeBlocked: 0.4,
  outcomeEvicted: 0.3,
  outcomeImpactDetected: 0.2,
  outcomeImpactUndetected: 0.1,
  magnitudeMean: 2_000_000,
  calibrationVintage: '2026.09',
  uncontestedPairCount: 0,
  uncontestablePairCount: 0,
} as const;

describe('What changed between two runs of a risk scenario (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let scoped: ReturnType<typeof services.withOrigin>;
  let otherScenarioId: string;
  let earlierRunId: string;
  let laterRunId: string;
  let laterReadAt: Date;
  let earlierCreatedAt: Date;

  const getRunChanges = (input: { riskScenarioId: string, firstRunId: string, secondRunId: string, timeZone?: string }) =>
    client.query('aleChangeExplain.getRunChanges', { ...input, timeZone: input.timeZone ?? 'UTC' }, { tenantId });

  const insertRun = async (
    values: { riskScenarioId: string, createdAt: Date, catalogueVintage: string, aleMean?: number, readAt?: Date, uncontestedPairCount?: number | null, uncontestablePairCount?: number | null },
    shares: Array<[ActorClass, number]>,
  ) => {
    const runId = uuidv7();
    await db.insert(crqIndicatorRuns).values({ id: runId, ...RUN_DEFAULTS, ...values });
    await db.insert(crqIndicatorGroupScores).values(shares.map(([actorClass, share]) => ({
      id: uuidv7(),
      runId,
      groupKey: uuidv7(),
      share,
      actorClass,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      vulnerabilityMean: 0.2,
    })));
    return runId;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };
    scoped = services.withOrigin(origin);

    const [outcome] = await scoped.attackOutcomes.getAttackOutcomes();
    organizationId = uuidv7();
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Acme' }]);
    riskScenarioId = uuidv7();
    otherScenarioId = uuidv7();
    for (const [id, name] of [[riskScenarioId, 'Ransomware'], [otherScenarioId, 'Data theft']]) {
      await scoped.riskScenarios.createRiskScenario({
        id, organizationId, name, description: null, attackOutcomeId: outcome.id, primaryAssetIds: [],
      });
    }

    laterReadAt = new Date('2026-10-05T23:50:00Z');
    earlierCreatedAt = new Date('2026-10-01T10:00:00Z');
    earlierRunId = await insertRun(
      { riskScenarioId, createdAt: earlierCreatedAt, catalogueVintage: 'attack-enterprise-17' },
      [['ransomware_operator', 0.41], ['state_sponsored', 0.22]],
    );
    laterRunId = await insertRun(
      { riskScenarioId, createdAt: new Date('2026-10-06T00:02:00Z'), catalogueVintage: 'attack-enterprise-18', readAt: laterReadAt },
      [['ransomware_operator', 0.48], ['state_sponsored', 0.22]],
    );
  });

  it('should read the earlier run as before whatever order the two are given in', async () => {
    const res = await getRunChanges({ riskScenarioId, firstRunId: laterRunId, secondRunId: earlierRunId });

    expect(res.status).toBe(200);
    const { before, after } = res.json.result.data;
    expect(before.id).toBe(earlierRunId);
    expect(after.id).toBe(laterRunId);
  });

  it('should read a run at the time it stored, and a run stored without one at its creation', async () => {
    const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

    const { before, after } = res.json.result.data;
    expect(after.readAt).toBe(laterReadAt.toISOString());
    expect(before.readAt).toBe(earlierCreatedAt.toISOString());
  });

  it('should list the class share and the catalogue vintage that differ, as a balance of the two runs', async () => {
    const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

    const { events, runs } = res.json.result.data;
    expect(runs).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        category: 'run-results',
        moment: { kind: 'balance' },
        direction: 'up',
        item: expect.objectContaining({ kind: 'actor-class-share', key: 'ransomware_operator' }),
        values: { format: 'share', before: 0.41, after: 0.48 },
      }),
      expect.objectContaining({
        category: 'model',
        direction: 'none',
        item: expect.objectContaining({ kind: 'model-setting', key: 'catalogue-vintage' }),
        values: { format: 'text', before: 'attack-enterprise-17', after: 'attack-enterprise-18' },
      }),
    ]);
  });

  it('should name the categories with their tabs', async () => {
    const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

    const { categories } = res.json.result.data;
    expect(categories.map((category: { key: string }) => category.key)).toEqual(['controls', 'findings-critical', 'findings-high', 'findings-other', 'assets-critical', 'assets-high', 'assets-other', 'attack-frequency', 'run-results', 'model']);
  });

  describe('technique coverage', () => {
    let gap: (runId: string, externalId: string, family: AssetCategory, kind: CrqReachGapKind) => typeof crqIndicatorRunReachGaps.$inferInsert;

    beforeEach(async () => {
      const techniques = await db.select({ id: mitreTechniques.id, externalId: mitreTechniques.externalId })
        .from(mitreTechniques)
        .where(inArray(mitreTechniques.externalId, ['T1078', 'T1190', 'T1486', 'T1566']));
      const techniqueId = new Map(techniques.map((technique) => [technique.externalId, technique.id]));
      gap = (runId, externalId, family, kind) => ({ id: uuidv7(), runId, mitreTechniqueId: techniqueId.get(externalId)!, family, gap: kind });
      testFeatureFlags.push('technique-coverage-changes');
    });

    afterEach(() => {
      testFeatureFlags.splice(testFeatureFlags.indexOf('technique-coverage-changes'), 1);
    });

    it('should name the category and list its pairs only while the technique-coverage-changes flag is on', async () => {
      await db.insert(crqIndicatorRunReachGaps).values([gap(laterRunId, 'T1078', 'identity', 'estate')]);
      const listed = (await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId })).json.result.data;
      testFeatureFlags.splice(testFeatureFlags.indexOf('technique-coverage-changes'), 1);
      const hidden = (await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId })).json.result.data;
      testFeatureFlags.push('technique-coverage-changes');

      const hasCategory = (changes: { categories: Array<{ key: string }> }) => changes.categories.some(({ key }) => key === 'technique-coverage');
      const hasEvent = (changes: { events: Array<{ category: string }> }) => changes.events.some(({ category }) => category === 'technique-coverage');
      expect([hasCategory(listed), hasEvent(listed)]).toEqual([true, true]);
      expect([hasCategory(hidden), hasEvent(hidden)]).toEqual([false, false]);
    });

    it('should list each pair that entered or left the reach gaps on the run from which it held its final state', async () => {
      const middleReadAt = new Date('2026-10-03T08:00:00Z');
      const middleRunId = await insertRun(
        { riskScenarioId, createdAt: new Date('2026-10-03T08:01:00Z'), readAt: middleReadAt, catalogueVintage: 'attack-enterprise-17' },
        [['ransomware_operator', 0.41], ['state_sponsored', 0.22]],
      );
      const quietRunId = await insertRun(
        { riskScenarioId, createdAt: new Date('2026-10-04T08:01:00Z'), catalogueVintage: 'attack-enterprise-17' },
        [['ransomware_operator', 0.41], ['state_sponsored', 0.22]],
      );
      await db.insert(crqIndicatorRunReachGaps).values([
        gap(earlierRunId, 'T1190', 'web_application', 'estate'),
        gap(earlierRunId, 'T1566', 'host', 'estate'),
        ...[middleRunId, quietRunId].flatMap((runId) => [
          gap(runId, 'T1190', 'web_application', 'estate'),
          gap(runId, 'T1078', 'identity', 'estate'),
          gap(runId, 'T1566', 'host', 'estate'),
        ]),
        gap(laterRunId, 'T1190', 'web_application', 'estate'),
        gap(laterRunId, 'T1078', 'identity', 'estate'),
        gap(laterRunId, 'T1486', 'host', 'catalogue'),
      ]);

      const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

      const { events, runs } = res.json.result.data;
      expect(runs).toEqual([{ id: middleRunId, createdAt: '2026-10-03T08:01:00.000Z', readAt: middleReadAt.toISOString() }]);
      expect(events.filter((event: { category: string }) => event.category === 'technique-coverage')).toEqual([
        expect.objectContaining({
          moment: { kind: 'run', runId: middleRunId },
          direction: 'up',
          item: expect.objectContaining({ key: 'T1078/identity', link: { kind: 'technique', externalId: 'T1078' } }),
          sentence: { key: 'uncontested-by-estate', parts: { technique: 'T1078', family: 'identity' } },
          values: null,
        }),
        expect.objectContaining({ moment: { kind: 'run', runId: laterRunId }, direction: 'up', sentence: expect.objectContaining({ key: 'uncontestable-by-catalogue' }) }),
        expect.objectContaining({ moment: { kind: 'run', runId: laterRunId }, direction: 'down', item: expect.objectContaining({ key: 'T1566/host' }) }),
      ]);
    });

    it('should list no pair against a run that stored no gap', async () => {
      const unstoredRunId = await insertRun(
        { riskScenarioId, createdAt: new Date('2026-09-20T10:00:00Z'), catalogueVintage: 'attack-enterprise-17', uncontestedPairCount: null, uncontestablePairCount: null },
        [['ransomware_operator', 0.41], ['state_sponsored', 0.22]],
      );
      await db.insert(crqIndicatorRunReachGaps).values([gap(laterRunId, 'T1078', 'identity', 'estate')]);

      const res = await getRunChanges({ riskScenarioId, firstRunId: unstoredRunId, secondRunId: laterRunId });

      const { events } = res.json.result.data;
      expect(events.some((event: { category: string }) => event.category === 'technique-coverage')).toBe(false);
    });
  });

  describe('controls', () => {
    let edrId: string;
    let backupsId: string;
    let mfaId: string;
    let unleveredId: string;
    let edrName: string;

    const lever = (runId: string, controlId: string, currentStrength: StrengthRung, currentCoverage: CoverageBucket): typeof crqControlWhatIfResults.$inferInsert => ({
      id: uuidv7(),
      runId,
      controlId,
      controlKind: 'capability',
      dimension: 'strength',
      currentStrength,
      upgradedStrength: 'L3',
      currentCoverage,
      upgradedCoverage: 'L3',
    });

    const assessment = (
      capabilityId: string,
      createdAt: string,
      newStrength: StrengthRung | null,
      newCoverage: CoverageBucket | null,
      onScope = false,
    ): typeof controlCapabilityAssessmentEvents.$inferInsert => ({
      id: uuidv7(),
      capabilityId,
      tenantId,
      organizationId: onScope ? organizationId : null,
      type: 'assessment_change',
      newStrength,
      newCoverage,
      createdAt: new Date(createdAt),
    });

    beforeEach(async () => {
      const capabilities = await db.select({ id: controlCapabilities.id, name: controlCapabilities.name })
        .from(controlCapabilities)
        .orderBy(asc(controlCapabilities.externalId))
        .limit(4);
      [edrId, backupsId, mfaId, unleveredId] = capabilities.map((capability) => capability.id);
      edrName = capabilities[0].name;
      await db.insert(crqControlWhatIfResults).values([
        lever(earlierRunId, edrId, 'L3', 'L2'),
        lever(laterRunId, edrId, 'L2', 'L2'),
        lever(earlierRunId, backupsId, 'L2', 'L1'),
        lever(laterRunId, backupsId, 'L2', 'L2'),
        lever(laterRunId, mfaId, 'L1', 'L1'),
      ]);
      await db.insert(controlCapabilityAssessmentEvents).values([
        assessment(edrId, '2026-09-01T00:00:00Z', 'L3', 'L2'),
        assessment(edrId, '2026-10-03T14:00:00Z', 'L2', null, true),
        assessment(edrId, '2026-10-06T10:00:00Z', 'L1', null, true),
        assessment(mfaId, '2026-09-01T00:00:00Z', 'L1', 'L0'),
        assessment(mfaId, '2026-10-02T09:00:00Z', 'L1', 'L1'),
        assessment(unleveredId, '2026-09-01T00:00:00Z', 'L3', 'L3'),
        assessment(unleveredId, '2026-10-02T09:00:00Z', 'L1', 'L3'),
      ]);
    });

    it('should list each lever whose strength or coverage moved between the two runs, as the runs stored it, dated on its event', async () => {
      const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

      const controls = res.json.result.data.events.filter((event: { category: string }) => event.category === 'controls');
      expect(controls).toContainEqual({
        category: 'controls',
        moment: { kind: 'recorded', at: '2026-10-03T14:00:00.000Z' },
        direction: 'up',
        item: { kind: 'control', key: `${edrId}/strength`, label: edrName, link: { kind: 'control', controlId: edrId } },
        sentence: { key: 'strength-changed-on-scope', parts: { control: edrName, from: 'L3', to: 'L2', scope: 'Acme' } },
        values: null,
      });
      expect(controls).toContainEqual(expect.objectContaining({
        moment: { kind: 'run', runId: laterRunId },
        direction: 'down',
        item: expect.objectContaining({ key: `${backupsId}/coverage` }),
        sentence: expect.objectContaining({ key: 'coverage-changed', parts: expect.objectContaining({ from: 'L1', to: 'L2' }) }),
      }));
      expect(controls).toContainEqual(expect.objectContaining({
        moment: { kind: 'recorded', at: '2026-10-02T09:00:00.000Z' },
        item: expect.objectContaining({ key: `${mfaId}/coverage` }),
        sentence: expect.objectContaining({ parts: expect.objectContaining({ from: 'L0', to: 'L1' }) }),
      }));
      expect(controls).toHaveLength(3);
    });

    it('should list no control a run did not treat as a lever', async () => {
      const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

      const { events } = res.json.result.data;
      expect(events.some((event: { item: { key: string } }) => event.item.key.startsWith(unleveredId))).toBe(false);
    });
  });

  describe('asset posture', () => {
    let assetIds: Record<'fw' | 'mft' | 'srv' | 'outside', string>;

    beforeEach(async () => {
      assetIds = { fw: uuidv7(), mft: uuidv7(), srv: uuidv7(), outside: uuidv7() };
      await db.insert(supportingAssets).values(Object.entries(assetIds).map(([name, id]) => ({ id, tenantId, name, categoryId: 'host' as const })));
      const line = (asset: keyof typeof assetIds, changedAt: string, score: number | null) =>
        ({ id: uuidv7(), tenantId, supportingAssetId: assetIds[asset], changedAt: new Date(changedAt), score });
      await db.insert(assetPostureHistory).values([
        line('fw', '2026-09-20T00:00:00Z', 60),
        line('fw', '2026-10-03T14:00:00Z', 12),
        line('fw', '2026-10-06T05:00:00Z', 90),
        line('mft', '2026-09-20T00:00:00Z', 40),
        line('mft', '2026-10-02T00:00:00Z', 55),
        line('srv', '2026-09-20T00:00:00Z', 30),
        line('srv', '2026-10-02T00:00:00Z', 45),
        line('outside', '2026-09-20T00:00:00Z', 60),
        line('outside', '2026-10-02T00:00:00Z', 10),
      ]);
      const foreignTenantId = await createTenant(services, adminId);
      const foreignAssetId = uuidv7();
      await db.insert(supportingAssets).values({ id: foreignAssetId, tenantId: foreignTenantId, name: 'foreign', categoryId: 'host' });
      await db.insert(assetPostureHistory).values([
        { id: uuidv7(), tenantId: foreignTenantId, supportingAssetId: foreignAssetId, changedAt: new Date('2026-09-01T00:00:00Z'), score: 60 },
        { id: uuidv7(), tenantId: foreignTenantId, supportingAssetId: foreignAssetId, changedAt: new Date('2026-10-02T00:00:00Z'), score: 10 },
      ]);
      await scoped.organizations.updateOrganization(organizationId, {
        estateMode: 'closed',
        mapping: { added: [assetIds.fw, assetIds.mft, assetIds.srv], removed: [] },
      });
    });

    const postureEvents = async (firstRunId: string) => {
      const res = await getRunChanges({ riskScenarioId, firstRunId, secondRunId: laterRunId });
      return res.json.result.data.events.filter((event: { category: string }) => event.category.startsWith('assets-'));
    };

    interface Group { kind: string, from: string, to: string, up: number, down: number, bands: Array<{ from: string | null, to: string | null, count: number }> }
    interface Row { item: { kind: string, key: string, label: string | null, link: unknown }, from: string | null, to: string | null, assets: number | null, at: string, direction: string }

    const getRunChangeGroup = (firstRunId: string, category: string, group: Group, page: { offset: number, limit: number, search?: string, sort?: { by: string, desc: boolean } }) => client.query('aleChangeExplain.getRunChangeGroup', {
      riskScenarioId, firstRunId, secondRunId: laterRunId, category, kind: group.kind, from: group.from, to: group.to, search: '', ...page,
    }, { tenantId });

    const postureRows = async (firstRunId: string): Promise<Array<Row & { category: string }>> => {
      const events: Array<{ category: string, group: Group }> = await postureEvents(firstRunId);
      const pages = await Promise.all(events.map(async ({ category, group }) => {
        const { rows } = (await getRunChangeGroup(firstRunId, category, group, { offset: 0, limit: 100 })).json.result.data;
        return rows.map((row: Row) => ({ ...row, category }));
      }));
      return pages.flat();
    };

    it('should group the scope\'s assets whose band moved between the two reading times, down to one, each in the higher band it held', async () => {
      expect(await postureEvents(earlierRunId)).toEqual([
        expect.objectContaining({
          category: 'assets-high',
          moment: { kind: 'recorded', at: '2026-10-02T00:00:00.000Z' },
          direction: 'down',
          item: { kind: 'asset-group', key: 'posture-moved', label: null, link: null },
          group: expect.objectContaining({ up: 0, down: 1, bands: [{ from: 'high', to: 'medium', count: 1 }] }),
        }),
        expect.objectContaining({
          category: 'assets-critical',
          moment: { kind: 'recorded', at: '2026-10-03T14:00:00.000Z' },
          direction: 'up',
          group: expect.objectContaining({ up: 1, down: 0, bands: [{ from: 'medium', to: 'critical', count: 1 }] }),
        }),
      ]);
      expect(await postureRows(earlierRunId)).toEqual([
        {
          category: 'assets-high',
          item: { kind: 'asset', key: assetIds.mft, label: 'mft', link: { kind: 'asset', supportingAssetId: assetIds.mft } },
          from: 'high',
          to: 'medium',
          assets: null,
          at: '2026-10-02T00:00:00.000Z',
          direction: 'down',
        },
        expect.objectContaining({ category: 'assets-critical', item: expect.objectContaining({ key: assetIds.fw }), from: 'medium', to: 'critical' }),
      ]);
    });

    it('should count every asset first measured after an earlier run older than the posture history in one group, at its band at the later run, then group its moves through High or Critical', async () => {
      const olderRunId = await insertRun(
        { riskScenarioId, createdAt: new Date('2026-09-10T10:00:00Z'), catalogueVintage: 'attack-enterprise-17' },
        [['ransomware_operator', 0.41], ['state_sponsored', 0.22]],
      );

      const events: Array<{ category: string, direction: string, item: { kind: string, label: string | null }, sentence: unknown, group?: unknown }> = await postureEvents(olderRunId);
      expect(events.map((event) => [event.category, event.item.kind, event.direction])).toEqual([
        ['assets-other', 'asset-group', 'none'],
        ['assets-high', 'asset-group', 'down'],
        ['assets-critical', 'asset-group', 'up'],
      ]);
      expect(events[0].group).toEqual({
        kind: 'first-measured',
        from: '2026-09-20T00:00:00.000Z',
        to: '2026-09-20T00:00:00.000Z',
        up: 0,
        down: 0,
        bands: [{ from: null, to: 'critical', count: 1 }, { from: null, to: 'high', count: 1 }, { from: null, to: 'medium', count: 1 }],
      });
    });

    it('should list the whole estate of its own tenant only', async () => {
      await scoped.organizations.updateOrganization(organizationId, { estateMode: 'open' });

      const listed = (await postureRows(earlierRunId)).map((row) => row.item.label);
      expect(listed.toSorted()).toEqual(['fw', 'mft', 'outside']);
    });

    const insertAssets = async (entries: Array<{ name: string, lines: Array<[string, number | null]> }>) => {
      const rows = entries.map((entry) => ({ ...entry, id: uuidv7() }));
      await db.insert(supportingAssets).values(rows.map((row) => ({ id: row.id, tenantId, name: row.name, categoryId: 'host' as const })));
      await db.insert(assetPostureHistory).values(rows.flatMap((row) => row.lines.map(([changedAt, score]) => ({
        id: uuidv7(), tenantId, supportingAssetId: row.id, changedAt: new Date(changedAt), score,
      }))));
      await scoped.organizations.updateOrganization(organizationId, { mapping: { added: rows.map((row) => row.id), removed: [] } });
      return rows;
    };

    describe('critical and high assets', () => {
      const eventsOf = async (category: string): Promise<Array<{ item: { kind: string, label: string | null }, group?: Group }>> =>
        (await postureEvents(earlierRunId)).filter((event: { category: string }) => event.category === category);

      it('should count the assets moving into Critical on one day in one group, with no event per asset', async () => {
        await insertAssets(Array.from({ length: 6 }, (_, index) => ({
          name: `ws-compta-${index + 1}`,
          lines: [['2026-09-20T00:00:00Z', index === 0 ? 60 : 30], [`2026-10-02T09:0${index}:00Z`, 10]] as Array<[string, number | null]>,
        })));

        const events = await eventsOf('assets-critical');

        expect(events.map((event) => [event.item.kind, event.group?.up])).toEqual([['asset-group', 6], ['asset-group', 1]]);
        expect(events[0].group).toEqual({
          kind: 'posture-moved',
          from: '2026-10-02T09:00:00.000Z',
          to: '2026-10-02T09:05:00.000Z',
          up: 6,
          down: 0,
          bands: [{ from: 'high', to: 'critical', count: 5 }, { from: 'medium', to: 'critical', count: 1 }],
        });
      });

      it('should page and search the assets of a Critical group, and none of the other assets of that day', async () => {
        await insertAssets([
          ...Array.from({ length: 12 }, (_, index) => ({
            name: `ws-${String(index + 1).padStart(2, '0')}`,
            lines: [['2026-09-20T00:00:00Z', 30], [`2026-10-02T09:${String(index).padStart(2, '0')}:00Z`, 10]] as Array<[string, number | null]>,
          })),
          { name: 'ws-other', lines: [['2026-09-20T00:00:00Z', 80], ['2026-10-02T09:03:00Z', 60]] },
        ]);
        const [{ group }] = await eventsOf('assets-critical');
        if (group === undefined) {
          throw new Error('expected a group');
        }

        const first = (await getRunChangeGroup(earlierRunId, 'assets-critical', group, { offset: 0, limit: 10 })).json.result.data;
        const second = (await getRunChangeGroup(earlierRunId, 'assets-critical', group, { offset: 10, limit: 10 })).json.result.data;
        const found = (await getRunChangeGroup(earlierRunId, 'assets-critical', group, { offset: 0, limit: 10, search: 'WS-1' })).json.result.data;

        expect([first.rows.length, second.rows.length, first.total]).toEqual([10, 2, 12]);
        expect([...first.rows, ...second.rows].map((row: Row) => row.item.label)).toEqual(Array.from({ length: 12 }, (_, index) => `ws-${String(index + 1).padStart(2, '0')}`));
        expect(found.rows.map((row: Row) => [row.item.label, row.from, row.to])).toEqual([['ws-10', 'high', 'critical'], ['ws-11', 'high', 'critical'], ['ws-12', 'high', 'critical']]);
      });

      it('should search the assets of a group across accents and ligatures in both directions', async () => {
        await insertAssets([
          { name: 'École Straße', lines: [['2026-09-20T00:00:00Z', 30], ['2026-10-02T09:00:00Z', 10]] },
          { name: 'ws-plain', lines: [['2026-09-20T00:00:00Z', 30], ['2026-10-02T09:01:00Z', 10]] },
        ]);
        const [{ group }] = await eventsOf('assets-critical');
        if (group === undefined) {
          throw new Error('expected a group');
        }
        const labels = async (search: string) =>
          (await getRunChangeGroup(earlierRunId, 'assets-critical', group, { offset: 0, limit: 10, search })).json.result.data.rows.map((row: Row) => row.item.label);

        expect(await labels('ecole')).toEqual(['École Straße']);
        expect(await labels('strasse')).toEqual(['École Straße']);
        expect(await labels('WS-pláin')).toEqual(['ws-plain']);
      });

      it('should order the assets of a group by the column asked, by the posture left within one reached, then by name', async () => {
        await insertAssets(Array.from({ length: 6 }, (_, index) => ({
          name: `ws-${index + 1}`,
          lines: [['2026-09-20T00:00:00Z', index < 3 ? 30 : 50], [`2026-10-02T09:0${5 - index}:00Z`, 10]] as Array<[string, number | null]>,
        })));
        const [{ group }] = await eventsOf('assets-critical');
        if (group === undefined) {
          throw new Error('expected a group');
        }
        const labels = async (sort: { by: string, desc: boolean }) =>
          (await getRunChangeGroup(earlierRunId, 'assets-critical', group, { offset: 0, limit: 10, sort })).json.result.data.rows.map((row: Row) => row.item.label);

        expect(await labels({ by: 'time', desc: false })).toEqual(['ws-6', 'ws-5', 'ws-4', 'ws-3', 'ws-2', 'ws-1']);
        expect(await labels({ by: 'item', desc: true })).toEqual(['ws-6', 'ws-5', 'ws-4', 'ws-3', 'ws-2', 'ws-1']);
        expect(await labels({ by: 'band', desc: true })).toEqual(['ws-4', 'ws-5', 'ws-6', 'ws-1', 'ws-2', 'ws-3']);
      });

      it('should count the assets moving into High on one day in one group, apart from the one leaving High the day before', async () => {
        await insertAssets(Array.from({ length: 2 }, (_, index) => ({
          name: `srv-${index + 1}`,
          lines: [['2026-09-20T00:00:00Z', 60], [`2026-10-03T09:0${index}:00Z`, 30]] as Array<[string, number | null]>,
        })));

        const high = await eventsOf('assets-high');

        expect(high.map((event) => [event.item.kind, event.group?.bands])).toEqual([
          ['asset-group', [{ from: 'high', to: 'medium', count: 1 }]],
          ['asset-group', [{ from: 'medium', to: 'high', count: 2 }]],
        ]);
      });
    });

    describe('other assets', () => {
      const otherAssetEvents = async (firstRunId: string): Promise<Array<{ item: { kind: string }, group: Group }>> =>
        (await postureEvents(firstRunId)).filter((event: { category: string }) => event.category === 'assets-other');

      it('should count the posture moves of other assets per day, with no event per asset', async () => {
        await insertAssets([
          { name: 'ws-01', lines: [['2026-09-20T00:00:00Z', 80], ['2026-10-02T09:00:00Z', 60]] },
          { name: 'ws-02', lines: [['2026-09-20T00:00:00Z', 80], ['2026-10-02T10:00:00Z', 55]] },
          { name: 'ws-03', lines: [['2026-09-20T00:00:00Z', 60], ['2026-10-02T11:00:00Z', 90]] },
          { name: 'ws-04', lines: [['2026-09-20T00:00:00Z', 60], ['2026-10-04T08:00:00Z', null]] },
        ]);

        const events = await otherAssetEvents(earlierRunId);

        expect(events.map((event) => event.item.kind)).toEqual(['asset-group', 'asset-group']);
        expect(events.map((event) => event.group)).toEqual([
          {
            kind: 'posture-moved',
            from: '2026-10-02T09:00:00.000Z',
            to: '2026-10-02T11:00:00.000Z',
            up: 2,
            down: 1,
            bands: [{ from: 'low', to: 'medium', count: 2 }, { from: 'medium', to: 'low', count: 1 }],
          },
          { kind: 'posture-moved', from: '2026-10-04T08:00:00.000Z', to: '2026-10-04T08:00:00.000Z', up: 0, down: 1, bands: [{ from: 'medium', to: null, count: 1 }] },
        ]);
      });

      it('should page a group\'s assets worst posture at the later run first, then by name, with their total', async () => {
        await insertAssets(Array.from({ length: 25 }, (_, index) => ({
          name: `srv-${String(index + 1).padStart(2, '0')}`,
          lines: [[`2026-10-02T09:${String(index).padStart(2, '0')}:00Z`, [80, 60, null][index % 3]]] as Array<[string, number | null]>,
        })));
        const [{ group }] = await otherAssetEvents(earlierRunId);

        expect(group.kind).toBe('first-measured');
        const pages = [];
        for (const offset of [0, 10, 20]) {
          const res = await getRunChangeGroup(earlierRunId, 'assets-other', group, { offset, limit: 10 });
          expect(res.status).toBe(200);
          pages.push(res.json.result.data);
        }

        expect(pages.map((page) => [page.rows.length, page.total])).toEqual([[10, 25], [10, 25], [5, 25]]);
        const rows: Array<Row> = pages.flatMap((page) => page.rows);
        expect(rows.map((row) => row.to)).toEqual([...Array.from({ length: 8 }, () => 'medium'), ...Array.from({ length: 9 }, () => 'low'), ...Array.from({ length: 8 }, () => null)]);
        expect(rows.slice(0, 3).map((row) => row.item.label)).toEqual(['srv-02', 'srv-05', 'srv-08']);
        expect(rows[0]).toEqual({
          item: { kind: 'asset', key: expect.any(String), label: 'srv-02', link: { kind: 'asset', supportingAssetId: rows[0].item.key } },
          from: null,
          to: 'medium',
          assets: null,
          at: '2026-10-02T09:01:00.000Z',
          direction: 'none',
        });
      });

      it('should search a group\'s assets by name, its total following the search', async () => {
        await insertAssets([
          { name: 'ws-compta-12', lines: [['2026-09-20T00:00:00Z', 80], ['2026-10-02T14:07:00Z', 60]] },
          { name: 'ws-rh-05', lines: [['2026-09-20T00:00:00Z', 80], ['2026-10-02T14:09:00Z', 60]] },
          { name: 'srv-erp-01', lines: [['2026-09-20T00:00:00Z', 60], ['2026-10-02T10:44:00Z', 90]] },
        ]);
        const [{ group }] = await otherAssetEvents(earlierRunId);

        const found = (await getRunChangeGroup(earlierRunId, 'assets-other', group, { offset: 0, limit: 10, search: 'WS-' })).json.result.data;
        const none = (await getRunChangeGroup(earlierRunId, 'assets-other', group, { offset: 0, limit: 10, search: 'db-' })).json.result.data;

        expect([found.total, found.rows.map((row: Row) => [row.item.label, row.from, row.to, row.direction])]).toEqual([
          2,
          [['ws-compta-12', 'low', 'medium', 'up'], ['ws-rh-05', 'low', 'medium', 'up']],
        ]);
        expect(none).toEqual({ rows: [], total: 0 });
      });
    });
  });

  describe('findings', () => {
    const DAY = 86_400_000;
    const now = Date.now();
    // Relative to now, since a CVE is read only inside the unique finding journal's retention.
    const day = (offset: number) => new Date(now + offset * DAY);
    const SCORES = { critical: 95, high: 80, medium: 50, low: 10 } as const;
    let earlierId: string;
    let laterId: string;

    type Line = [Date, keyof typeof SCORES | null, number | null];

    const journal = async (cveId: string, lines: Array<Line>, scope: { tenantId?: string, organizationId?: string | null } = {}) => {
      const lineTenantId = scope.tenantId ?? tenantId;
      const cveRowId = uuidv7();
      await db.insert(cve).values({ id: cveRowId, tenantId: lineTenantId, cveId });
      await db.insert(uniqueFindingScoreHistory).values(lines.map(([changedAt, band, affectedAssetCount]) => ({
        id: uuidv7(),
        tenantId: lineTenantId,
        organizationId: scope.organizationId === undefined ? organizationId : scope.organizationId,
        cveId: cveRowId,
        score: band === null ? null : SCORES[band],
        band,
        affectedAssetCount,
        changedAt,
      })));
      return cveRowId;
    };

    beforeEach(async () => {
      await scoped.organizations.updateOrganization(organizationId, { estateMode: 'closed' });
      earlierId = await insertRun({ riskScenarioId, createdAt: day(-6), catalogueVintage: 'attack-enterprise-17' }, [['ransomware_operator', 0.41]]);
      laterId = await insertRun({ riskScenarioId, createdAt: day(-1), catalogueVintage: 'attack-enterprise-17' }, [['ransomware_operator', 0.41]]);

      await journal('CVE-2024-3400', [[day(-5), 'critical', 2]]);
      await journal('CVE-2023-27350', [[day(-30), 'high', 2], [day(-3), 'critical', 2]]);
      await journal('CVE-2023-0001', [[day(-30), 'critical', 1], [day(-3), 'critical', 3]]);
      await journal('CVE-2023-34362', [[day(-30), 'high', 2], [day(-4), 'high', 1], [day(-3), null, null]]);
      await journal('CVE-2022-0002', [[day(-30), 'high', 1], [day(-2), 'medium', 1]]);
      await journal('CVE-2021-9999', [[day(-5), 'critical', 1]], { organizationId: null });
      await journal('CVE-2021-8888', [[day(-5), 'critical', 1]], { tenantId: await createTenant(services, adminId), organizationId: null });
    });

    const findingEvents = async (firstRunId: string) => {
      const res = await getRunChanges({ riskScenarioId, firstRunId, secondRunId: laterId });
      return res.json.result.data.events.filter((event: { category: string }) => event.category.startsWith('findings-'));
    };

    interface FindingRow { category: string, kind: string, item: { key: string, link: unknown }, from: string | null, to: string | null, at: string, direction: string }

    const findingRows = async (firstRunId: string): Promise<Array<FindingRow>> => {
      const events: Array<{ category: string, group: { kind: string, from: string, to: string } }> = await findingEvents(firstRunId);
      const pages = await Promise.all(events.map(async ({ category, group }) => {
        const res = await client.query('aleChangeExplain.getRunChangeGroup', {
          riskScenarioId, firstRunId, secondRunId: laterId, category, kind: group.kind, from: group.from, to: group.to, search: '', offset: 0, limit: 100,
        }, { tenantId });
        return res.json.result.data.rows.map((row: FindingRow) => ({ ...row, category, kind: group.kind }));
      }));
      return pages.flat();
    };

    it('should group each CVE unique finding of the scope once, appeared, left or moved band, in the higher band it held, down to one CVE', async () => {
      const events: Array<{ item: { kind: string } }> = await findingEvents(earlierId);

      expect(events.map((event) => event.item.kind)).toEqual(['cve-group', 'cve-group', 'cve-group', 'cve-group']);
      expect(await findingRows(earlierId)).toEqual([
        expect.objectContaining({
          category: 'findings-critical',
          kind: 'appeared',
          item: { kind: 'cve', key: 'CVE-2024-3400', label: 'CVE-2024-3400', link: { kind: 'cve', cveId: 'CVE-2024-3400' } },
          from: null,
          to: 'critical',
          at: day(-5).toISOString(),
          direction: 'up',
        }),
        expect.objectContaining({
          category: 'findings-critical',
          kind: 'band-moved',
          item: expect.objectContaining({ key: 'CVE-2023-27350' }),
          from: 'high',
          to: 'critical',
          at: day(-3).toISOString(),
          direction: 'up',
        }),
        expect.objectContaining({
          category: 'findings-high',
          kind: 'left',
          item: expect.objectContaining({ key: 'CVE-2023-34362', link: { kind: 'cve-findings', cveId: 'CVE-2023-34362', state: 'dismissed' } }),
          from: 'high',
          to: null,
          at: day(-3).toISOString(),
          direction: 'down',
        }),
        expect.objectContaining({
          category: 'findings-high',
          kind: 'band-moved',
          item: expect.objectContaining({ key: 'CVE-2022-0002' }),
          from: 'high',
          to: 'medium',
          at: day(-2).toISOString(),
          direction: 'down',
        }),
      ]);
    });

    it('should date an appearance on the presence still held at the later run, and a departure on the last one', async () => {
      await journal('CVE-2022-1111', [[day(-5), 'critical', 1], [day(-4), null, null], [day(-2), 'critical', 1]]);
      await journal('CVE-2022-2222', [[day(-30), 'high', 1], [day(-5), null, null], [day(-4), 'high', 1], [day(-2), null, null]]);

      const rows = await findingRows(earlierId);
      const rowOf = (key: string) => rows.find((row) => row.item.key === key);
      expect(rowOf('CVE-2022-1111')).toMatchObject({ at: day(-2).toISOString(), kind: 'appeared' });
      expect(rowOf('CVE-2022-2222')).toMatchObject({ at: day(-2).toISOString(), kind: 'left' });
    });

    describe('a CVE that left', () => {
      let assetIds: Array<string>;

      /**
       * One finding per dismissal, each on its own asset of the scope, created at `createdAt` and
       * applicable from `since` (both day -30 by default), the CVE leaving the journal at day -3 after
       * holding `assetsBefore` assets, by default those the dismissals were made on, in the scope's own
       * journal or, with `journalScope`, another one.
       */
      const leftWith = async (
        cveId: string,
        dismissals: Array<{ origin: 'not_exposed' | 'no_longer_reported' | 'user', at: Date, since?: Date, createdAt?: Date }>,
        assetsBefore = dismissals.length,
        journalScope: Parameters<typeof journal>[2] = {},
      ) => {
        const cveRowId = await journal(cveId, [[day(-30), 'high', assetsBefore], [day(-3), null, null]], journalScope);
        for (const [index, { origin, at, since = day(-30), createdAt = day(-30) }] of dismissals.entries()) {
          const evidenceId = uuidv7();
          await db.insert(assetEvidence).values({ id: evidenceId, supportingAssetId: assetIds[index], tenantId, cveId: cveRowId, userId: adminId, createdAt });
          await db.insert(assetEvidenceHistory).values([
            { id: uuidv7(), tenantId, assetEvidenceId: evidenceId, state: 'applicable', stateChangedAt: since, observedAt: since, origin: 'exposed' },
            { id: uuidv7(), tenantId, assetEvidenceId: evidenceId, state: 'dismissed', stateChangedAt: at, observedAt: origin === 'user' ? null : at, origin },
          ]);
        }
      };

      const kindOf = async (cveId: string) => (await findingRows(earlierId)).find((row) => row.item.key === cveId)?.kind;

      beforeEach(async () => {
        assetIds = [uuidv7(), uuidv7()];
        await db.insert(supportingAssets).values(assetIds.map((id, index) => ({ id, tenantId, name: `srv-${index}`, categoryId: 'host' as const })));
        await scoped.organizations.updateOrganization(organizationId, { mapping: { added: assetIds, removed: [] } });
        await db.update(organizations).set({ estateChangedAt: day(-30) }).where(eq(organizations.id, organizationId));
      });

      it('should read as no longer reported when a connector dismissed every finding it left', async () => {
        await leftWith('CVE-2020-1001', [{ origin: 'no_longer_reported', at: day(-3) }, { origin: 'not_exposed', at: day(-4) }]);

        expect(await kindOf('CVE-2020-1001')).toBe('no-longer-reported');
      });

      it('should read as no longer applying when a person dismissed it', async () => {
        await leftWith('CVE-2020-1002', [{ origin: 'user', at: day(-3) }]);

        expect(await kindOf('CVE-2020-1002')).toBe('left');
      });

      it('should read as no longer applying when a person dismissed one of its findings and a connector the other', async () => {
        await leftWith('CVE-2020-1003', [{ origin: 'no_longer_reported', at: day(-3) }, { origin: 'user', at: day(-4) }]);

        expect(await kindOf('CVE-2020-1003')).toBe('left');
      });

      it('should read as no longer applying when one of its assets left the scope and a connector dismissed the other', async () => {
        await leftWith('CVE-2020-1005', [{ origin: 'no_longer_reported', at: day(-3) }], 2);

        expect(await kindOf('CVE-2020-1005')).toBe('left');
      });

      it('should read as no longer applying when a finding new since the earlier run stands in for an asset that left the scope', async () => {
        await leftWith('CVE-2020-1006', [{ origin: 'no_longer_reported', at: day(-3) }, { origin: 'no_longer_reported', at: day(-3), since: day(-4) }], 2);

        expect(await kindOf('CVE-2020-1006')).toBe('left');
      });

      it('should read as no longer applying when a finding synced since, its observation dated earlier, stands in for an asset that left', async () => {
        await scoped.organizations.updateOrganization(organizationId, { estateMode: 'open' });
        await db.update(organizations).set({ estateChangedAt: day(-30) }).where(eq(organizations.id, organizationId));
        await leftWith('CVE-2020-1008', [{ origin: 'no_longer_reported', at: day(-3) }, { origin: 'no_longer_reported', at: day(-3), createdAt: day(-2) }], 2, { organizationId: null });

        expect(await kindOf('CVE-2020-1008')).toBe('left');
      });

      it('should read as no longer applying when the scope\'s assets changed since the earlier run', async () => {
        await leftWith('CVE-2020-1007', [{ origin: 'no_longer_reported', at: day(-3) }]);
        await scoped.organizations.updateOrganization(organizationId, { mapping: { added: [], removed: [assetIds[1]] } });

        expect(await kindOf('CVE-2020-1007')).toBe('left');
      });

      it('should read as no longer applying when the connector dismissed it before the earlier run', async () => {
        await leftWith('CVE-2020-1004', [{ origin: 'no_longer_reported', at: day(-10) }]);

        expect(await kindOf('CVE-2020-1004')).toBe('left');
      });
    });

    it('should read the tenant\'s own journal once the scope opens', async () => {
      await scoped.organizations.updateOrganization(organizationId, { estateMode: 'open' });

      expect((await findingRows(earlierId)).map((row) => row.item.key)).toEqual(['CVE-2021-9999']);
    });

    it('should list no finding against an earlier run older than the unique finding journal', async () => {
      const olderId = await insertRun({ riskScenarioId, createdAt: day(-400), catalogueVintage: 'attack-enterprise-17' }, [['ransomware_operator', 0.41]]);

      expect(await findingEvents(olderId)).toEqual([]);
    });

    describe('other findings', () => {
      const today = new Date(now);
      // A fixed hour of a UTC day, so a line stays on its day whatever the time now.
      const at = (offset: number, hours: number) =>
        new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset) + hours * 3_600_000);

      interface Group {
        kind: string,
        from: string,
        to: string,
        up: number,
        down: number,
        bands: Array<{ from: string | null, to: string | null, count: number }>,
      }
      interface GroupEvent { moment: { at: string }, direction: string, item: { kind: string }, group: Group }

      const otherEvents = async (timeZone?: string): Promise<Array<GroupEvent>> => {
        const res = await getRunChanges({ riskScenarioId, firstRunId: earlierId, secondRunId: laterId, timeZone });
        return res.json.result.data.events.filter((event: { category: string }) => event.category === 'findings-other');
      };

      const getRunChangeGroup = (group: Group, page: { offset: number, limit: number, search?: string }, category = 'findings-other') => client.query('aleChangeExplain.getRunChangeGroup', {
        riskScenarioId, firstRunId: earlierId, secondRunId: laterId, category, kind: group.kind, from: group.from, to: group.to, search: '', ...page,
      }, { tenantId });

      const journalMany = async (entries: Array<{ cveId: string, lines: Array<Line> }>) => {
        const rows = entries.map((entry) => ({ ...entry, id: uuidv7() }));
        await db.insert(cve).values(rows.map((row) => ({ id: row.id, tenantId, cveId: row.cveId })));
        await db.insert(uniqueFindingScoreHistory).values(rows.flatMap((row) => row.lines.map(([changedAt, band, affectedAssetCount]) => ({
          id: uuidv7(),
          tenantId,
          organizationId,
          cveId: row.id,
          score: band === null ? null : SCORES[band],
          band,
          affectedAssetCount,
          changedAt,
        }))));
      };

      it('should count the other findings per day and change kind, with no event per CVE', async () => {
        await journal('CVE-2020-0001', [[at(-4, 8), 'medium', 3]]);
        await journal('CVE-2020-0002', [[at(-4, 9), 'medium', 1]]);
        await journal('CVE-2020-0003', [[at(-4, 10), 'low', 2]]);
        await journal('CVE-2020-0004', [[at(-4, 11), null, 1]]);
        await journal('CVE-2020-0005', [[day(-30), 'medium', 4], [at(-3, 9), null, null]]);
        await journal('CVE-2020-0006', [[day(-30), 'low', 4], [at(-2, 9), 'medium', 4]]);
        await journal('CVE-2020-0007', [[day(-30), 'low', 4], [at(-2, 10), 'medium', 5]]);
        await journal('CVE-2020-0008', [[day(-30), 'medium', 4], [at(-2, 11), 'low', 4]]);

        const events = await otherEvents();

        expect(events.map((event) => event.item.kind)).toEqual(['cve-group', 'cve-group', 'cve-group']);
        expect(events.map(({ moment, direction, group }) => ({ at: moment.at, direction, group }))).toEqual([
          {
            at: at(-4, 8).toISOString(),
            direction: 'up',
            group: {
              kind: 'appeared',
              from: at(-4, 8).toISOString(),
              to: at(-4, 11).toISOString(),
              up: 4,
              down: 0,
              bands: [{ from: null, to: 'medium', count: 2 }, { from: null, to: 'low', count: 1 }, { from: null, to: null, count: 1 }],
            },
          },
          {
            at: at(-3, 9).toISOString(),
            direction: 'down',
            group: { kind: 'left', from: at(-3, 9).toISOString(), to: at(-3, 9).toISOString(), up: 0, down: 1, bands: [{ from: 'medium', to: null, count: 1 }] },
          },
          {
            at: at(-2, 9).toISOString(),
            direction: 'up',
            group: {
              kind: 'band-moved',
              from: at(-2, 9).toISOString(),
              to: at(-2, 11).toISOString(),
              up: 2,
              down: 1,
              bands: [{ from: 'low', to: 'medium', count: 2 }, { from: 'medium', to: 'low', count: 1 }],
            },
          },
        ]);
      });

      it('should split a day\'s group at a run of that day carrying a change, where the chronology splits its CVEs', async () => {
        // Dated runs of the outer setup can fall inside this window and decide where the pair hangs.
        await db.delete(crqIndicatorRuns).where(inArray(crqIndicatorRuns.id, [earlierRunId, laterRunId]));
        const [technique] = await db.select({ id: mitreTechniques.id }).from(mitreTechniques).where(inArray(mitreTechniques.externalId, ['T1078']));
        const middleId = await insertRun(
          { riskScenarioId, createdAt: at(-4, 12.5), readAt: at(-4, 12), catalogueVintage: 'attack-enterprise-17' },
          [['ransomware_operator', 0.41]],
        );
        await db.insert(crqIndicatorRunReachGaps).values([middleId, laterId].map((runId) => ({
          id: uuidv7(), runId, mitreTechniqueId: technique.id, family: 'identity' as const, gap: 'estate' as const,
        })));
        await journal('CVE-2020-0011', [[at(-4, 8), 'medium', 1]]);
        await journal('CVE-2020-0013', [[at(-4, 12), 'medium', 1]]);
        await journal('CVE-2020-0012', [[at(-4, 16), 'medium', 1]]);

        testFeatureFlags.push('technique-coverage-changes');
        const changes = await getRunChanges({ riskScenarioId, firstRunId: earlierId, secondRunId: laterId }).finally(() => {
          testFeatureFlags.splice(testFeatureFlags.indexOf('technique-coverage-changes'), 1);
        });

        const events: Array<GroupEvent & { category: string }> = changes.json.result.data.events;
        expect(events
          .filter((event) => event.category === 'findings-other' || event.category === 'technique-coverage')
          .map((event) => (event.category === 'findings-other' ? [event.group.from, event.group.to] : event.category))).toEqual([
          [at(-4, 8).toISOString(), at(-4, 12).toISOString()],
          'technique-coverage',
          [at(-4, 16).toISOString(), at(-4, 16).toISOString()],
        ]);
      });

      it('should place a group on the reader\'s own calendar day', async () => {
        await journal('CVE-2020-0021', [[at(-4, -1), 'medium', 1]]);
        await journal('CVE-2020-0022', [[at(-4, 1), 'medium', 1]]);

        const countsIn = async (timeZone: string) => (await otherEvents(timeZone)).map((event) => event.group.up);

        expect(await countsIn('UTC')).toEqual([1, 1]);
        expect(await countsIn('Asia/Tokyo')).toEqual([2]);
      });

      it('should refuse a time zone it does not know', async () => {
        const res = await getRunChanges({ riskScenarioId, firstRunId: earlierId, secondRunId: laterId, timeZone: '+02:00' });

        expect(res.status).toBe(400);
      });

      it('should page a group\'s CVEs by asset count, with their total', async () => {
        await journalMany(Array.from({ length: 25 }, (_, index) => ({
          cveId: `CVE-2021-${String(index + 1).padStart(4, '0')}`,
          lines: [[at(-3, 9 + index / 60), 'medium', index + 1]],
        })));
        const [{ group }] = await otherEvents();

        const pages = [];
        for (const offset of [0, 10, 20]) {
          const res = await getRunChangeGroup(group, { offset, limit: 10 });
          expect(res.status).toBe(200);
          pages.push(res.json.result.data);
        }

        expect(pages.map((page) => [page.rows.length, page.total])).toEqual([[10, 25], [10, 25], [5, 25]]);
        expect(pages.flatMap((page) => page.rows.map((row: { assets: number }) => row.assets)))
          .toEqual(Array.from({ length: 25 }, (_, index) => 25 - index));
        expect(pages[0].rows[0]).toEqual({
          item: { kind: 'cve', key: 'CVE-2021-0025', label: 'CVE-2021-0025', link: { kind: 'cve', cveId: 'CVE-2021-0025' } },
          from: null,
          to: 'medium',
          assets: 25,
          at: at(-3, 9 + 24 / 60).toISOString(),
          direction: 'up',
        });
      });

      it('should search a group\'s CVEs by id, its total following the search', async () => {
        await journalMany(Array.from({ length: 25 }, (_, index) => ({
          cveId: `CVE-2021-${String(index + 1).padStart(4, '0')}`,
          lines: [[at(-3, 9 + index / 60), 'medium', index + 1]],
        })));
        const [{ group }] = await otherEvents();

        const found = (await getRunChangeGroup(group, { offset: 0, limit: 10, search: 'cve-2021-001' })).json.result.data;
        const none = (await getRunChangeGroup(group, { offset: 0, limit: 10, search: 'CVE-2099' })).json.result.data;

        expect([found.total, found.rows.map((row: { item: { key: string } }) => row.item.key)]).toEqual([
          10,
          ['CVE-2021-0019', 'CVE-2021-0018', 'CVE-2021-0017', 'CVE-2021-0016', 'CVE-2021-0015', 'CVE-2021-0014', 'CVE-2021-0013', 'CVE-2021-0012', 'CVE-2021-0011', 'CVE-2021-0010'],
        ]);
        expect(none).toEqual({ rows: [], total: 0 });
      });

      it('should page only the CVEs of the group asked, not those of the same kind on another day', async () => {
        await journal('CVE-2020-0031', [[at(-4, 9), 'medium', 1]]);
        await journal('CVE-2020-0032', [[day(-30), 'medium', 2], [at(-4, 10), 'medium', 3]]);
        await journal('CVE-2020-0033', [[at(-3, 9), 'medium', 1]]);
        const [first] = await otherEvents();

        const res = await getRunChangeGroup(first.group, { offset: 0, limit: 10 });

        expect(res.json.result.data.rows.map((row: { item: { key: string } }) => row.item.key)).toEqual(['CVE-2020-0031']);
      });

      it('should count the CVEs moving into High on one day in one group, paged apart from the other findings of that day', async () => {
        await journalMany(Array.from({ length: 7 }, (_, index) => ({
          cveId: `CVE-2019-${String(index + 1).padStart(4, '0')}`,
          lines: [[day(-30), index < 5 ? 'medium' : 'low', 2], [at(-4, 9 + index / 60), 'high', index + 1]],
        })));
        await journal('CVE-2019-9999',[[day(-30), 'low', 1], [at(-4, 9), 'medium', 1]]);

        const res = await getRunChanges({ riskScenarioId, firstRunId: earlierId, secondRunId: laterId });
        const high: Array<GroupEvent & { item: { key: string } }> = res.json.result.data.events.filter((event: { category: string }) => event.category === 'findings-high');
        const highGroup = high.find((event) => event.item.kind === 'cve-group');
        if (highGroup === undefined) {
          throw new Error('expected a High group');
        }
        const page = (await getRunChangeGroup(highGroup.group, { offset: 0, limit: 10 }, 'findings-high')).json.result.data;

        expect(high.map((event) => event.item.key)).toEqual(['band-moved', 'left', 'band-moved']);
        expect(highGroup.group.bands).toEqual([{ from: 'medium', to: 'high', count: 5 }, { from: 'low', to: 'high', count: 2 }]);
        expect([page.total, page.rows.map((row: { item: { key: string } }) => row.item.key)]).toEqual([
          7,
          ['CVE-2019-0007', 'CVE-2019-0006', 'CVE-2019-0005', 'CVE-2019-0004', 'CVE-2019-0003', 'CVE-2019-0002', 'CVE-2019-0001'],
        ]);
      });

      it('should keep a comparison holding thousands of other findings under 100 KB', async () => {
        await journalMany(Array.from({ length: 3_000 }, (_, index) => ({
          cveId: `CVE-2022-${String(index + 1).padStart(5, '0')}`,
          lines: index % 3 === 0
            ? [[day(-30), 'medium', 2], [at(-2, 10), null, null]]
            : [[at(-3 - (index % 2), 10 + (index % 7)), index % 2 === 0 ? 'medium' : 'low', 1 + (index % 50)]],
        })));

        const res = await getRunChanges({ riskScenarioId, firstRunId: earlierId, secondRunId: laterId });

        expect(res.status).toBe(200);
        expect(Buffer.byteLength(JSON.stringify(res.json))).toBeLessThan(100_000);
        const others: Array<GroupEvent> = res.json.result.data.events.filter((event: { category: string }) => event.category === 'findings-other');
        expect(others.every((event) => event.item.kind === 'cve-group')).toBe(true);
        expect(others.reduce((sum, event) => sum + event.group.up + event.group.down, 0)).toBe(3_000);
      });
    });
  });

  describe('attack frequency', () => {
    it('should name the catalogue an automatic estimate moved to, from a multiplier vintage, dated when the new estimate was written', async () => {
      await db.insert(tefEstimates).values([
        { id: uuidv7(), riskScenarioId, catalogVintage: 2, min: 1, likely: 4, max: 7, positioned: true, fallbackReason: null, createdAt: new Date('2026-09-20T10:00:00Z') },
        {
          id: uuidv7(), riskScenarioId, catalogId: 'opencrq-open-data', catalogVersion: '1.0.0', min: 1, likely: 4, max: 7, positioned: true, fallbackReason: null,
          countryIsoAlpha3: 'FRA', sectorName: 'Finance', sizeSource: 'employee_count', readCountry: 'FR', readSector: 'Finance',
          readSizeClasses: ['5000+'], readSizeWeights: [1], notMeasured: [], sourceIds: ['filigran-intelligence'], createdAt: new Date('2026-10-03T08:00:00Z'),
        },
      ]);

      const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

      const { events } = res.json.result.data;
      expect(events.filter((event: { category: string }) => event.category === 'attack-frequency')).toEqual([{
        category: 'attack-frequency',
        moment: { kind: 'recorded', at: '2026-10-03T08:00:00.000Z' },
        direction: 'none',
        item: { kind: 'tef-read', key: 'catalogue', label: null, link: { kind: 'scenario-tab', tab: 'threat' } },
        sentence: { key: 'tef-catalogue-changed', parts: { beforeVintage: 2, after: 'opencrq-open-data 1.0.0' } },
        values: null,
      }]);
    });

    it('should name the countries a package read moved between, as the tenant names them', async () => {
      const readFrom = async (createdAt: Date, countryIsoAlpha3: string, readCountry: string) => db.insert(tefEstimates).values({
        id: uuidv7(), riskScenarioId, catalogId: 'opencrq-open-data', catalogVersion: '1.0.0', min: 1, likely: 4, max: 7, positioned: true, fallbackReason: null,
        countryIsoAlpha3, sectorName: null, sizeSource: 'none', readCountry, readSector: null, readSizeClasses: TEF_EVERY_SIZE.map((share) => share.sizeClass), readSizeWeights: TEF_EVERY_SIZE.map((share) => share.weight),
        notMeasured: ['size'], sourceIds: [], createdAt,
      });
      await readFrom(new Date('2026-09-20T10:00:00Z'), 'FRA', 'FR');
      await readFrom(new Date('2026-10-03T08:00:00Z'), 'DEU', 'DE');
      const countries = await scoped.countries.getCountries();
      const nameOf = (isoAlpha3: string) => countries.find((country) => country.isoAlpha3 === isoAlpha3)!.name;

      const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

      const { events } = res.json.result.data;
      expect(events.filter((event: { category: string }) => event.category === 'attack-frequency')).toEqual([expect.objectContaining({
        item: expect.objectContaining({ kind: 'tef-read', key: 'country' }),
        sentence: { key: 'tef-country-changed', parts: { before: nameOf('FRA'), after: nameOf('DEU') } },
      })]);
    });

    it('should list a raised manual triplet once, on the later run', async () => {
      await db.update(crqIndicatorRuns).set({ tefMin: 4, tefLikely: 5, tefMax: 8 }).where(inArray(crqIndicatorRuns.id, [laterRunId]));

      const res = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: laterRunId });

      const { events } = res.json.result.data;
      expect(events.filter((event: { category: string }) => event.category === 'attack-frequency')).toEqual([expect.objectContaining({
        moment: { kind: 'run', runId: laterRunId },
        direction: 'up',
        sentence: { key: 'tef-manual-changed', parts: { beforeMin: 1, beforeLikely: 4, beforeMax: 7, afterMin: 4, afterLikely: 5, afterMax: 8 } },
      })]);
    });
  });

  describe('the run curve', () => {
    const getRunCurve = (id: string) => client.query('aleChangeExplain.getRunCurve', { riskScenarioId: id }, { tenantId });

    it('should list one point per run of the scenario, newest first, with what each tab plots', async () => {
      await insertRun(
        { riskScenarioId: otherScenarioId, createdAt: new Date('2026-10-03T10:00:00Z'), catalogueVintage: 'attack-enterprise-18' },
        [['ransomware_operator', 1]],
      );

      const res = await getRunCurve(riskScenarioId);

      expect(res.status).toBe(200);
      const points = res.json.result.data;
      expect(points.map((point: { id: string }) => point.id)).toEqual([laterRunId, earlierRunId]);
      expect(points[0]).toEqual({
        id: laterRunId,
        createdAt: '2026-10-06T00:02:00.000Z',
        ale: null,
        tef: 4,
        susceptibility: expect.closeTo(pricedFraction({
          evicted: RUN_DEFAULTS.outcomeEvicted,
          impactDetected: RUN_DEFAULTS.outcomeImpactDetected,
          impactUndetected: RUN_DEFAULTS.outcomeImpactUndetected,
        }), 10),
        magnitude: 2_000_000,
      });
    });

    it('should round each figure to eight significant digits', async () => {
      const preciseRunId = await insertRun(
        { riskScenarioId: otherScenarioId, createdAt: new Date('2026-10-07T10:00:00Z'), catalogueVintage: 'attack-enterprise-18', aleMean: 15_315_926.412962947 },
        [['ransomware_operator', 1]],
      );

      const res = await getRunCurve(otherScenarioId);

      expect(res.json.result.data).toEqual([expect.objectContaining({ id: preciseRunId, ale: 15_315_926 })]);
    });

    it('should answer an empty curve for a scenario of another tenant', async () => {
      const otherTenantId = await createTenant(services, adminId);

      const res = await client.query('aleChangeExplain.getRunCurve', { riskScenarioId }, { tenantId: otherTenantId });

      expect(res.json.result.data).toEqual([]);
    });
  });

  it('should answer null for a run of another scenario, or one run given twice', async () => {
    const foreignRunId = await insertRun(
      { riskScenarioId: otherScenarioId, createdAt: new Date('2026-10-03T10:00:00Z'), catalogueVintage: 'attack-enterprise-18' },
      [['ransomware_operator', 1]],
    );

    const mixed = await getRunChanges({ riskScenarioId, firstRunId: earlierRunId, secondRunId: foreignRunId });
    const twice = await getRunChanges({ riskScenarioId, firstRunId: laterRunId, secondRunId: laterRunId });

    expect(mixed.json.result.data).toBeNull();
    expect(twice.json.result.data).toBeNull();
  });
});
