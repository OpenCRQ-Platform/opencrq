import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { EMPTY_ANSWERS } from '../../helpers/financial-profile-answers';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Financial Profiles Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: organizationId, name: 'Test Organization' },
    ]);
  });

  describe('CRUD', () => {
    it('returns null when no profile exists yet', async () => {
      const profile = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profile).toBeNull();
    });

    it('creates a profile on first save', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        grossMarginPct: 40,
        timeToRevenueImpactBand: 'under_6h',
      });

      const profile = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profile).toBeTruthy();
      expect(profile!.organizationId).toBe(organizationId);
      expect(profile!.grossMarginPct).toBe(40);
      expect(profile!.timeToRevenueImpactBand).toBe('under_6h');
      expect(profile!.coefficientSetVersion).toBeNull();
    });

    it('updates the same row on a second save, keeping its id (upsert, never delete-then-reinsert)', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        grossMarginPct: 40,
      });
      const first = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);

      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        grossMarginPct: 55,
      });
      const second = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);

      expect(second!.id).toBe(first!.id);
      expect(second!.grossMarginPct).toBe(55);
    });

    it('accepts a save with only optional fields blank as a legitimate end state', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        annualRevenue: 50_000_000,
        grossMarginPct: 30,
        itDependentRevenuePct: 80,
        timeToRevenueImpactBand: 'under_6h',
        fullRestoreBand: 'under_1d',
        recordsHeldGate: false,
        ransomPaymentPosture: false,
      });

      const profile = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profile).toBeTruthy();
      expect(profile!.operatingDaysBand).toBeNull();
    });

    it('clears every gated child answer when its gate is saved as No', async () => {
      // The cards clear these inline too, but the server is the authority: a stale ceiling reaching
      // it by any other path — an older client, a direct call — must not be persisted as an answer.
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        recordsHeldGate: false,
        individualsBand: 'under_100k',
        outOfBandVerificationGate: false,
        outOfBandThreshold: 5_000,
        ransomPaymentPosture: false,
        ransomPaymentCeiling: 1_900_000,
      });

      const profile = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profile!.individualsBand).toBeNull();
      expect(profile!.outOfBandThreshold).toBeNull();
      expect(profile!.ransomPaymentCeiling).toBeNull();
    });

    it('keeps a gated child answer while its gate is Yes', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        recordsHeldGate: true,
        individualsBand: 'under_100k',
        ransomPaymentPosture: true,
        ransomPaymentCeiling: 1_900_000,
      });

      const profile = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profile!.individualsBand).toBe('under_100k');
      expect(profile!.ransomPaymentCeiling).toBe(1_900_000);
    });

    it('rewrites the organization revenue band from a saved annual revenue amount', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        annualRevenue: 300_000_000,
      });

      const organization = await services.withOrigin(adminOrigin).organizations.getOrganization(organizationId);
      expect(organization!.revenueBand).toBe('100m_1b');
    });

    it('clears the organization revenue band once the exact amount is cleared', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        annualRevenue: 300_000_000,
      });

      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        annualRevenue: null,
      });

      const organization = await services.withOrigin(adminOrigin).organizations.getOrganization(organizationId);
      expect(organization!.revenueBand).toBeNull();
    });

    it('keeps a revenue band set on the organization when other answers are saved with a blank revenue', async () => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { revenueBand: '10m_100m' });

      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        grossMarginPct: 40,
      });

      const organization = await services.withOrigin(adminOrigin).organizations.getOrganization(organizationId);
      expect(organization!.revenueBand).toBe('10m_100m');
    });

    it('normalizes a gated detail value saved while its gate is closed, rather than persisting it as-is', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        recordsHeldGate: false,
        individualsBand: '1m_5m',
        outOfBandVerificationGate: false,
        outOfBandThreshold: 50_000,
        ransomPaymentPosture: false,
        ransomPaymentCeiling: 1_000_000,
      });

      const profile = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(profile!.individualsBand).toBeNull();
      expect(profile!.outOfBandThreshold).toBeNull();
      expect(profile!.ransomPaymentCeiling).toBeNull();
    });
  });

  describe('uniqueness', () => {
    it('rejects a second row for the same organization at the database level', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, EMPTY_ANSWERS);

      await expect(
        db.execute(sql`INSERT INTO financial_profiles (id, tenant_id, organization_id, updated_at) VALUES (${uuidv7()}, ${tenantId}, ${organizationId}, now())`),
      ).rejects.toThrow();
    });
  });

  describe('tenant isolation', () => {
    it('does not expose a profile to another tenant', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        grossMarginPct: 40,
      });

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      const result = await services.withOrigin(otherOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(result).toBeNull();
    });

    it('rejects a first save from another tenant for an organization it does not belong to', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      await expect(
        services.withOrigin(otherOrigin).financialProfiles.saveFinancialProfile(organizationId, EMPTY_ANSWERS),
      ).rejects.toThrow('Risk scope not found');

      const result = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(result).toBeNull();
    });

    it('does not let another tenant overwrite a profile it cannot see', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        grossMarginPct: 40,
      });

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      await expect(
        services.withOrigin(otherOrigin).financialProfiles.saveFinancialProfile(organizationId, {
          ...EMPTY_ANSWERS,
          grossMarginPct: 99,
        }),
      ).rejects.toThrow('Risk scope not found');

      const original = await services.withOrigin(adminOrigin).financialProfiles.getFinancialProfile(organizationId);
      expect(original!.grossMarginPct).toBe(40);
    });
  });

  describe('cascade delete', () => {
    it('deletes the financial profile when its organization is deleted', async () => {
      await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, {
        ...EMPTY_ANSWERS,
        grossMarginPct: 40,
      });

      await services.withOrigin(adminOrigin).organizations.deleteOrganizations([organizationId]);

      const result = await db.execute(sql`SELECT 1 FROM financial_profiles WHERE organization_id = ${organizationId}`);
      expect(result.rows).toHaveLength(0);
    });
  });
});
