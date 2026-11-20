import type { EventOrigin, JobDependencyAccess } from '@app/module';
import { jobDependencies, SUBSCRIBE_ALL_SENTINEL, tenants } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const system: EventOrigin = { type: 'system' };
const KIND = 'finding-score-recompute';

const tablesOf = async (origin: EventOrigin, tenantId: string, access: JobDependencyAccess): Promise<Array<string>> => {
  const all = await services.withOrigin(origin).jobDependencies.getAllObservations();
  return all
    .filter((row) => row.jobKind === KIND && row.tenantId === tenantId && row.access === access)
    .map((row) => row.tableName)
    .sort();
};

describe('Job Dependencies Service', () => {
  let tenantId: string;
  let otherTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    otherTenantId = await createTenant(services, setup.userId);
  });

  describe('replace semantics', () => {
    it('should persist reads and writes and return them apart', async () => {
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, tenantId, {
        reads: ['asset_evidence', 'cve'],
        writes: ['finding_scores'],
      });
      expect(await tablesOf(system, tenantId, 'read')).toEqual(['asset_evidence', 'cve']);
      expect(await tablesOf(system, tenantId, 'write')).toEqual(['finding_scores']);
    });

    it('should replace the previous observation entirely, not merge into it', async () => {
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, tenantId, { reads: ['asset_evidence', 'cve'], writes: ['finding_scores'] });
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, tenantId, { reads: [SUBSCRIBE_ALL_SENTINEL], writes: [] });
      expect(await tablesOf(system, tenantId, 'read')).toEqual([SUBSCRIBE_ALL_SENTINEL]);
      expect(await tablesOf(system, tenantId, 'write')).toEqual([]);
    });

    it('should keep observations of different tenants independent', async () => {
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, tenantId, { reads: ['asset_evidence'], writes: [] });
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, otherTenantId, { reads: ['cve'], writes: [] });
      const all = await services.withOrigin(system).jobDependencies.getAllObservations();
      expect(all).toHaveLength(2);
      expect(await tablesOf(system, tenantId, 'read')).toEqual(['asset_evidence']);
    });
  });

  describe('merge semantics', () => {
    it('should add the tables of a resumed run to the persisted set and return the union', async () => {
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, tenantId, { reads: ['asset_evidence', 'cve'], writes: ['finding_scores'] });
      const merged = await services.withOrigin(system).jobDependencies.mergeObservation(KIND, tenantId, { reads: ['cve', 'epss'], writes: [] });
      expect(merged).toEqual({ reads: ['asset_evidence', 'cve', 'epss'], writes: ['finding_scores'] });
      expect(await tablesOf(system, tenantId, 'read')).toEqual(['asset_evidence', 'cve', 'epss']);
      expect(await tablesOf(system, tenantId, 'write')).toEqual(['finding_scores']);
    });

    it('should leave the observations of other tenants alone', async () => {
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, otherTenantId, { reads: ['asset_evidence'], writes: [] });
      const merged = await services.withOrigin(system).jobDependencies.mergeObservation(KIND, tenantId, { reads: ['cve'], writes: [] });
      expect(merged).toEqual({ reads: ['cve'], writes: [] });
      expect(await tablesOf(system, otherTenantId, 'read')).toEqual(['asset_evidence']);
    });
  });

  describe('tenant cascade', () => {
    it('should drop the observation rows with their tenant', async () => {
      // A bare tenant row: the factory tenant owns groups, whose FK has no cascade and blocks the
      // delete before the constraint under test is ever exercised.
      const bareTenantId = uuidv7();
      await db.insert(tenants).values({ id: bareTenantId, name: 'Cascade probe' });
      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, bareTenantId, { reads: ['asset_evidence'], writes: ['finding_scores'] });
      await db.delete(tenants).where(eq(tenants.id, bareTenantId));
      const rows = await db.select().from(jobDependencies).where(eq(jobDependencies.tenantId, bareTenantId));
      expect(rows).toHaveLength(0);
    });
  });

  describe('security policy', () => {
    it('should let a job origin write and read only its own tenant', async () => {
      const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: KIND, interactive: false };
      await services.withOrigin(jobOrigin).jobDependencies.replaceObservation(KIND, tenantId, { reads: ['asset_evidence'], writes: [] });
      expect(await tablesOf(jobOrigin, tenantId, 'read')).toEqual(['asset_evidence']);

      await services.withOrigin(system).jobDependencies.replaceObservation(KIND, otherTenantId, { reads: ['cve'], writes: [] });
      expect(await tablesOf(jobOrigin, otherTenantId, 'read')).toEqual([]);
    });

    it('should refuse a job origin writing another tenant observation', async () => {
      const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: KIND, interactive: false };
      await expect(
        services.withOrigin(jobOrigin).jobDependencies.replaceObservation(KIND, otherTenantId, { reads: ['cve'], writes: [] }),
      ).rejects.toThrow();
    });
  });
});
