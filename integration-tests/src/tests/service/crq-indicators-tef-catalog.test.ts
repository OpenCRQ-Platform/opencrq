import type { EventOrigin } from '@app/module';
import {
  AttackOutcome_Ransomware,
  currentTefCatalogueRef,
  deriveSeedId,
  TefCatalogProfileUnknownIdError,
} from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('CRQ Indicators: open-data TEF catalogue', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  const idsOf = async (sectorName: string, isoAlpha3: string) => {
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    return { sectorId: sectors.find((sector) => sector.name === sectorName)!.id, countryId: countries.find((country) => country.isoAlpha3 === isoAlpha3)!.id };
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  describe('overview', () => {
    it('should name the catalogue package in force, its publisher, its one source and its seven outcomes', async () => {
      const catalog = await services.withOrigin(adminOrigin).crqIndicators.getTefCatalog(tenantId);

      expect({ id: catalog.id, version: catalog.version, publisher: catalog.publisher }).toEqual({ ...currentTefCatalogueRef(), publisher: 'Filigran' });
      expect(catalog.sizeClasses).toEqual(['0-9', '10-49', '50-249', '250-999', '1000-4999', '5000+']);
      expect(catalog.outcomes).toHaveLength(7);
      expect(catalog.sources.map((source) => [source.id, source.title, source.attribution])).toEqual([['filigran-intelligence', 'Filigran Intelligence', null]]);
    });

    it('should state how every sector, country and revenue band of the tenant is read', async () => {
      const [catalog, sectors, countries] = await Promise.all([
        services.withOrigin(adminOrigin).crqIndicators.getTefCatalog(tenantId),
        services.withOrigin(adminOrigin).sectors.getSectors(),
        services.withOrigin(adminOrigin).countries.getCountries(),
      ]);

      expect(catalog.sectors.map((sector) => sector.id).toSorted()).toEqual(sectors.map((sector) => sector.id).toSorted());
      expect(catalog.countries.map((country) => country.id).toSorted()).toEqual(countries.map((country) => country.id).toSorted());
      expect(catalog.sectors.find((sector) => sector.name === 'Finance')?.measured).toBe(true);
      expect(catalog.sectors.find((sector) => sector.name === 'Unknown')?.measured).toBe(false);
      expect(catalog.countries.find((country) => country.isoAlpha3 === 'FRA')?.readAs).toBe('FR');
      expect(catalog.countries.find((country) => country.isoAlpha3 === 'ATA')?.readAs).toBe('*');
      expect(catalog.revenueBands.find((band) => band.revenueBand === '10m_100m')?.sizeClasses.map((share) => share.sizeClass))
        .toEqual(['10-49', '50-249', '250-999']);
    });
  });

  describe('reading', () => {
    it('should read a profile exactly as the auto estimate of a risk scope with that profile', async () => {
      const { sectorId, countryId } = await idsOf('Health', 'DEU');
      const organizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { sectorId, countryId, revenueBand: '100m_1b', employeeCount: 700 });
      const riskScenarioId = uuidv7();
      const attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_Ransomware);
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: riskScenarioId, organizationId, name: 'Ransomware', description: null, attackOutcomeId, primaryAssetIds: [],
      });
      const estimate = await services.withOrigin(adminOrigin).crqIndicators.getAutoTefEstimate(riskScenarioId, tenantId);

      const reading = await services.withOrigin(adminOrigin).crqIndicators.getTefCatalogReading({ sectorId, countryId, employeeCount: 700, revenueBand: '100m_1b' }, tenantId);

      expect(reading.outcomes).toHaveLength(7);
      expect(reading.outcomes.find((outcome) => outcome.attackOutcomeId === attackOutcomeId)?.read).toEqual(estimate.read);
      expect(estimate.read).toMatchObject({ country: 'DE', sector: 'Health', sizeSource: 'employee_count', sizeClasses: [{ sizeClass: '250-999', weight: 1 }] });
    });

    it('should read a profile with no field on the row of every country and sector, mixing every size class', async () => {
      const reading = await services.withOrigin(adminOrigin).crqIndicators.getTefCatalogReading({ sectorId: null, countryId: null, employeeCount: null, revenueBand: null }, tenantId);

      for (const { read } of reading.outcomes) {
        expect(read).toMatchObject({ countryIsoAlpha3: null, sectorName: null, sizeSource: 'none', country: '*', sector: null });
        expect(read.sizeClasses.map((share) => share.sizeClass)).toEqual(['0-9', '10-49', '50-249', '250-999', '1000-4999', '5000+']);
        expect(read.notMeasured).toContain('country');
        expect(read.low).toBeLessThanOrEqual(read.likely);
        expect(read.likely).toBeLessThanOrEqual(read.high);
      }
    });

    it('should give the total attempts the sums of the outcomes\' minimums, modes and maximums', async () => {
      const reading = await services.withOrigin(adminOrigin).crqIndicators.getTefCatalogReading({ sectorId: null, countryId: null, employeeCount: 6200, revenueBand: null }, tenantId);
      const sumOf = (pick: (read: { low: number, likely: number, high: number }) => number): number => reading.outcomes.reduce((sum, { read }) => sum + pick(read), 0);

      expect(reading.total.low).toBeCloseTo(sumOf((read) => read.low), 12);
      expect(reading.total.likely).toBeCloseTo(sumOf((read) => read.likely), 12);
      expect(reading.total.high).toBeCloseTo(sumOf((read) => read.high), 12);
    });
  });

  describe('tenant isolation', () => {
    it('should serve a caller from another tenant none of this tenant\'s outcomes, sectors or countries, nor read its ids', async () => {
      const adminUserId = adminOrigin.type === 'client' ? adminOrigin.userId : '';
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const outsider = await createTenantUser(services, db, otherOrigin);
      const claimingThisTenant: EventOrigin = { type: 'client', userId: outsider.userId, tenantId };
      const { sectorId, countryId } = await idsOf('Finance', 'FRA');

      const catalog = await services.withOrigin(claimingThisTenant).crqIndicators.getTefCatalog(tenantId);
      const reading = services.withOrigin(claimingThisTenant).crqIndicators.getTefCatalogReading({ sectorId, countryId, employeeCount: 50, revenueBand: null }, tenantId);

      expect(catalog.outcomes).toEqual([]);
      expect(catalog.sectors).toEqual([]);
      expect(catalog.countries).toEqual([]);
      await expect(reading).rejects.toThrow(TefCatalogProfileUnknownIdError);
    });
  });
});
