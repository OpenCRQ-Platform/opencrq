import type { EventOrigin, EvidenceLineSortKey } from '@app/module';
import {
  assetEvidence,
  assetEvidenceHistory,
  assetEvidenceVerdicts,
  controlTechniqueTestResults,
  controlValidationRepository,
  deriveControlValidation,
  EVIDENCE_LINE_SORT_KEYS,
  EXPECTATION_TYPE_TO_FUNCTION,
  indexScoredEdges,
  isFreshMeasurement,
  mitreTechniques,
  mitreTechniquesData,
  OPEN_ESTATE,
  resolveCellTechniqueId,
  resolveEffectiveEdges,
  resolveMeasuredResult,
  RiskScopeNotFoundError,
  supportingAssets,
  TECHNIQUE_T1003,
  TECHNIQUE_T1027,
  TECHNIQUE_T1027_002,
  TECHNIQUE_T1055,
  TECHNIQUE_T1055_012,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

// The EDR control scores T1003 for both functions and its sub-technique T1003.006 for neither.
const TECHNIQUE_T1003_006 = mitreTechniquesData.find((technique) => technique.externalId === 'T1003.006')!.id;
// The EDR control scores T1595 on neither function.
const TECHNIQUE_T1595 = mitreTechniquesData.find((technique) => technique.externalId === 'T1595')!.id;

// The EDR platform family implements the EDR and EHB controls. T1027 is covered by EDR on both
// functions and by EHB on neither, so a prevention result from that family names exactly one
// control and the assertions stay unambiguous.
const EDR_PLATFORM_TYPE = 'EDR';

describe('Control Validation Service', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;
  let edrCapabilityId: string;
  let ehbCapabilityId: string;
  let siemCapabilityId: string;

  const createAsset = async (name: string, origin: EventOrigin = adminOrigin): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
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
    options: {
      supportingAssetId: string,
      mitreTechniqueId?: string,
      expectationType?: 'detection' | 'prevention',
      securityPlatformType?: string,
      scenarioId?: string | null,
      scenarioName?: string | null,
      simulationId?: string | null,
      evaluatedAt?: Date,
      tenantId?: string,
    },
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId: options.supportingAssetId,
      tenantId: options.tenantId ?? adminTenantId,
      mitreTechniqueId: options.mitreTechniqueId ?? TECHNIQUE_T1027,
      expectationType: options.expectationType ?? 'prevention',
      securityPlatformType: options.securityPlatformType ?? EDR_PLATFORM_TYPE,
      sourceScenarioId: options.scenarioId === undefined ? 'scenario-1' : options.scenarioId,
      sourceScenarioName: options.scenarioName === undefined ? 'Ransomware drill' : options.scenarioName,
      sourceSimulationId: options.simulationId === undefined ? 'simulation-1' : options.simulationId,
      evaluatedAt: options.evaluatedAt ?? daysAgo(1),
    }]);
    return id;
  };

  const insertMeasuredResult = async (
    state: 'applicable' | 'dismissed',
    options: Parameters<typeof insertResult>[0],
  ): Promise<string> => {
    const evidenceId = await insertResult(options);
    await insertSyncedVerdict(evidenceId, state, options.evaluatedAt ?? daysAgo(1));
    return evidenceId;
  };

  // Mirrors the worst-of roll-up of the engine: one contradicted technique contradicts the control.
  const stateOf = async (capabilityId: string, organizationId?: string, origin: EventOrigin = adminOrigin) => {
    const { summary } = await services.withOrigin(origin).controlValidation.getControlValidation(capabilityId, organizationId);
    if (summary.contradictedTechniques > 0) {
      return 'contradicted';
    }
    return summary.testedTechniques > 0 ? 'validated' : 'never_tested';
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    edrCapabilityId = capabilities.find((capability) => capability.externalId === 'EDR')!.id;
    ehbCapabilityId = capabilities.find((capability) => capability.externalId === 'OSH')!.id;
    siemCapabilityId = capabilities.find((capability) => capability.externalId === 'SIEM')!.id;
  });

  describe('attribution', () => {
    it('marks the control the testing family implements and that covers the technique', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId });

      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
    });

    it('leaves the other controls of the family untouched', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId });

      expect(await stateOf(ehbCapabilityId)).toBe('never_tested');
      expect(await stateOf(siemCapabilityId)).toBe('never_tested');
    });

    it('drops a result whose platform family is unknown', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId, securityPlatformType: 'unknown' });

      expect(await stateOf(edrCapabilityId)).toBe('never_tested');
    });

    it('files a sub-technique result in its own cell when the control covers it exactly', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('dismissed', {
        supportingAssetId: assetId,
        mitreTechniqueId: TECHNIQUE_T1027_002,
      });

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.cells).toEqual([expect.objectContaining({ techniqueExternalId: 'T1027.002' })]);
    });

    it('files a sub-technique result in the parent cell when the exact edge was removed', async () => {
      await services.withOrigin(adminOrigin)
        .controlCapabilities.removeTechnique(edrCapabilityId, TECHNIQUE_T1027_002, 'prevent');
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('dismissed', {
        supportingAssetId: assetId,
        mitreTechniqueId: TECHNIQUE_T1027_002,
      });

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.cells).toEqual([expect.objectContaining({ techniqueExternalId: 'T1027' })]);
    });

    it('files in the parent cell a sub-technique result the control covers only through its parent', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: assetId, mitreTechniqueId: TECHNIQUE_T1003_006 });

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.cells).toEqual([expect.objectContaining({ techniqueExternalId: 'T1003' })]);
    });

    it('stops attributing to a technique the tenant removed from the control', async () => {
      await services.withOrigin(adminOrigin)
        .controlCapabilities.removeTechnique(edrCapabilityId, TECHNIQUE_T1027, 'prevent');
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId });

      expect(await stateOf(edrCapabilityId)).toBe('never_tested');
    });
  });

  describe('vote semantics', () => {
    it('counts one vote per scenario and contradicts the cell as soon as one voted so', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: assetId, scenarioId: 'scenario-a' });
      await insertMeasuredResult('applicable', { supportingAssetId: assetId, scenarioId: 'scenario-b' });

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.cells).toHaveLength(1);
      expect(detail.cells[0]).toMatchObject({
        techniqueExternalId: 'T1027',
        function: 'prevent',
        state: 'contradicted',
        validatedVotes: 1,
        totalVotes: 2,
      });
    });

    it('lets one asset that was walked through decide the whole scenario vote', async () => {
      const held = await createAsset('Held workstation');
      const breached = await createAsset('Breached workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held });
      await insertMeasuredResult('applicable', { supportingAssetId: breached });

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.cells[0]).toMatchObject({ state: 'contradicted', validatedVotes: 0, totalVotes: 1 });
    });

    it('validates the control when every scenario held', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: assetId, scenarioId: 'scenario-a' });
      await insertMeasuredResult('dismissed', { supportingAssetId: assetId, scenarioId: 'scenario-b' });

      expect(await stateOf(edrCapabilityId)).toBe('validated');
      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.summary).toMatchObject({
        testedTechniques: 1,
        validatedTechniques: 1,
        contradictedTechniques: 0,
      });
    });
  });

  describe('what counts as a measurement', () => {
    it('ignores a result no connector ever spoke about', async () => {
      const assetId = await createAsset('Workstation');
      await insertResult({ supportingAssetId: assetId });

      expect(await stateOf(edrCapabilityId)).toBe('never_tested');
    });

    it('keeps a person dismissing a finding from validating the control', async () => {
      const assetId = await createAsset('Workstation');
      const evidenceId = await insertMeasuredResult('applicable', { supportingAssetId: assetId });
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(),
        tenantId: adminTenantId,
        assetEvidenceId: evidenceId,
        state: 'dismissed',
        stateChangedAt: new Date(),
        changedByUserId: adminUserId,
        origin: 'user',
      }]);

      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
    });
  });

  describe('measured validity window', () => {
    it('reverts a control whose every result has aged out to never tested', async () => {
      await services.withOrigin(adminOrigin)
        .crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 30 });
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId, evaluatedAt: daysAgo(90) });

      expect(await stateOf(edrCapabilityId)).toBe('never_tested');
      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.cells).toEqual([]);
      expect(detail.summary.testedTechniques).toBe(0);
    });

    it('keeps only the fresh results in the ratio', async () => {
      await services.withOrigin(adminOrigin)
        .crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 30 });
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', {
        supportingAssetId: assetId,
        scenarioId: 'scenario-old',
        evaluatedAt: daysAgo(90),
      });
      await insertMeasuredResult('dismissed', { supportingAssetId: assetId, scenarioId: 'scenario-new' });

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      expect(detail.cells[0]).toMatchObject({ state: 'validated', validatedVotes: 1, totalVotes: 1 });
    });

    it('keeps a result whose latest verdict is fresh although its evaluation is old', async () => {
      await services.withOrigin(adminOrigin)
        .crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 30 });
      const assetId = await createAsset('Workstation');
      const evidenceId = await insertResult({ supportingAssetId: assetId, evaluatedAt: daysAgo(90) });
      await insertSyncedVerdict(evidenceId, 'applicable', daysAgo(1));

      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
    });

    it('keeps a result a replay evaluated again although its verdict is old', async () => {
      await services.withOrigin(adminOrigin)
        .crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 30 });
      const assetId = await createAsset('Workstation');
      const evidenceId = await insertResult({ supportingAssetId: assetId, evaluatedAt: daysAgo(1) });
      await insertSyncedVerdict(evidenceId, 'applicable', daysAgo(90));

      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
    });

    it('keeps every result under the longest validity window the settings accept', async () => {
      await services.withOrigin(adminOrigin)
        .crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 2_147_483_647 });
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId, evaluatedAt: daysAgo(90) });

      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
    });
  });

  describe('narrowed reads', () => {
    // A control is read on only the results that can vote for it, folded, and must derive as it does
    // from every result of the estate, row by row.
    it('derives each control as it derives from every result of the estate', async () => {
      const workstationId = await createAsset('Workstation');
      const serverId = await createAsset('Server');
      const laptopId = await createAsset('Laptop');
      const tabletId = await createAsset('Tablet');
      const grid = ['EDR', 'XDR', 'NDR', 'SIEM', 'ISPM'].flatMap((securityPlatformType) =>
        [TECHNIQUE_T1003, TECHNIQUE_T1003_006, TECHNIQUE_T1027, TECHNIQUE_T1027_002].flatMap((mitreTechniqueId) =>
          (['prevention', 'detection'] as const).map((expectationType) => ({ securityPlatformType, mitreTechniqueId, expectationType }))));
      // Each run of a scenario names its simulation, and a result may name only a simulation, or neither.
      const runs = [
        { scenarioId: 'scenario-1', scenarioName: 'Ransomware drill (replay)', simulationId: 'simulation-2', evaluatedAt: daysAgo(3) },
        { scenarioId: null, scenarioName: null, simulationId: 'simulation-9', evaluatedAt: daysAgo(2) },
        { scenarioId: null, scenarioName: null, simulationId: null, evaluatedAt: daysAgo(4) },
        { scenarioId: 'scenario-2', scenarioName: 'Credential theft', simulationId: 'simulation-3', evaluatedAt: daysAgo(1) },
      ];
      // Each result tested fresh on one asset, on another either inside the window or past it, on the
      // third under another run, and on the fourth found later but not tested yet.
      for (const [index, result] of grid.entries()) {
        await insertMeasuredResult(index % 3 === 0 ? 'applicable' : 'dismissed', {
          ...result,
          supportingAssetId: workstationId,
          evaluatedAt: daysAgo(1),
        });
        await insertMeasuredResult(index % 3 === 1 ? 'applicable' : 'dismissed', {
          ...result,
          supportingAssetId: serverId,
          evaluatedAt: daysAgo(index % 2 === 0 ? 25 : 45),
        });
        await insertMeasuredResult(index % 5 === 0 ? 'applicable' : 'dismissed', {
          ...result,
          ...runs[index % runs.length],
          supportingAssetId: laptopId,
        });
        await insertResult({ ...result, supportingAssetId: tabletId, evaluatedAt: daysAgo(0) });
      }

      const context = repositoryContextOf(db, adminOrigin);
      const platformControls = await controlValidationRepository.findControlsByPlatformType(context);
      const credited = await controlValidationRepository.findCreditedEdges(context, [...new Set(platformControls.map((pair) => pair.capabilityId))]);
      const edges = resolveEffectiveEdges(credited.catalogueEdges, credited.overrides);
      const everyResult = await controlValidationRepository.findValidationEvidence(context, OPEN_ESTATE);
      const rawResults = await db
        .select({
          supportingAssetId: assetEvidence.supportingAssetId,
          mitreTechniqueId: mitreTechniques.id,
          parentTechniqueId: mitreTechniques.parentTechniqueId,
          expectationType: assetEvidence.expectationType,
          securityPlatformType: assetEvidence.securityPlatformType,
          scenarioId: assetEvidence.sourceScenarioId,
          scenarioName: assetEvidence.sourceScenarioName,
          simulationId: assetEvidence.sourceSimulationId,
          evaluatedAt: assetEvidence.evaluatedAt,
          exposed: assetEvidence.latestVerdictExposed,
          observedAt: assetEvidence.latestVerdictObservedAt,
        })
        .from(assetEvidence)
        .innerJoin(mitreTechniques, eq(assetEvidence.mitreTechniqueId, mitreTechniques.id))
        .where(eq(assetEvidence.tenantId, adminTenantId));
      const externalIds = new Map(mitreTechniquesData.map((technique) => [technique.id, technique.externalId]));
      // The rule the evidence lines are read on, stated over every result of the estate: a line is
      // a (cell, function, family, vote key), contradicted where one of its assets is, dated and named
      // on its latest result, the greater simulation id then name breaking a tie. Filed `tested`, a
      // result in no cell of the control is on its own technique, read when the control scores it or
      // holds a stored result on it, or on its parent.
      const expectedLines = (
        capabilityId: string,
        measuredValidityDays: number | null,
        now: Date,
        filing: 'scored' | 'tested',
        stored: ReadonlySet<string> = new Set(),
      ) => {
        const scoredEdges = indexScoredEdges(edges);
        const read = new Set([
          ...edges.filter((edge) => edge.capabilityId === capabilityId && edge.state !== 'removed').map((edge) => edge.techniqueId),
          ...stored,
        ]);
        const families = new Set(platformControls.filter((pair) => pair.capabilityId === capabilityId).map((pair) => pair.platformTypeKey));
        const lines = new Map<string, {
          techniqueId: string, function: 'detect' | 'prevent', securityPlatformType: string, scenarioId: string | null,
          latest: { at: Date, simulationId: string | null, scenarioName: string | null } | null,
          assets: Map<string, 'validated' | 'contradicted'>,
        }>();
        for (const result of rawResults) {
          const measured = resolveMeasuredResult({
            runVerdict: result.observedAt === null ? null : (result.exposed ? 'applicable' : 'dismissed'),
            evaluatedAt: result.evaluatedAt,
            runAt: result.observedAt,
          });
          if (measured === null || measured.measuredAt === null || !isFreshMeasurement(measured, { measuredValidityDays }, now)
            || result.expectationType === null || result.securityPlatformType === null || !families.has(result.securityPlatformType)) {
            continue;
          }
          const fn = EXPECTATION_TYPE_TO_FUNCTION[result.expectationType];
          const isRead = read.has(result.mitreTechniqueId) || (result.parentTechniqueId !== null && read.has(result.parentTechniqueId));
          const techniqueId = resolveCellTechniqueId(scoredEdges, capabilityId, result, fn) ?? (filing === 'tested' && isRead ? result.mitreTechniqueId : null);
          if (techniqueId === null) {
            continue;
          }
          const key = `${techniqueId}:${fn}:${result.securityPlatformType}:${result.scenarioId ?? result.simulationId ?? ''}`;
          const line = lines.get(key) ?? {
            techniqueId, function: fn, securityPlatformType: result.securityPlatformType, scenarioId: result.scenarioId, latest: null, assets: new Map(),
          };
          const candidate = { at: measured.measuredAt, simulationId: result.simulationId, scenarioName: result.scenarioName };
          const later = (a: typeof candidate, b: typeof candidate) => a.at.getTime() - b.at.getTime()
            || (a.simulationId ?? '').localeCompare(b.simulationId ?? '') || (a.scenarioName ?? '').localeCompare(b.scenarioName ?? '');
          line.latest = line.latest === null || later(candidate, line.latest) > 0 ? candidate : line.latest;
          const verdict = measured.verdict === 'got_through' ? 'contradicted' : 'validated';
          line.assets.set(result.supportingAssetId, line.assets.get(result.supportingAssetId) === 'contradicted' ? 'contradicted' : verdict);
          lines.set(key, line);
        }
        return [...lines.values()].map(({ latest, assets, ...line }) => {
          const verdicts = [...assets.values()];
          const contradicted = verdicts.filter((verdict) => verdict === 'contradicted').length;
          return {
            ...line,
            techniqueExternalId: externalIds.get(line.techniqueId),
            scenarioName: latest!.scenarioName,
            simulationId: latest!.simulationId,
            verdict: contradicted > 0 ? 'contradicted' : 'validated',
            evaluatedAt: latest!.at,
            assetCounts: { validated: verdicts.length - contradicted, contradicted },
            assets: [...assets].map(([id, verdict]) => ({ id, verdict })).toSorted((left, right) => left.id.localeCompare(right.id)),
          };
        });
      };
      const byKey = (line: { techniqueId: string, function: string, securityPlatformType: string, scenarioId: string | null, simulationId: string | null }) =>
        `${line.techniqueId}:${line.function}:${line.securityPlatformType}:${line.scenarioId ?? line.simulationId ?? ''}`;
      const read = services.withOrigin(adminOrigin).controlValidation;
      for (const measuredValidityDays of [30, null]) {
        await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays });
        const now = new Date();
        await services.withOrigin(adminOrigin).controlValidation.measureTechniqueTestResults({ now });
        const storedRows = await db
          .select({ capabilityId: controlTechniqueTestResults.capabilityId, mitreTechniqueId: controlTechniqueTestResults.mitreTechniqueId })
          .from(controlTechniqueTestResults)
          .where(eq(controlTechniqueTestResults.tenantId, adminTenantId));
        const storedOf = (capabilityId: string) => new Set(storedRows.filter((row) => row.capabilityId === capabilityId).map((row) => row.mitreTechniqueId));
        const reference = deriveControlValidation(
          {
            rows: everyResult.flatMap((row) => (row.expectationType === null ? [] : [{ ...row, expectationType: row.expectationType }])),
            edges,
            platformControls,
            techniqueExternalIds: externalIds,
          },
          { policy: { measuredValidityDays }, now },
        );

        const sorted = <T extends Parameters<typeof byKey>[0]>(lines: Array<T>) => lines.toSorted((left, right) => byKey(left).localeCompare(byKey(right)));
        // No line holds more than XTM One's first five assets, so its read names every asset of each.
        expect(await Promise.all(reference.map(async ({ capabilityId }) => ({
          capabilityId,
          ...await read.getControlValidation(capabilityId),
          listed: sorted((await read.listControlValidationEvidence(capabilityId, undefined, { page: 1, limit: 500, sortDesc: true })).items),
          xtmOne: sorted((await read.getControlValidationEvidence(capabilityId)).map((line) => ({
            ...line,
            assets: line.assets.map(({ id, verdict }) => ({ id, verdict })).toSorted((left, right) => left.id.localeCompare(right.id)),
          }))),
        })))).toEqual(reference.map(({ capabilityId, summary, cells }) => ({
          capabilityId,
          summary,
          cells,
          listed: sorted(expectedLines(capabilityId, measuredValidityDays, now, 'tested', storedOf(capabilityId)).map(({ assets: _, ...line }) => line)),
          xtmOne: sorted(expectedLines(capabilityId, measuredValidityDays, now, 'scored')),
        })));
        expect(reference.some(({ capabilityId }) =>
          expectedLines(capabilityId, measuredValidityDays, now, 'tested', storedOf(capabilityId)).length
            > expectedLines(capabilityId, measuredValidityDays, now, 'scored').length)).toBe(true);
        expect(reference.length).toBeGreaterThan(4);
      }
    });
  });

  describe('evidence lines', () => {
    it('returns one line per scenario and family with every asset verdict', async () => {
      const held = await createAsset('Held workstation');
      const breached = await createAsset('Breached workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held });
      await insertMeasuredResult('applicable', { supportingAssetId: breached });

      const lines = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidationEvidence(edrCapabilityId);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        techniqueExternalId: 'T1027',
        function: 'prevent',
        scenarioId: 'scenario-1',
        scenarioName: 'Ransomware drill',
        simulationId: 'simulation-1',
        securityPlatformType: EDR_PLATFORM_TYPE,
        verdict: 'contradicted',
      });
      expect(lines[0].assets.map((asset) => asset.verdict).toSorted()).toEqual(['contradicted', 'validated']);
    });

    it('carries the derived name of an asset with no name', async () => {
      const addressAsset = uuidv7();
      await db.insert(supportingAssets).values({
        id: addressAsset, tenantId: adminTenantId, name: null, derivedName: '10.0.0.1', exposure: 'unknown', categoryId: 'host', criticality: 'unknown',
      });
      await insertMeasuredResult('dismissed', { supportingAssetId: addressAsset });

      const lines = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidationEvidence(edrCapabilityId);
      expect(lines[0].assets).toEqual([{ id: addressAsset, name: null, derivedName: '10.0.0.1', verdict: 'validated' }]);
    });

    it('pages the lines with their asset counts, on one technique or all of them', async () => {
      const held = await createAsset('Held workstation');
      const breached = await createAsset('Breached workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held });
      await insertMeasuredResult('applicable', { supportingAssetId: breached });
      await insertMeasuredResult('dismissed', { supportingAssetId: held, scenarioId: 'scenario-2', scenarioName: 'Credential theft' });
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection' });
      const read = services.withOrigin(adminOrigin).controlValidation;

      const firstPage = await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 2, sortBy: 'scenario', sortDesc: false });
      expect(firstPage).toMatchObject({ total: 3, unfilteredTotal: 3 });
      expect(firstPage.items.map((line) => [line.scenarioName, line.techniqueExternalId, line.assetCounts])).toEqual([
        ['Credential theft', 'T1027', { validated: 1, contradicted: 0 }],
        ['Ransomware drill', 'T1003', { validated: 1, contradicted: 0 }],
      ]);
      expect(firstPage.items[0]).not.toHaveProperty('assets');

      const onT1027 = await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortDesc: true, technique: 'T1027' });
      expect(onT1027).toMatchObject({ total: 2, unfilteredTotal: 3 });
      expect(onT1027.items.find((line) => line.scenarioId === 'scenario-1')?.assetCounts).toEqual({ validated: 1, contradicted: 1 });

      const onNoLine = await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortDesc: true, technique: 'T1027.002' });
      expect(onNoLine).toEqual({ items: [], total: 0, unfilteredTotal: 3 });
      const pastTheEnd = await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 3, limit: 2, sortDesc: true });
      expect(pastTheEnd).toEqual({ items: [], total: 3, unfilteredTotal: 3 });
    });

    it('keeps a technique\'s lines and its scored sub-techniques\' when filtered on it, and a sub-technique\'s alone on it', async () => {
      const held = await createAsset('Held workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1055 });
      await insertMeasuredResult('applicable', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1055_012, scenarioId: 'scenario-2', scenarioName: 'Hollowing drill' });
      await insertMeasuredResult('dismissed', { supportingAssetId: held });
      const read = services.withOrigin(adminOrigin).controlValidation;
      const filteredOn = async (technique: string) => {
        const page = await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortDesc: false, technique });
        return { total: page.total, unfilteredTotal: page.unfilteredTotal, lines: page.items.map((line) => line.techniqueExternalId).toSorted() };
      };

      expect(await filteredOn('T1055')).toEqual({ total: 2, unfilteredTotal: 3, lines: ['T1055', 'T1055.012'] });
      expect(await filteredOn('T1055.012')).toEqual({ total: 1, unfilteredTotal: 3, lines: ['T1055.012'] });
      expect(await filteredOn('T1027')).toEqual({ total: 1, unfilteredTotal: 3, lines: ['T1027'] });
      // A technique id another one's starts with is not its parent.
      expect(await filteredOn('T1055.01')).toEqual({ total: 0, unfilteredTotal: 3, lines: [] });
    });

    it('counts a filtered family even when its page comes back empty', async () => {
      const held = await createAsset('Held workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1055_012 });
      await insertMeasuredResult('dismissed', { supportingAssetId: held });

      const pastTheEnd = await services.withOrigin(adminOrigin).controlValidation
        .listControlValidationEvidence(edrCapabilityId, undefined, { page: 2, limit: 1, sortDesc: false, technique: 'T1055' });

      expect(pastTheEnd).toEqual({ items: [], total: 1, unfilteredTotal: 2 });
    });

    it('keeps the lines of one function, one result and one platform family, alone or together', async () => {
      const held = await createAsset('Held workstation');
      const breached = await createAsset('Breached workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held });
      await insertMeasuredResult('applicable', { supportingAssetId: breached });
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection' });
      await insertMeasuredResult('applicable', {
        supportingAssetId: breached, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection', securityPlatformType: 'XDR', scenarioId: 'scenario-2', scenarioName: 'Credential theft',
      });
      const read = services.withOrigin(adminOrigin).controlValidation;
      const filteredOn = async (filters: { function?: 'prevent' | 'detect', result?: 'validated' | 'contradicted', securityPlatformType?: string }) => {
        const page = await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortBy: 'scenario', sortDesc: false, ...filters });
        return { total: page.total, unfilteredTotal: page.unfilteredTotal, lines: page.items.map((line) => `${line.techniqueExternalId} ${line.function} ${line.securityPlatformType}`) };
      };

      expect(await filteredOn({ function: 'detect' })).toEqual({ total: 2, unfilteredTotal: 3, lines: ['T1003 detect XDR', 'T1003 detect EDR'] });
      expect(await filteredOn({ function: 'prevent' })).toEqual({ total: 1, unfilteredTotal: 3, lines: ['T1027 prevent EDR'] });
      expect(await filteredOn({ result: 'contradicted' })).toEqual({ total: 2, unfilteredTotal: 3, lines: ['T1003 detect XDR', 'T1027 prevent EDR'] });
      expect(await filteredOn({ result: 'validated' })).toEqual({ total: 1, unfilteredTotal: 3, lines: ['T1003 detect EDR'] });
      expect(await filteredOn({ securityPlatformType: 'XDR' })).toEqual({ total: 1, unfilteredTotal: 3, lines: ['T1003 detect XDR'] });
      expect(await filteredOn({ function: 'detect', result: 'contradicted', securityPlatformType: 'EDR' })).toEqual({ total: 0, unfilteredTotal: 3, lines: [] });
    });

    it('names the techniques the control\'s lines are filed on, and the parent of a sub-technique it scores on its own', async () => {
      const held = await createAsset('Held workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1055_012 });
      await insertMeasuredResult('dismissed', { supportingAssetId: held });
      // T1003.006 is not scored by the EDR control: its line is filed on T1003.
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1003_006 });
      const names = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique.name]));

      const techniques = await services.withOrigin(adminOrigin).controlValidation.listControlValidationEvidenceTechniques(edrCapabilityId);

      expect(techniques).toEqual(['T1003', 'T1027', 'T1055', 'T1055.012'].map((externalId) => ({ externalId, name: names.get(externalId) })));
    });

    it('lists a technique the control does not score but holds a stored result on, on its own lines, which XTM One\'s read leaves out', async () => {
      for (const techniqueId of [TECHNIQUE_T1027, TECHNIQUE_T1027_002]) {
        await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(edrCapabilityId, techniqueId, 'prevent');
      }
      const held = await createAsset('Held workstation');
      const breached = await createAsset('Breached workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held });
      await insertMeasuredResult('applicable', { supportingAssetId: breached, mitreTechniqueId: TECHNIQUE_T1027_002, scenarioId: 'scenario-2', scenarioName: 'Packing drill' });
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection' });
      const read = services.withOrigin(adminOrigin).controlValidation;
      await read.measureTechniqueTestResults({ now: new Date() });
      // Fresh, of the control's family, on a technique it does not score, but measured after the
      // stored results: the control holds none on it.
      await insertMeasuredResult('dismissed', { supportingAssetId: held, mitreTechniqueId: TECHNIQUE_T1595, scenarioId: 'scenario-3', scenarioName: 'Scanning drill' });
      const listed = async (filters: { technique?: string, result?: 'validated' | 'contradicted' } = {}) => {
        const page = await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortBy: 'technique', sortDesc: false, ...filters });
        return { total: page.total, lines: page.items.map((line) => [line.techniqueExternalId, line.function, line.verdict]) };
      };

      expect(await listed()).toEqual({
        total: 3,
        lines: [['T1003', 'detect', 'validated'], ['T1027', 'prevent', 'validated'], ['T1027.002', 'prevent', 'contradicted']],
      });
      expect(await listed({ technique: 'T1027' })).toEqual({
        total: 2,
        lines: [['T1027', 'prevent', 'validated'], ['T1027.002', 'prevent', 'contradicted']],
      });
      expect(await listed({ result: 'contradicted' })).toEqual({ total: 1, lines: [['T1027.002', 'prevent', 'contradicted']] });
      expect(await listed({ technique: 'T1595' })).toEqual({ total: 0, lines: [] });
      expect((await read.listControlValidationEvidenceTechniques(edrCapabilityId)).map((technique) => technique.externalId))
        .toEqual(['T1003', 'T1027', 'T1027.002']);
      expect((await read.getControlValidationEvidence(edrCapabilityId)).map((line) => line.techniqueExternalId)).toEqual(['T1003']);
    });

    it('counts an asset once on a line where several of its results gave way', async () => {
      const assetId = await createAsset('Workstation');
      const otherAssetId = await createAsset('Server');
      // T1003.006 is not scored by the EDR control, so its result lands on the T1003 line beside the other.
      for (const mitreTechniqueId of [TECHNIQUE_T1003, TECHNIQUE_T1003_006]) {
        await insertMeasuredResult('applicable', { supportingAssetId: assetId, mitreTechniqueId });
      }
      await insertMeasuredResult('dismissed', { supportingAssetId: otherAssetId, mitreTechniqueId: TECHNIQUE_T1003 });

      const { items } = await services.withOrigin(adminOrigin)
        .controlValidation.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortDesc: true });
      expect(items.map((line) => [line.techniqueExternalId, line.assetCounts])).toEqual([['T1003', { validated: 1, contradicted: 1 }]]);
    });

    it('gives XTM One the newest lines first, each with its first five assets', async () => {
      const assetIds = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map((name) => createAsset(name)));
      for (const [index, assetId] of assetIds.entries()) {
        await insertMeasuredResult(index === 5 ? 'applicable' : 'dismissed', { supportingAssetId: assetId, evaluatedAt: daysAgo(3) });
      }
      await insertMeasuredResult('dismissed', { supportingAssetId: assetIds[0], scenarioId: 'scenario-2', scenarioName: 'Credential theft' });

      const lines = await services.withOrigin(adminOrigin).controlValidation.getControlValidationEvidence(edrCapabilityId);
      expect(lines.map((line) => [line.scenarioName, line.assets.map((asset) => asset.name)])).toEqual([
        ['Credential theft', ['A']],
        ['Ransomware drill', ['F', 'A', 'B', 'C', 'D']],
      ]);
    });

    it('names a line after its latest replay, the greater simulation on a tie', async () => {
      const assetId = await createAsset('Workstation');
      const at = daysAgo(2);
      await insertMeasuredResult('dismissed', { supportingAssetId: assetId, simulationId: 'simulation-a', scenarioName: 'Drill (first run)', evaluatedAt: daysAgo(5) });
      const otherAssetId = await createAsset('Server');
      await insertMeasuredResult('dismissed', { supportingAssetId: otherAssetId, simulationId: 'simulation-b', scenarioName: 'Drill (replay b)', evaluatedAt: at });
      const thirdAssetId = await createAsset('Laptop');
      // Its name sorts before the other replay's, so only the simulation id can pick it.
      await insertMeasuredResult('dismissed', { supportingAssetId: thirdAssetId, simulationId: 'simulation-c', scenarioName: 'Drill (replay a)', evaluatedAt: at });

      const { items } = await services.withOrigin(adminOrigin)
        .controlValidation.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortDesc: false });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ scenarioId: 'scenario-1', simulationId: 'simulation-c', scenarioName: 'Drill (replay a)', evaluatedAt: at });
    });

    it('orders the lines on each sort key, both ways, then on their key', async () => {
      const [first, second, third] = await Promise.all(['First', 'Second', 'Third'].map((name) => createAsset(name)));
      await insertMeasuredResult('applicable', { supportingAssetId: first, scenarioId: 'scenario-a', scenarioName: 'Alpha', evaluatedAt: daysAgo(3) });
      await insertMeasuredResult('dismissed', { supportingAssetId: second, scenarioId: 'scenario-a', scenarioName: 'Alpha', evaluatedAt: daysAgo(3) });
      await insertMeasuredResult('dismissed', {
        supportingAssetId: first, scenarioId: 'scenario-b', scenarioName: 'beta', mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection', securityPlatformType: 'XDR', evaluatedAt: daysAgo(1),
      });
      for (const assetId of [first, second, third]) {
        await insertMeasuredResult('dismissed', { supportingAssetId: assetId, scenarioId: 'scenario-g', scenarioName: 'Gamma', mitreTechniqueId: TECHNIQUE_T1003, evaluatedAt: daysAgo(2) });
      }
      const read = services.withOrigin(adminOrigin).controlValidation;
      const order = async (sortBy: EvidenceLineSortKey, sortDesc: boolean) => (await read.listControlValidationEvidence(edrCapabilityId, undefined, { page: 1, limit: 50, sortBy, sortDesc }))
        .items.map((line) => line.scenarioName);

      const expected: Record<EvidenceLineSortKey, [Array<string>, Array<string>]> = {
        technique: [['beta', 'Gamma', 'Alpha'], ['Alpha', 'beta', 'Gamma']],
        scenario: [['Alpha', 'beta', 'Gamma'], ['Gamma', 'beta', 'Alpha']],
        family: [['Gamma', 'Alpha', 'beta'], ['beta', 'Gamma', 'Alpha']],
        function: [['beta', 'Gamma', 'Alpha'], ['Gamma', 'Alpha', 'beta']],
        verdict: [['Alpha', 'beta', 'Gamma'], ['beta', 'Gamma', 'Alpha']],
        evaluatedAt: [['Alpha', 'Gamma', 'beta'], ['beta', 'Gamma', 'Alpha']],
        assets: [['beta', 'Alpha', 'Gamma'], ['Gamma', 'Alpha', 'beta']],
      };
      for (const sortBy of EVIDENCE_LINE_SORT_KEYS) {
        expect([await order(sortBy, false), await order(sortBy, true)], sortBy).toEqual(expected[sortBy]);
      }
    });

    it('gives XTM One the newest 500 lines', async () => {
      const assetId = await createAsset('Workstation');
      const ids = Array.from({ length: 501 }, () => uuidv7());
      await db.insert(assetEvidence).values(ids.map((id, index) => ({
        id,
        supportingAssetId: assetId,
        tenantId: adminTenantId,
        mitreTechniqueId: TECHNIQUE_T1027,
        expectationType: 'prevention' as const,
        securityPlatformType: EDR_PLATFORM_TYPE,
        sourceScenarioId: `scenario-${index}`,
        sourceScenarioName: `Scenario ${index}`,
        sourceSimulationId: `simulation-${index}`,
        evaluatedAt: new Date(daysAgo(10).getTime() + index * 60_000),
      })));
      await db.insert(assetEvidenceVerdicts).values(ids.map((id, index) => ({
        id: uuidv7(),
        tenantId: adminTenantId,
        assetEvidenceId: id,
        connectorId: null,
        isExposed: false,
        observedAt: new Date(daysAgo(10).getTime() + index * 60_000),
        recordedAt: new Date(daysAgo(10).getTime() + index * 60_000),
      })));

      const lines = await services.withOrigin(adminOrigin).controlValidation.getControlValidationEvidence(edrCapabilityId);
      expect(lines).toHaveLength(500);
      expect(lines.map((line) => line.scenarioId)).not.toContain('scenario-0');
    });

    it('returns nothing for a control no result reached', async () => {
      const assetId = await createAsset('Workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId });

      const lines = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidationEvidence(ehbCapabilityId);
      expect(lines).toEqual([]);
    });
  });

  describe('a tenant no connector has reached', () => {
    it('answers every endpoint with an empty state and no error', async () => {
      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);
      const lines = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidationEvidence(edrCapabilityId);

      expect(detail).toEqual({
        summary: {
          validatedTechniques: 0,
          contradictedTechniques: 0,
          testedTechniques: 0,
          latestProofAt: null,
        },
        cells: [],
      });
      expect(lines).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('never lets one tenant read another tenant validation states', async () => {
      const assetId = await createAsset('Tenant A workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: assetId });

      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const assetB = await createAsset('Tenant B workstation', originB);
      await insertMeasuredResult('dismissed', {
        supportingAssetId: assetB,
        tenantId: tenantBId,
        mitreTechniqueId: TECHNIQUE_T1003,
      });

      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
      expect(await stateOf(edrCapabilityId, undefined, originB)).toBe('validated');

      const linesB = await services.withOrigin(originB)
        .controlValidation.getControlValidationEvidence(edrCapabilityId);
      expect(linesB.map((line) => line.techniqueExternalId)).toEqual(['T1003']);
    });
  });
  describe('risk scope', () => {
    let organizationId: string;

    const closeOver = async (assetIds: Array<string>) => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, {
        estateMode: 'closed',
        mapping: { added: assetIds, removed: [] },
      });
    };

    beforeEach(async () => {
      organizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Payments platform' }]);
    });

    it('derives today’s verdict vote for vote in an open scope', async () => {
      const held = await createAsset('Held workstation');
      const walked = await createAsset('Walked workstation');
      await insertMeasuredResult('dismissed', { supportingAssetId: held, scenarioId: 'scenario-a' });
      await insertMeasuredResult('applicable', { supportingAssetId: walked, scenarioId: 'scenario-b' });

      const scoped = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId, organizationId);
      const tenantWide = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId);

      expect(scoped).toEqual(tenantWide);
      expect(scoped.cells[0]).toMatchObject({ state: 'contradicted', validatedVotes: 1, totalVotes: 2 });
    });

    it('derives never_tested on a closed scope no simulation has reached', async () => {
      const tested = await createAsset('Tested workstation');
      const untouched = await createAsset('Untouched workstation');
      await insertMeasuredResult('applicable', { supportingAssetId: tested });
      await closeOver([untouched]);

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId, organizationId);
      expect(detail.summary).toMatchObject({ validatedTechniques: 0, contradictedTechniques: 0, testedTechniques: 0 });
      expect(detail.cells).toEqual([]);
      expect(await stateOf(edrCapabilityId, organizationId)).toBe('never_tested');
      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
    });

    it('lets a closed scope read validated a cell one failing asset contradicts elsewhere', async () => {
      const inside = await createAsset('Inside the scope');
      const outside = await createAsset('Outside the scope');
      await insertMeasuredResult('dismissed', { supportingAssetId: inside, scenarioId: 'scenario-a' });
      await insertMeasuredResult('applicable', { supportingAssetId: outside, scenarioId: 'scenario-b' });
      await closeOver([inside]);

      const detail = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidation(edrCapabilityId, organizationId);
      expect(detail.cells[0]).toMatchObject({ state: 'validated', validatedVotes: 1, totalVotes: 1 });
      expect(await stateOf(edrCapabilityId)).toBe('contradicted');
    });

    it('narrows the evidence lines to the scope’s own assets', async () => {
      const inside = await createAsset('Inside the scope');
      const outside = await createAsset('Outside the scope');
      await insertMeasuredResult('dismissed', { supportingAssetId: inside, scenarioId: 'scenario-a' });
      await insertMeasuredResult('applicable', { supportingAssetId: outside, scenarioId: 'scenario-b' });
      await closeOver([inside]);

      const lines = await services.withOrigin(adminOrigin)
        .controlValidation.getControlValidationEvidence(edrCapabilityId, organizationId);
      expect(lines.flatMap((line) => line.assets.map((asset) => asset.id))).toEqual([inside]);
    });

    it('refuses a scope the caller cannot see', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      await expect(
        services.withOrigin(originB).controlValidation.getControlValidation(edrCapabilityId, organizationId),
      ).rejects.toThrow(RiskScopeNotFoundError);
    });
  });
});
