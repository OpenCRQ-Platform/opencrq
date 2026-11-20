import type { EventOrigin } from '@app/module';
import { AttackOutcome_Ransomware, crqIndicatorRuns, currentTefCatalogueRef, deriveSeedId, tefEstimates } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('CRQ Indicators — auto TEF (tef_estimates)', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;
  let attackOutcomeId: string;

  const createScenario = async (): Promise<string> => {
    const scenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: scenarioId,
      organizationId,
      name: 'Ransomware scenario',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });
    return scenarioId;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: organizationId, name: 'Test Organization' },
    ]);

    attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_Ransomware);
    riskScenarioId = await createScenario();
  });

  const setProfile = async (profile: { sector?: string, country?: string, revenueBand?: 'under_10m' | '10m_100m' | 'over_100b' | null, employeeCount?: number | null }) => {
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, {
      sectorId: profile.sector === undefined ? null : sectors.find((s) => s.name === profile.sector)!.id,
      countryId: profile.country === undefined ? null : countries.find((c) => c.isoAlpha3 === profile.country)!.id,
      revenueBand: profile.revenueBand ?? null,
      employeeCount: profile.employeeCount ?? null,
    });
  };

  describe('open-data catalogue read', () => {
    it('should record the row read for a complete profile, and no multiplier', async () => {
      await setProfile({ sector: 'Finance', country: 'USA', revenueBand: 'over_100b', employeeCount: 5000 });

      const estimate = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(estimate).toMatchObject({
        positioned: true,
        fallbackReason: null,
        catalogVintage: null,
        catalogId: currentTefCatalogueRef().id,
        catalogVersion: currentTefCatalogueRef().version,
        countryIsoAlpha3: 'USA',
        sectorName: 'Finance',
        sizeSource: 'employee_count',
        readCountry: 'US',
        readSector: 'Finance',
        readSizeClasses: ['5000+'],
        readSizeWeights: [1],
      });
      expect(estimate.sourceIds!.length).toBeGreaterThan(0);
      expect(estimate.min).toBeLessThanOrEqual(estimate.likely);
      expect(estimate.likely).toBeLessThanOrEqual(estimate.max);
    });

    it('should read the size classes the revenue band spans when the profile has no employee count', async () => {
      await setProfile({ sector: 'Finance', country: 'FRA', revenueBand: '10m_100m', employeeCount: null });
      const byRevenue = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      await setProfile({ sector: 'Finance', country: 'FRA', revenueBand: '10m_100m', employeeCount: 120 });
      const byHeadcount = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(byRevenue.sizeSource).toBe('revenue_band');
      expect(byRevenue.readSizeClasses).toEqual(['10-49', '50-249', '250-999']);
      expect(byHeadcount.readSizeClasses).toEqual(['50-249']);
      expect(byRevenue.likely).not.toBe(byHeadcount.likely);
    });

    it('should read the row of every sector for a sector the catalogue does not measure', async () => {
      await setProfile({ sector: 'Unknown', country: 'USA', employeeCount: 5000 });

      const estimate = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(estimate.readSector).toBeNull();
    });

    it('should read the row of every country, not measured for the country, for a country the catalogue does not cover', async () => {
      await setProfile({ sector: 'Finance', country: 'ATA', employeeCount: 5000 });

      const estimate = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(estimate.readCountry).toBe('*');
      expect(estimate.notMeasured).toContain('country');
    });

    it('should return the read with its not measured markers, and its source with its reference period', async () => {
      await setProfile({ sector: 'Finance', country: 'FRA', revenueBand: '10m_100m' });

      const estimate = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      expect(estimate.read).toMatchObject({
        catalogue: currentTefCatalogueRef(),
        countryIsoAlpha3: 'FRA',
        sectorName: 'Finance',
        sizeSource: 'revenue_band',
        country: 'FR',
        sector: 'Finance',
        low: estimate.min,
        likely: estimate.likely,
        high: estimate.max,
      });
      expect(estimate.read!.sizeClasses.map((share) => share.sizeClass)).toEqual(['10-49', '50-249', '250-999']);
      expect(estimate.read!.notMeasured.every((mark) => ['country', 'sector', 'size'].includes(mark))).toBe(true);
      expect(estimate.read!.sources!.map((source) => source.title)).toEqual(['Filigran Intelligence']);
      expect(estimate.read!.sources![0]?.referencePeriod).toMatch(/^\d{4}(-\d{4})?$/);
    });

    it('should list the sources of an estimate read from a catalogue the platform no longer ships as no longer known', async () => {
      const current = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      await db.update(tefEstimates).set({ catalogVersion: '0.9.0' }).where(eq(tefEstimates.id, current.id));

      const [listed] = await services.withOrigin(adminOrigin).crqIndicators.getScopeScenarioTefs(organizationId);

      expect(listed.read).toMatchObject({ catalogue: { id: currentTefCatalogueRef().id, version: '0.9.0' }, sources: null });
    });

    it('should list an estimate written by the previous method as having no catalogue read', async () => {
      const current = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      await db.insert(tefEstimates).values({
        id: uuidv7(), riskScenarioId, catalogVintage: 2, min: 1, likely: 2, max: 3, positioned: true, fallbackReason: null, createdAt: new Date(current.createdAt.getTime() + 1000),
      });

      const [listed] = await services.withOrigin(adminOrigin).crqIndicators.getScopeScenarioTefs(organizationId);

      expect(listed).toMatchObject({ likely: 2, read: null });
    });

    it('should refuse an estimate naming a catalogue package that records no read', async () => {
      await expect(db.insert(tefEstimates).values({
        id: uuidv7(), riskScenarioId, catalogVintage: null, catalogId: 'opencrq-open-data', catalogVersion: '1', min: 1, likely: 2, max: 3, positioned: true, fallbackReason: null,
      })).rejects.toThrow();
    });
  });

  describe('incomplete profile', () => {
    it('should record a profile with no country, sector or size as not positioned, read across every size class', async () => {
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(estimate).toMatchObject({ positioned: false, fallbackReason: 'incomplete_firmography', sizeSource: 'none', readCountry: '*', readSector: null, readSizeClasses: ['0-9', '10-49', '50-249', '250-999', '1000-4999', '5000+'] });
      expect(estimate.min).toBeLessThanOrEqual(estimate.likely);
      expect(estimate.likely).toBeLessThanOrEqual(estimate.max);
    });

    // Every scenario now starts in auto mode, so the read path has to serve a frequency even for
    // a scope that declares no sector, country or revenue band.
    it('serves a usable frequency on the read path a freshly created scenario takes', async () => {
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      expect(estimate.likely).toBeGreaterThan(0);
    });
  });

  describe('read path', () => {
    it('returns the same row on a repeated read with no intervening trigger', async () => {
      const first = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);
      const second = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      expect(second.id).toBe(first.id);
    });

    it('resolves inline and persists on the first read when no row exists yet', async () => {
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);
      expect(estimate.riskScenarioId).toBe(riskScenarioId);
    });

    it('keeps the stored row when a recompute resolves to the same estimate', async () => {
      const first = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      const second = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(second.id).toBe(first.id);
    });

    it('records a new row when the stored one was read from another version of the catalogue', async () => {
      const first = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      await db.update(tefEstimates).set({ catalogVersion: 'an earlier version' }).where(eq(tefEstimates.id, first.id));

      const second = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(second.id).not.toBe(first.id);
      expect(second.catalogVersion).toBe(currentTefCatalogueRef().version);
    });

    it('replaces on the next read an estimate written by the previous method, keeping it as history', async () => {
      const current = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      const previousMethodId = uuidv7();
      await db.insert(tefEstimates).values({
        id: previousMethodId, riskScenarioId, catalogVintage: 2, min: 1, likely: 2, max: 3, positioned: true, fallbackReason: null, createdAt: new Date(current.createdAt.getTime() + 1000),
      });

      const estimate = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      expect(estimate).toMatchObject({ catalogVintage: null, catalogId: currentTefCatalogueRef().id, catalogVersion: currentTefCatalogueRef().version, likely: current.likely });
      const rows = await db.select().from(tefEstimates).where(eq(tefEstimates.riskScenarioId, riskScenarioId));
      expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([current.id, previousMethodId, estimate.id]));
      expect(rows).toHaveLength(3);
    });

    it.each([
      ['another version of the shipped catalogue', { catalogVersion: '0.9.0' }],
      ['another catalogue at the shipped version', { catalogId: 'another-catalogue' }],
    ])('replaces on the next read an estimate read from %s', async (_label, stale) => {
      const first = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);
      await db.update(tefEstimates).set(stale).where(eq(tefEstimates.id, first.id));

      const second = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      expect(second.id).not.toBe(first.id);
      expect(second).toMatchObject({ catalogId: currentTefCatalogueRef().id, catalogVersion: currentTefCatalogueRef().version });
    });

    it('records a new row once the firmography moves the estimate', async () => {
      const first = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      await setProfile({ sector: 'Finance', country: 'USA', revenueBand: 'over_100b', employeeCount: 5000 });

      const second = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(second.id).not.toBe(first.id);
      expect(second.positioned).toBe(true);
      expect(first.positioned).toBe(false);
    });

    it('records a new row reading the new size class once the employee count crosses a class edge', async () => {
      await setProfile({ sector: 'Finance', country: 'FRA', employeeCount: 200 });
      const first = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      await setProfile({ sector: 'Finance', country: 'FRA', employeeCount: 230 });
      const unchanged = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      await setProfile({ sector: 'Finance', country: 'FRA', employeeCount: 300 });

      const moved = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      expect(unchanged.id).toBe(first.id);
      expect(moved.id).not.toBe(first.id);
      expect([first.readSizeClasses, moved.readSizeClasses]).toEqual([['50-249'], ['250-999']]);
    });
  });

  describe('mode', () => {
    it('defaults new scenarios to auto and round-trips a mode change', async () => {
      const newScenarioId = await createScenario();
      expect(await services.withOrigin(adminOrigin).crqIndicators.getTefMode(newScenarioId)).toBe('auto');

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(newScenarioId, 'manual', tenantId);
      expect(await services.withOrigin(adminOrigin).crqIndicators.getTefMode(newScenarioId)).toBe('manual');

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(newScenarioId, 'auto', tenantId);
      expect(await services.withOrigin(adminOrigin).crqIndicators.getTefMode(newScenarioId)).toBe('auto');
    });

    it('keeps the stored estimate across a round trip that changed nothing', async () => {
      const first = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);
      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'manual', tenantId);

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'auto', tenantId);

      const rows = await db.select().from(tefEstimates).where(eq(tefEstimates.riskScenarioId, riskScenarioId));
      expect(rows.map((row) => row.id)).toEqual([first.id]);
    });

    it('records a new estimate on the return to auto when the last run drew another frequency', async () => {
      const abandoned = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);
      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'manual', tenantId);
      await db.insert(crqIndicatorRuns).values({
        id: uuidv7(),
        riskScenarioId,
        iterations: 1000,
        vulnerabilityP5: 0.1,
        vulnerabilityP50: 0.2,
        vulnerabilityP95: 0.3,
        techniqueCount: 10,
        coveredTechniqueCount: 4,
        tefMin: 1,
        tefLikely: 2,
        tefMax: 4,
      });

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'auto', tenantId);

      const current = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);
      expect(current.id).not.toBe(abandoned.id);
      expect(current.likely).toBe(abandoned.likely);
    });

    it('hands manual mode the frequency auto reached, stamped with when it came into force', async () => {
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'manual', tenantId);

      const round3 = (value: number) => Math.round(value * 1000) / 1000;
      const mirror = await services.withOrigin(adminOrigin).crqIndicators.getTefInput(riskScenarioId);
      expect(mirror).toMatchObject({
        min: round3(estimate.min),
        likely: round3(estimate.likely),
        max: round3(estimate.max),
      });
      // Not the moment of the switch: a run that already sampled those values would then read as
      // predating them.
      expect(mirror.updatedAt).toEqual(estimate.createdAt);
    });

    it('writes no estimate when the mode it is set to is the one it already carries', async () => {
      const first = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'auto', tenantId);

      const rows = await db.select().from(tefEstimates).where(eq(tefEstimates.riskScenarioId, riskScenarioId));
      expect(rows.map((row) => row.id)).toEqual([first.id]);
    });
  });

  describe('tenant isolation', () => {
    it('does not let another tenant read this tenant\'s tef_estimates row', async () => {
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);
      expect(estimate).toBeTruthy();

      const adminUserId = adminOrigin.type === 'client' ? adminOrigin.userId : '';
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherOrgId = uuidv7();
      await services.withOrigin(otherOrigin).organizations.createOrganizations([
        { id: otherOrgId, name: 'Other Tenant Org' },
      ]);
      const otherScenarioId = uuidv7();
      const otherOutcomeId = deriveSeedId(otherTenantId, AttackOutcome_Ransomware);
      await services.withOrigin(otherOrigin).riskScenarios.createRiskScenario({
        id: otherScenarioId,
        organizationId: otherOrgId,
        name: 'Other tenant scenario',
        description: null,
        attackOutcomeId: otherOutcomeId,
        primaryAssetIds: [],
      });

      // Read against the fallback rather than against the stored value: this scenario is manual, so
      // the `auto` a foreign origin reads can only be the default standing in for a row it never saw.
      await services.withOrigin(adminOrigin).crqIndicators.setTefMode(riskScenarioId, 'manual', tenantId);
      const crossTenantRead = await services.withOrigin(otherOrigin).crqIndicators.getTefMode(riskScenarioId);
      expect(crossTenantRead).toBe('auto');
      expect(await services.withOrigin(adminOrigin).crqIndicators.getTefMode(riskScenarioId)).toBe('manual');
    });
  });

  describe('cascade delete', () => {
    it('cascades tef_estimates when the risk scenario is deleted', async () => {
      await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      await services.withOrigin(adminOrigin).riskScenarios.deleteRiskScenarios([riskScenarioId]);

      const remainingEstimates = await db.select().from(tefEstimates).where(eq(tefEstimates.riskScenarioId, riskScenarioId));
      expect(remainingEstimates).toHaveLength(0);
    });
  });

  describe('security policy', () => {
    it('denies a foreign tenant from reading or resolving this tenant\'s scenario', async () => {
      await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(riskScenarioId, tenantId);

      const adminUserId = adminOrigin.type === 'client' ? adminOrigin.userId : '';
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const foreignUser = await createTenantUser(services, db, otherOrigin);

      // The foreign tenant's secured views show no row to reuse and no risk scenario to compute
      // from, so the read path throws rather than fabricating a cross-tenant estimate.
      await expect(services.withOrigin(foreignUser.origin).crqIndicators.getAutoTefEstimate(riskScenarioId, otherTenantId))
        .rejects.toThrow();
    });
  });
});
