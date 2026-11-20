import type { EventOrigin } from '@app/module';
import {
  controlCapabilities,
  controlCapabilityProtectedFamilies,
  PROTECTION_BY_EXTERNAL_ID,
  seedControlFamilyProtection,
} from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

// Every capability the table cites resolves in the catalogue, asserted by its data test.
const VENDORED_ROW_COUNT = Object.values(PROTECTION_BY_EXTERNAL_ID).reduce((total, families) => total + families.length, 0);

const countRows = async (): Promise<number> => {
  const result = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM control_capability_protected_families`);
  return Number(result.rows[0].n);
};

const capabilityId = async (externalId: string): Promise<string> => {
  const [capability] = await db.select({ id: controlCapabilities.id })
    .from(controlCapabilities)
    .where(eq(controlCapabilities.externalId, externalId));
  return capability.id;
};

const familiesFor = async (capability: string): Promise<Array<string>> =>
  db.select({ categoryId: controlCapabilityProtectedFamilies.categoryId })
    .from(controlCapabilityProtectedFamilies)
    .where(eq(controlCapabilityProtectedFamilies.capabilityId, capability))
    .then((rows) => rows.map((row) => row.categoryId));

describe('Control x protected asset family table', () => {
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
  });

  describe('seeding', () => {
    it('provisions the whole vendored table', async () => {
      expect(await countRows()).toBe(VENDORED_ROW_COUNT);
    });

    it('is stable across two runs', async () => {
      await seedControlFamilyProtection(db);
      await seedControlFamilyProtection(db);
      expect(await countRows()).toBe(VENDORED_ROW_COUNT);
    });

    it('prunes a pair the reference no longer carries', async () => {
      // The anti-DDoS service on an identity is the pin the table exists to refuse, so the
      // reference is guaranteed never to carry this pair.
      const ddosId = await capabilityId('DDOS');
      await db.insert(controlCapabilityProtectedFamilies)
        .values({ capabilityId: ddosId, categoryId: 'identity' })
        .onConflictDoNothing();

      await seedControlFamilyProtection(db);

      expect(await countRows()).toBe(VENDORED_ROW_COUNT);
      expect(await familiesFor(ddosId)).not.toContain('identity');
    });

    it('never names the unclassified bucket', async () => {
      const rows = await db.select({ categoryId: controlCapabilityProtectedFamilies.categoryId })
        .from(controlCapabilityProtectedFamilies);
      expect(rows.map((row) => row.categoryId)).not.toContain('generic_asset');
    });

    /*
     * Platform reference, one row set for the whole install. A tenant that one day disagrees with a
     * pair gets its own overlay table, the way it already overrides a technique recommendation, so
     * this table must never grow a tenant column back.
     */
    it('carries no tenant column', async () => {
      const result = await db.execute<{ column_name: string }>(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'control_capability_protected_families'
      `);
      expect(result.rows.map((row) => row.column_name).toSorted()).toEqual(['capability_id', 'category_id']);
    });
  });

  describe('the resolver', () => {
    it('answers the families a control protects, including one it never runs on', async () => {
      const idpId = await capabilityId('IDP');
      const pairs = await services.withOrigin(adminOrigin).controlCapabilities.getProtectedFamilies([idpId]);

      // An identity platform runs on identities and still stands in the way of an attack signing into a SaaS tenant.
      expect(pairs.map((pair) => pair.categoryId).toSorted()).toEqual([
        'cloud_resource', 'host', 'identity', 'saas_application', 'web_application',
      ]);
    });

    it('answers nothing for no control at all', async () => {
      expect(await services.withOrigin(adminOrigin).controlCapabilities.getProtectedFamilies([])).toEqual([]);
    });
  });

  describe('no write path', () => {
    it('exposes no mutation of the table on the service', () => {
      const client = services.withOrigin(adminOrigin).controlCapabilities as Record<string, unknown>;
      const mutating = Object.keys(client).filter((name) => /(family|families|protect)/i.test(name))
        .filter((name) => /^(create|update|delete|upsert|set|declare|save|add|remove|restore|reset)/.test(name));
      expect(mutating).toEqual([]);
    });

    it('holds no trace of the matrix it replaces', async () => {
      const result = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'control_capability_asset_families'
      `);
      expect(result.rows).toEqual([]);
    });
  });
});
