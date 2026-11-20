import type { EventOrigin } from '@app/module';
import { THREAT_RELEVANCE_DEFAULTS } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const customValues = {
  actHalfLifeObservedDays: 90,
  actHalfLifeAuthoredDays: 540,
  confidenceGate: 40,
};

const storedCustomValues = {
  ...customValues,
  unknownActivityAgeDays: THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays,
};

describe('Threat Relevance Settings Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;
  });

  it('should return defaults when no settings exist', async () => {
    const settings = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings();
    expect(settings).toEqual({
      actHalfLifeObservedDays: THREAT_RELEVANCE_DEFAULTS.actHalfLifeObservedDays,
      actHalfLifeAuthoredDays: THREAT_RELEVANCE_DEFAULTS.actHalfLifeAuthoredDays,
      confidenceGate: THREAT_RELEVANCE_DEFAULTS.confidenceGate,
      unknownActivityAgeDays: THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays,
    });
  });

  it('should upsert and retrieve settings', async () => {
    await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings(customValues);

    const settings = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings();
    expect(settings).toEqual(storedCustomValues);
  });

  it('should overwrite previously stored settings', async () => {
    const overwrittenValues = {
      actHalfLifeObservedDays: 200,
      actHalfLifeAuthoredDays: 400,
      confidenceGate: 20,
    };
    await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings(customValues);
    await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings(overwrittenValues);

    const settings = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings();
    expect(settings).toEqual({ ...overwrittenValues, unknownActivityAgeDays: THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays });
  });

  it('should store an explicit unknown activity age and read it back', async () => {
    await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings({
      ...customValues,
      unknownActivityAgeDays: 200,
    });

    const settings = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings();
    expect(settings).toEqual({ ...customValues, unknownActivityAgeDays: 200 });
  });

  it('should keep the stored unknown activity age when an update omits it', async () => {
    const settingsService = services.withOrigin(adminOrigin).threatRelevanceSettings;
    await settingsService.updateThreatRelevanceSettings({ ...customValues, unknownActivityAgeDays: 200 });

    const updatedValues = { actHalfLifeObservedDays: 120, actHalfLifeAuthoredDays: 600, confidenceGate: 20 };
    await settingsService.updateThreatRelevanceSettings(updatedValues);

    const settings = await settingsService.getThreatRelevanceSettings();
    expect(settings).toEqual({ ...updatedValues, unknownActivityAgeDays: 200 });
  });

  it('should replace the stored unknown activity age when an update sets a new one', async () => {
    const settingsService = services.withOrigin(adminOrigin).threatRelevanceSettings;
    await settingsService.updateThreatRelevanceSettings({ ...customValues, unknownActivityAgeDays: 200 });
    await settingsService.updateThreatRelevanceSettings({ ...customValues, unknownActivityAgeDays: 30 });

    const settings = await settingsService.getThreatRelevanceSettings();
    expect(settings).toEqual({ ...customValues, unknownActivityAgeDays: 30 });
  });

  it('should reject an unknown activity age outside the documented bounds', async () => {
    const settingsService = services.withOrigin(adminOrigin).threatRelevanceSettings;

    await expect(
      settingsService.updateThreatRelevanceSettings({ ...customValues, unknownActivityAgeDays: 6 }),
    ).rejects.toThrow('Invalid threat relevance settings');
    await expect(
      settingsService.updateThreatRelevanceSettings({ ...customValues, unknownActivityAgeDays: 3651 }),
    ).rejects.toThrow('Invalid threat relevance settings');

    const settings = await settingsService.getThreatRelevanceSettings();
    expect(settings).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });
  });

  it('should reject a non-client read that names no tenant', async () => {
    await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings(customValues);

    await expect(
      services.withOrigin({ type: 'system' }).threatRelevanceSettings.getThreatRelevanceSettings(),
    ).rejects.toThrow('Tenant context required to read threat relevance settings');
  });

  it('should read the named tenant on a non-client origin', async () => {
    await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings(customValues);

    const settings = await services.withOrigin({ type: 'system' }).threatRelevanceSettings.getThreatRelevanceSettings(adminTenantId);
    expect(settings).toEqual(storedCustomValues);
  });

  it('should reject an update without tenant context', async () => {
    await expect(
      services.withOrigin({ type: 'system' }).threatRelevanceSettings.updateThreatRelevanceSettings(customValues),
    ).rejects.toThrow('Tenant context required');

    const settings = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings();
    expect(settings).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });
  });

  it('should reject values outside the documented bounds', async () => {
    const settingsService = services.withOrigin(adminOrigin).threatRelevanceSettings;

    await expect(
      settingsService.updateThreatRelevanceSettings({ ...customValues, actHalfLifeObservedDays: 0 }),
    ).rejects.toThrow('Invalid threat relevance settings');
    await expect(
      settingsService.updateThreatRelevanceSettings({ ...customValues, actHalfLifeAuthoredDays: -1 }),
    ).rejects.toThrow('Invalid threat relevance settings');

    const settings = await settingsService.getThreatRelevanceSettings();
    expect(settings).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });
  });

  describe('security policy', () => {
    it('should let a member without the security capability read the tenant settings', async () => {
      await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings(customValues);
      const member = await createTenantUser(services, db, adminOrigin);

      const settings = await services.withOrigin(member.origin).threatRelevanceSettings.getThreatRelevanceSettings();
      expect(settings).toEqual(storedCustomValues);
    });

    it('should refuse a first write from a member without the security capability', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(member.origin).threatRelevanceSettings.updateThreatRelevanceSettings(customValues),
      ).rejects.toThrow('Access Denied');
      expect(await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings()).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });
    });

    it('should leave the stored settings untouched when a member without the security capability overwrites them', async () => {
      await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings(customValues);
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(services.withOrigin(member.origin).threatRelevanceSettings.updateThreatRelevanceSettings({
        actHalfLifeObservedDays: 200,
        actHalfLifeAuthoredDays: 400,
        confidenceGate: 20,
      })).rejects.toThrow('Access Denied');

      expect(await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings()).toEqual(storedCustomValues);
    });
  });

  it('should enforce tenant isolation', async () => {
    await services.withOrigin(adminOrigin).threatRelevanceSettings.updateThreatRelevanceSettings({
      ...customValues,
      unknownActivityAgeDays: 200,
    });

    // Create a second tenant with a separate user
    const tenantId2 = await createTenant(services, adminUserId);
    const adminInTenant2: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantId2 };
    const user2 = await createTenantUser(services, db, adminInTenant2);
    const origin2 = user2.origin;

    // Second tenant should see defaults, not first tenant's settings
    const settings2 = await services.withOrigin(origin2).threatRelevanceSettings.getThreatRelevanceSettings();
    expect(settings2).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });

    // First tenant should still see its custom settings
    const settings1 = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings();
    expect(settings1).toEqual({ ...customValues, unknownActivityAgeDays: 200 });
  });
});
