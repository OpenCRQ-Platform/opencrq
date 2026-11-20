import type { AssetCategory, EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, mitreTechniquesData, RiskScopeNotFoundError, SupportingAssetNotFoundError } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const TECHNIQUE_ID_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique.id]));
const techniqueId = (externalId: string): string => TECHNIQUE_ID_BY_EXTERNAL_ID.get(externalId)!;

// ISPM implements IDP, which protects a web application. The EDR family implements EDR and OSH,
// neither of which protects a web application.
const ISPM = 'ISPM';
const EDR_FAMILY = 'EDR';

describe('Asset protecting controls', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let assetId: string;
  let capabilityIds: Map<string, string>;

  const createAsset = async (name: string, origin: EventOrigin = adminOrigin, categoryId: AssetCategory = 'web_application'): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id,
      name,
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId,
      criticality: 'unknown',
    });
    return id;
  };

  const insertMeasuredResult = async (
    state: 'applicable' | 'dismissed',
    options: {
      supportingAssetId?: string,
      technique: string,
      expectationType?: 'detection' | 'prevention',
      securityPlatformType?: string,
      scenarioId?: string,
      evaluatedAt?: Date,
    },
  ): Promise<string> => {
    const evidenceId = uuidv7();
    const evaluatedAt = options.evaluatedAt ?? daysAgo(2);
    await db.insert(assetEvidence).values([{
      id: evidenceId,
      supportingAssetId: options.supportingAssetId ?? assetId,
      tenantId,
      mitreTechniqueId: techniqueId(options.technique),
      expectationType: options.expectationType ?? 'prevention',
      securityPlatformType: options.securityPlatformType ?? ISPM,
      sourceScenarioId: options.scenarioId ?? 'scenario-1',
      sourceScenarioName: 'Credential attack drill',
      sourceSimulationId: 'simulation-1',
      evaluatedAt,
    }]);
    await insertSyncedVerdict(evidenceId, state, evaluatedAt);
    return evidenceId;
  };

  const dismissByPerson = async (evidenceId: string, at: Date): Promise<void> => {
    await db.insert(assetEvidenceHistory).values([{
      id: uuidv7(),
      tenantId,
      assetEvidenceId: evidenceId,
      state: 'dismissed',
      stateChangedAt: at,
      observedAt: null,
      dismissalType: 'risk_accepted',
      reason: 'Compensated by the payment gateway',
      changedByUserId: adminUserId,
      origin: 'user',
    }]);
  };

  const read = (organizationId?: string, origin: EventOrigin = adminOrigin, supportingAssetId: string = assetId) =>
    services.withOrigin(origin).controlValidation.getAssetProtectingControls(supportingAssetId, organizationId);

  const control = async (externalId: string, organizationId?: string) => {
    const { controls } = await read(organizationId);
    return controls.find((candidate) => candidate.externalId === externalId);
  };

  const createScope = async (name: string): Promise<string> => {
    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name }]);
    return organizationId;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    capabilityIds = new Map(capabilities.map((capability) => [capability.externalId, capability.id]));
    assetId = await createAsset('Card Authorization Engine');
  });

  describe('which controls are listed', () => {
    it('should list the controls protecting a web application that stand on one of its techniques', async () => {
      const { inScope, controls } = await read();

      expect(inScope).toBe(true);
      expect(controls.filter((entry) => entry.protectsAssetCategory).map((entry) => entry.externalId))
        .toEqual(['APM', 'APPH', 'DDOS', 'IDP', 'IPS', 'PAM', 'PATCH', 'RASP', 'SIEM', 'SOC', 'SSDLC', 'WAF', 'ZTNA']);
    });

    // Every control protecting a web application stands on one of its techniques, so the case needs an identity.
    it('should leave out a control protecting the category that stands on none of its techniques', async () => {
      const identityAsset = await createAsset('Payments service account', adminOrigin, 'identity');
      const { controls } = await read(undefined, adminOrigin, identityAsset);

      expect(controls.find((candidate) => candidate.externalId === 'DLP')).toBeUndefined();
    });

    it('should leave out a control of another category that nothing tested here', async () => {
      expect(await control('EDR')).toBeUndefined();
    });

    it('should count the asset techniques each control stands on, the parent fallback included', async () => {
      const idp = await control('IDP');

      expect(idp?.assetTechniqueCount).toBe(idp?.standsOn.length);
      expect(idp?.standsOn.map((entry) => entry.externalId)).toEqual(expect.arrayContaining(['T1078', 'T1110', 'T1110.001']));
    });
  });

  describe('posture', () => {
    it('should read a control the tenant never assessed as not assessed', async () => {
      expect(await control('DDOS')).toMatchObject({ assessed: false, tenantStrengthRung: null, tenantCoverageBucket: null });
    });

    it('should read the tenant declaration outside any scope', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(capabilityIds.get('WAF')!, 'L2', 'L2', null);

      expect(await control('WAF')).toMatchObject({
        assessed: true,
        strengthRung: 'L2',
        coverageBucket: 'L2',
        strengthSource: 'tenant',
        coverageSource: 'tenant',
      });
    });

    it('should read a strength the scope declares with the tenant value beside it', async () => {
      const wafId = capabilityIds.get('WAF')!;
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(wafId, 'L2', 'L2', null);
      const organizationId = await createScope('Acme Bank Europe');
      await services.withOrigin(adminOrigin).controlCapabilities.declareScopePosture(organizationId, wafId, {
        strengthRung: 'L3',
        coverageBucket: null,
        comment: null,
      });

      expect(await control('WAF', organizationId)).toMatchObject({
        strengthRung: 'L3',
        strengthSource: 'scope',
        tenantStrengthRung: 'L2',
        coverageBucket: 'L2',
        coverageSource: 'tenant',
      });
      expect(await control('WAF')).toMatchObject({ strengthRung: 'L2', strengthSource: 'tenant' });
    });

    it('should never add or remove a row when the scope changes', async () => {
      const wafId = capabilityIds.get('WAF')!;
      const organizationId = await createScope('Acme Bank Europe');
      await services.withOrigin(adminOrigin).controlCapabilities.declareScopePosture(organizationId, wafId, {
        strengthRung: 'L0',
        coverageBucket: 'L0',
        comment: null,
      });

      const wholeScope = (await read()).controls.map((entry) => entry.externalId);
      const scoped = (await read(organizationId)).controls.map((entry) => entry.externalId);
      expect(scoped).toEqual(wholeScope);
    });
  });

  describe('tested on this asset', () => {
    it('should mark only a control a security platform family implements as testable', async () => {
      expect(await control('IDP')).toMatchObject({ testable: true, testedHere: null });
      expect(await control('WAF')).toMatchObject({ testable: false, testedHere: null });
    });

    it('should sum the fresh results a platform implementing the control wrote here, dated by the latest', async () => {
      await insertMeasuredResult('dismissed', { technique: 'T1110', evaluatedAt: daysAgo(3) });
      await insertMeasuredResult('applicable', { technique: 'T1078', evaluatedAt: daysAgo(1) });

      const idp = await control('IDP');
      expect(idp?.testedHere).toMatchObject({ prevention: { held: 1, total: 2 }, detection: null });
      expect(idp?.testedHere?.lastRunAt?.getTime()).toBeGreaterThan(daysAgo(2).getTime());
      expect(idp?.standsOn.slice(0, 2).map((entry) => [entry.externalId, entry.here.prevention])).toEqual([
        ['T1078', { held: 0, total: 1 }],
        ['T1110', { held: 1, total: 1 }],
      ]);
    });

    it('should ignore a result of a platform that does not implement the control', async () => {
      await insertMeasuredResult('dismissed', { technique: 'T1078', expectationType: 'detection', securityPlatformType: EDR_FAMILY });

      const idp = await control('IDP');
      expect(idp?.testedHere).toBeNull();
      expect(idp?.standsOn.find((entry) => entry.externalId === 'T1078')?.here).toEqual({ prevention: null, detection: null, lastRunAt: null });
    });

    it('should drop a result older than the validity window', async () => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 30 });
      await insertMeasuredResult('dismissed', { technique: 'T1110', evaluatedAt: daysAgo(90) });

      expect((await control('IDP'))?.testedHere).toBeNull();
    });

    it('should list a technique the control was tested on here although the asset does not carry it', async () => {
      await insertMeasuredResult('dismissed', { technique: 'T1556' });

      const idp = await control('IDP');
      expect(idp?.standsOn[0]).toMatchObject({ externalId: 'T1556', onAsset: false, here: { prevention: { held: 1, total: 1 } } });
      expect(idp?.assetTechniqueCount).toBe(idp!.standsOn.length - 1);
    });

    it('should count the technique of a finding still applicable here among the asset techniques', async () => {
      await insertMeasuredResult('applicable', { technique: 'T1556' });

      expect((await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1556')).toMatchObject({
        onAsset: true,
        here: { prevention: { held: 0, total: 1 } },
      });
    });

    it('should keep the run verdict when a person dismissed the finding after it, and drop it from the asset techniques', async () => {
      const evidenceId = await insertMeasuredResult('applicable', { technique: 'T1556', evaluatedAt: daysAgo(2) });
      await dismissByPerson(evidenceId, daysAgo(1));

      expect((await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1556')).toMatchObject({
        onAsset: false,
        here: { prevention: { held: 0, total: 1 } },
      });
    });

    it('should read the latest run verdict by its date, not by the order it was written in', async () => {
      const evidenceId = await insertMeasuredResult('dismissed', { technique: 'T1110', evaluatedAt: daysAgo(1) });
      await insertSyncedVerdict(evidenceId, 'applicable', daysAgo(3));

      expect((await control('IDP'))?.testedHere).toMatchObject({ prevention: { held: 1, total: 1 } });
    });

    it('should keep a control of another category that a fresh result here speaks for', async () => {
      await insertMeasuredResult('dismissed', { technique: 'T1003', securityPlatformType: EDR_FAMILY });

      expect(await control('EDR')).toMatchObject({
        protectsAssetCategory: false,
        testedHere: { prevention: { held: 1, total: 1 } },
      });
    });
  });

  describe('fleet', () => {
    it('should count every asset of the estate a platform implementing the control tested', async () => {
      const other = await createAsset('Customer portal');
      await insertMeasuredResult('dismissed', { technique: 'T1110' });
      await insertMeasuredResult('applicable', { technique: 'T1110', supportingAssetId: other });

      const t1110 = (await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1110');
      expect(t1110?.here.prevention).toEqual({ held: 1, total: 1 });
      expect(t1110?.fleet).toMatchObject({ prevention: { held: 1, total: 2 }, assetCount: 2 });
    });

    it('should count an asset tested twice on a technique once in the fleet', async () => {
      await insertMeasuredResult('dismissed', { technique: 'T1110', scenarioId: 'scenario-1' });
      await insertMeasuredResult('applicable', { technique: 'T1110', scenarioId: 'scenario-2' });

      const t1110 = (await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1110');
      expect(t1110?.fleet).toMatchObject({ prevention: { held: 1, total: 2 }, assetCount: 1 });
    });

    it('should drop a result older than the validity window from the fleet', async () => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 30 });
      const other = await createAsset('Customer portal');
      await insertMeasuredResult('dismissed', { technique: 'T1110' });
      await insertMeasuredResult('applicable', { technique: 'T1110', supportingAssetId: other, evaluatedAt: daysAgo(90) });

      const t1110 = (await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1110');
      expect(t1110?.fleet).toMatchObject({ prevention: { held: 1, total: 1 }, assetCount: 1 });
    });

    it('should keep every result in the fleet under the longest validity window the settings accept', async () => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 2_147_483_647 });
      const other = await createAsset('Customer portal');
      await insertMeasuredResult('dismissed', { technique: 'T1110' });
      await insertMeasuredResult('applicable', { technique: 'T1110', supportingAssetId: other, evaluatedAt: daysAgo(90) });

      const t1110 = (await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1110');
      expect(t1110?.fleet).toMatchObject({ prevention: { held: 1, total: 2 }, assetCount: 2 });
    });

    it('should leave out of the fleet a result of a platform that does not implement the control', async () => {
      const other = await createAsset('Customer portal');
      await insertMeasuredResult('dismissed', { technique: 'T1110' });
      await insertMeasuredResult('applicable', { technique: 'T1110', supportingAssetId: other, securityPlatformType: EDR_FAMILY });

      const t1110 = (await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1110');
      expect(t1110?.fleet).toMatchObject({ prevention: { held: 1, total: 1 }, assetCount: 1 });
    });

    it('should count only the assets a closed scope maps', async () => {
      const other = await createAsset('Customer portal');
      await insertMeasuredResult('dismissed', { technique: 'T1110' });
      await insertMeasuredResult('applicable', { technique: 'T1110', supportingAssetId: other });
      const organizationId = await createScope('Payments platform');
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, {
        estateMode: 'closed',
        mapping: { added: [assetId], removed: [] },
      });

      const t1110 = (await control('IDP', organizationId))?.standsOn.find((entry) => entry.externalId === 'T1110');
      expect(t1110?.fleet).toMatchObject({ prevention: { held: 1, total: 1 }, assetCount: 1 });
    });

    // The fleet is folded in SQL and this asset's own results are counted row by row: on an estate
    // holding only this asset, the two must agree on every technique of every control.
    it('should read in the fleet what it reads here when the estate is this asset alone', async () => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ measuredValidityDays: 30 });
      const grid = [ISPM, EDR_FAMILY, 'XDR', 'NDR', 'SIEM'].flatMap((securityPlatformType) =>
        ['T1110', 'T1110.001', 'T1003', 'T1003.006', 'T1027', 'T1190'].flatMap((technique) =>
          (['prevention', 'detection'] as const).map((expectationType) => ({ securityPlatformType, technique, expectationType }))));
      // Each result tested twice, by scenarios measured on different days, some past the window.
      for (const [index, result] of grid.entries()) {
        await insertMeasuredResult(index % 3 === 0 ? 'applicable' : 'dismissed', { ...result, scenarioId: 'scenario-1', evaluatedAt: daysAgo(1 + (index % 4)) });
        await insertMeasuredResult(index % 3 === 1 ? 'applicable' : 'dismissed', { ...result, scenarioId: 'scenario-2', evaluatedAt: daysAgo(index % 2 === 0 ? 20 : 45) });
      }

      const { controls } = await read();
      const entries = controls.flatMap((entry) => entry.standsOn);
      expect(entries.map((entry) => entry.fleet)).toEqual(entries.map((entry) => ({
        ...entry.here,
        assetCount: entry.here.prevention === null && entry.here.detection === null ? 0 : 1,
      })));
      expect(new Set(controls.filter((entry) => entry.standsOn.some((technique) => technique.here.prevention !== null)).map((entry) => entry.externalId)).size)
        .toBeGreaterThan(3);
    });
  });

  describe('risk scope membership', () => {
    it('should list nothing under a closed scope that does not map the asset', async () => {
      const other = await createAsset('Customer portal');
      const organizationId = await createScope('Retail network');
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, {
        estateMode: 'closed',
        mapping: { added: [other], removed: [] },
      });

      expect(await read(organizationId)).toEqual({ inScope: false, controls: [] });
    });

    it('should refuse a scope the caller cannot see', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const assetB = await createAsset('Tenant B portal', originB);
      const organizationId = await createScope('Acme Bank Europe');

      await expect(read(organizationId, originB, assetB)).rejects.toThrow(RiskScopeNotFoundError);
    });
  });

  describe('tenant isolation', () => {
    it('should refuse another tenant asset', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      await expect(read(undefined, originB)).rejects.toThrow(SupportingAssetNotFoundError);
    });

    it('should never count another tenant result in the fleet', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const assetB = await createAsset('Tenant B portal', originB);
      const evidenceId = uuidv7();
      await db.insert(assetEvidence).values([{
        id: evidenceId,
        supportingAssetId: assetB,
        tenantId: tenantBId,
        mitreTechniqueId: techniqueId('T1110'),
        expectationType: 'prevention',
        securityPlatformType: ISPM,
        sourceScenarioId: 'scenario-b',
        evaluatedAt: daysAgo(1),
      }]);
      await insertSyncedVerdict(evidenceId, 'dismissed', daysAgo(1));

      const t1110 = (await control('IDP'))?.standsOn.find((entry) => entry.externalId === 'T1110');
      expect(t1110?.fleet).toMatchObject({ prevention: null, assetCount: 0 });
    });
  });
});
