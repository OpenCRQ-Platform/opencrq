import type { EventOrigin } from '@app/module';
import {
  APPLICABLE_TECHNIQUES,
  attackSurfaceMitreTechniques,
  attackSurfaces,
  deriveAttackSurfaceId,
  mitreTechniquesData,
  seedApplicableTechniques,
} from '@app/module';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const TECHNIQUE_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique]));

// Every external id the vendored table cites resolves to a technique, asserted by its data test.
const VENDORED_PAIR_COUNT = Object.values(APPLICABLE_TECHNIQUES).reduce((total, externalIds) => total + externalIds.length, 0);

const techniqueId = (externalId: string): string => {
  const technique = TECHNIQUE_BY_EXTERNAL_ID.get(externalId);
  if (!technique) {
    throw new Error(`technique ${externalId} missing from the vendored dataset`);
  }
  return technique.id;
};

const countJunctionRows = async (): Promise<number> => {
  const result = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM attack_surface_mitre_techniques`);
  return Number(result.rows[0].n);
};

const categoriesOf = (pairs: Array<{ categoryId: string }>): Array<string> => [...new Set(pairs.map((pair) => pair.categoryId))];

describe('Family x applicable technique table', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  describe('seeding', () => {
    it('gives a new tenant the whole vendored table', async () => {
      expect(await countJunctionRows()).toBe(VENDORED_PAIR_COUNT);
    });

    it('hangs the rows off the surface id a tenant provisioned before the derivation holds', async () => {
      const legacySurfaceId = randomUUID();
      const derivedSurfaceId = deriveAttackSurfaceId(tenantId, 'host');
      await db.delete(attackSurfaceMitreTechniques).where(eq(attackSurfaceMitreTechniques.attackSurfaceId, derivedSurfaceId));
      await db.update(attackSurfaces).set({ id: legacySurfaceId }).where(eq(attackSurfaces.id, derivedSurfaceId));

      await seedApplicableTechniques(db);

      const rows = await db.select().from(attackSurfaceMitreTechniques)
        .where(eq(attackSurfaceMitreTechniques.attackSurfaceId, legacySurfaceId));
      expect(rows.length).toBe(APPLICABLE_TECHNIQUES.host.length);
    });

    it('hangs every row off this tenant\'s own surface', async () => {
      const hostSurfaceId = deriveAttackSurfaceId(tenantId, 'host');
      const rows = await db.select().from(attackSurfaceMitreTechniques)
        .where(eq(attackSurfaceMitreTechniques.attackSurfaceId, hostSurfaceId));
      expect(rows.length).toBe(APPLICABLE_TECHNIQUES.host.length);
    });

    it('is stable across two runs', async () => {
      const before = await countJunctionRows();
      await seedApplicableTechniques(db);
      await seedApplicableTechniques(db);
      expect(await countJunctionRows()).toBe(before);
    });

    it('prunes a pair the reference no longer carries', async () => {
      // Disk Wipe on the identity system is one of the generator's curated negatives, so the
      // reference is guaranteed never to carry this pair.
      const identitySurfaceId = deriveAttackSurfaceId(tenantId, 'identity');
      await db.insert(attackSurfaceMitreTechniques)
        .values({ attackSurfaceId: identitySurfaceId, mitreTechniqueId: techniqueId('T1561') })
        .onConflictDoNothing();
      const inflated = await countJunctionRows();

      await seedApplicableTechniques(db);

      expect(await countJunctionRows()).toBeLessThan(inflated);
      const survivors = await db.select().from(attackSurfaceMitreTechniques)
        .where(eq(attackSurfaceMitreTechniques.attackSurfaceId, identitySurfaceId));
      expect(survivors.map((row) => row.mitreTechniqueId)).not.toContain(techniqueId('T1561'));
    });

    it('gives a second tenant its own rows rather than sharing the first tenant\'s', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      const own = await services.withOrigin(adminOrigin).attackSurfaces.getApplicableTechniques('identity');
      const other = await services.withOrigin(otherOrigin).attackSurfaces.getApplicableTechniques('identity');

      expect(own.map((technique) => technique.externalId)).toEqual(other.map((technique) => technique.externalId));
      expect(await countJunctionRows()).toBe(VENDORED_PAIR_COUNT * 2);
    });
  });

  describe('the families that ship with no entries', () => {
    it('carries techniques for every family but the unclassified bucket and the security platforms', async () => {
      const counts = await services.withOrigin(adminOrigin).attackSurfaces.getApplicableTechniqueCountPerCategory();
      const populated = new Set(counts.map((row) => row.categoryId));
      expect(populated.has('generic_asset')).toBe(false);
      expect(populated.has('security_platform')).toBe(false);
      expect(populated.size).toBe(Object.keys(APPLICABLE_TECHNIQUES).length - 2);
    });

    it('carries no row for the unclassified bucket', async () => {
      const surfaceId = deriveAttackSurfaceId(tenantId, 'generic_asset');
      const rows = await db.select().from(attackSurfaceMitreTechniques)
        .where(eq(attackSurfaceMitreTechniques.attackSurfaceId, surfaceId));
      expect(rows).toEqual([]);
    });
  });

  describe('the resolver', () => {
    it('answers the techniques a family carries, sub-cases included', async () => {
      const techniques = await services.withOrigin(adminOrigin).attackSurfaces.getApplicableTechniques('identity');
      expect(techniques.length).toBe(APPLICABLE_TECHNIQUES.identity.length);
      expect(techniques.some((technique) => technique.isSubtechnique)).toBe(true);
    });

    it('lets an edge on a top-level technique reach a family through its branch', async () => {
      // Masquerading does not reach the identity system; its Masquerade Account Name sub-case does.
      const resolver = services.withOrigin(adminOrigin).attackSurfaces;
      const parentOnly = categoriesOf(await resolver.getApplicablePairsForTechniques([techniqueId('T1036')]));
      const subCase = categoriesOf(await resolver.getApplicablePairsForTechniques([techniqueId('T1036.010')]));

      expect(APPLICABLE_TECHNIQUES.identity).not.toContain('T1036');
      expect(subCase).toContain('identity');
      expect(parentOnly).toContain('identity');
    });

    it('answers on the technique that was asked about, not on the sub-case that reached the family', async () => {
      const pairs = await services.withOrigin(adminOrigin).attackSurfaces.getApplicablePairsForTechniques([techniqueId('T1021')]);
      expect(new Set(pairs.map((pair) => pair.mitreTechniqueId))).toEqual(new Set([techniqueId('T1021')]));
    });

    it('gives a technique the same families whether or not its sub-case was asked about too', async () => {
      const resolver = services.withOrigin(adminOrigin).attackSurfaces;
      const parent = techniqueId('T1036');

      const alone = categoriesOf(await resolver.getApplicablePairsForTechniques([parent]));
      const alongside = (await resolver.getApplicablePairsForTechniques([parent, techniqueId('T1036.010')]))
        .filter((pair) => pair.mitreTechniqueId === parent)
        .map((pair) => pair.categoryId);

      expect(new Set(alongside)).toEqual(new Set(alone));
    });

    it('leaves the unclassified bucket out unless a caller asks for it', async () => {
      const resolver = services.withOrigin(adminOrigin).attackSurfaces;
      const ids = [techniqueId('T1190')];

      expect(categoriesOf(await resolver.getApplicablePairsForTechniques(ids))).not.toContain('generic_asset');
      expect(categoriesOf(await resolver.getApplicablePairsForTechniques(ids, { includeUnclassified: true }))).toContain('generic_asset');
      expect(await resolver.getApplicableTechniques('generic_asset')).toEqual([]);
    });

    it('answers every technique for the unclassified bucket, from the rule rather than from rows', async () => {
      const techniques = await services.withOrigin(adminOrigin).attackSurfaces
        .getApplicableTechniques('generic_asset', { includeUnclassified: true });
      const live = mitreTechniquesData.filter((technique) => !technique.revoked);
      expect(techniques.length).toBe(live.length);
    });

    it('counts the techniques of every family that carries any', async () => {
      const counts = await services.withOrigin(adminOrigin).attackSurfaces.getApplicableTechniqueCountPerCategory();
      const byCategory = new Map(counts.map((row) => [row.categoryId, row.techniqueCount]));
      expect(byCategory.get('host')).toBe(APPLICABLE_TECHNIQUES.host.length);
      expect(byCategory.get('web_application')).toBe(APPLICABLE_TECHNIQUES.web_application.length);
      expect(byCategory.has('generic_asset')).toBe(false);
    });
  });

  describe('no write path', () => {
    it('exposes no mutation on the resolver', () => {
      const resolver = services.withOrigin(adminOrigin).attackSurfaces as Record<string, unknown>;
      const mutating = Object.keys(resolver).filter((name) => /^(create|update|delete|upsert|set|declare|save)/.test(name));
      expect(mutating).toEqual([]);
    });

    it('holds no table a tenant could store a declared applicability in', async () => {
      const result = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'supporting_asset_category_mitre_techniques'
      `);
      expect(result.rows).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('does not read another tenant\'s rows', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      const ownSurfaceIds = new Set((await services.withOrigin(adminOrigin).attackSurfaces.getAttackSurfaces()).map((surface) => surface.id));
      const otherSurfaceIds = new Set((await services.withOrigin(otherOrigin).attackSurfaces.getAttackSurfaces()).map((surface) => surface.id));

      expect([...ownSurfaceIds].some((id) => otherSurfaceIds.has(id))).toBe(false);
      expect(deriveAttackSurfaceId(tenantId, 'host')).not.toBe(deriveAttackSurfaceId(otherTenantId, 'host'));
    });
  });
});
