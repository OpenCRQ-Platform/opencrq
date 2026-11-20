import type { EventOrigin } from '@app/module';
import { CRQ_INDICATOR_DEFAULTS } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('CRQ Indicator Settings Service', () => {
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
  });

  describe('security policy', () => {
    it('should let a member without the security capability read the tenant settings', async () => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 500 });
      const member = await createTenantUser(services, db, adminOrigin);

      const settings = await services.withOrigin(member.origin).crqIndicatorSettings.getCrqIndicatorSettings();
      expect(settings.iterations).toBe(500);
    });

    it('should refuse a first write from a member without the security capability', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(member.origin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 500 }),
      ).rejects.toThrow('Access Denied');
      const settings = await services.withOrigin(adminOrigin).crqIndicatorSettings.getCrqIndicatorSettings();
      expect(settings.iterations).toBe(CRQ_INDICATOR_DEFAULTS.iterations);
    });

    it('should leave the stored settings untouched when a member without the security capability overwrites them', async () => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 500 });
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(
        services.withOrigin(member.origin).crqIndicatorSettings.updateCrqIndicatorSettings({ iterations: 900 }),
      ).rejects.toThrow('Access Denied');

      const settings = await services.withOrigin(adminOrigin).crqIndicatorSettings.getCrqIndicatorSettings();
      expect(settings.iterations).toBe(500);
    });
  });
});
