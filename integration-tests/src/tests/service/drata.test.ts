import type { DrataMirrorInput, EventOrigin } from '@app/module';
import { drataControls, drataFrameworks, drataRequirementControls, drataRequirements } from '@app/module';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { expectReplayedSyncSilent } from '../../helpers/replayed-sync';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const mirrorInput = (overrides: Partial<DrataMirrorInput> = {}): DrataMirrorInput => ({
  syncedAt: new Date('2026-08-25T10:00:00Z'),
  controls: [
    { drataId: 100, code: 'DCF-1001', name: 'MFA enforced', description: null, isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: false, archivedAt: null },
    { drataId: 101, code: 'DCF-1002', name: 'Backups tested', description: null, isReady: false, isMonitored: false, hasEvidence: false, hasPolicy: false, archivedAt: null },
  ],
  frameworks: [
    {
      drataId: 1,
      slug: 'iso2022',
      tag: 'ISO270012022',
      name: 'ISO 27001:2022',
      description: null,
      isReady: false,
      numInScopeRequirements: 2,
      numReadyInScopeRequirements: 1,
      numInScopeControls: 2,
      requirements: [
        { drataId: 10, code: 'A.5.1', name: 'Requirement one', description: null, category: 'Organizational', isInScope: true, isReady: true, controlDrataIds: [100] },
        { drataId: 11, code: 'A.8.12', name: 'Requirement two', description: null, category: 'Technological', isInScope: true, isReady: false, controlDrataIds: [100, 101] },
      ],
    },
  ],
  ...overrides,
});

/** The tables a `data_changed` notification named while `write` ran. */
const tablesRungBy = async (write: () => Promise<unknown>): Promise<Array<string>> => {
  const tables = new Set<string>();
  const client = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
  await client.connect();
  try {
    client.on('notification', (message) => {
      const parsed: unknown = message.payload ? JSON.parse(message.payload) : null;
      if (typeof parsed === 'object' && parsed !== null && 'table' in parsed && typeof parsed.table === 'string') {
        tables.add(parsed.table);
      }
    });
    await client.query('LISTEN data_changed');
    await write();
    await new Promise((resolve) => setTimeout(resolve, 400));
  } finally {
    await client.end();
  }
  return [...tables].sort();
};

describe('Drata mirror service', () => {
  let adminOrigin: EventOrigin;
  let connectorOrigin: EventOrigin;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Test Drata Bot',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('drata', serviceAccountId);

    connectorOrigin = { type: 'connector', serviceAccountId, tenantId: setup.tenantId };
  });

  describe('replaceMirror', () => {
    it('materializes frameworks with their requirements', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());

      const frameworks = await services.withOrigin(adminOrigin).drata.getFrameworks();
      expect(frameworks).toHaveLength(1);
      expect(frameworks[0]).toMatchObject({
        drataId: 1,
        tag: 'ISO270012022',
        name: 'ISO 27001:2022',
        numInScopeRequirements: 2,
        numReadyInScopeRequirements: 1,
      });

      const requirements = await services.withOrigin(adminOrigin).drata.getRequirements(frameworks[0].id);
      expect(requirements).toHaveLength(2);
      expect(requirements.map((r) => r.code)).toEqual(['A.5.1', 'A.8.12']);
      expect(requirements[0].isReady).toBe(true);
      expect(requirements[1].isReady).toBe(false);
    });

    it('selects only the columns each Drata list and the requirement drawer render', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
      const [framework] = await services.withOrigin(adminOrigin).drata.getFrameworks();

      const requirements = await services.withOrigin(adminOrigin).drata.getRequirements(framework.id);
      expect(Object.keys(requirements[0]).sort()).toEqual(
        ['category', 'code', 'controlCount', 'id', 'isInScope', 'isReady', 'name'],
      );

      const controls = await services.withOrigin(adminOrigin).drata.getControlsForFramework(framework.id);
      expect(Object.keys(controls[0]).sort()).toEqual(
        ['archivedAt', 'code', 'hasEvidence', 'hasPolicy', 'id', 'isMonitored', 'isReady', 'name', 'requirementCount'],
      );

      const requirementControls = await services.withOrigin(adminOrigin).drata.getControlsForRequirement(requirements[0].id);
      expect(Object.keys(requirementControls[0]).sort()).toEqual(
        ['archivedAt', 'code', 'hasEvidence', 'hasPolicy', 'id', 'isMonitored', 'isReady', 'name'],
      );
    });

    it('materializes controls and requirement-control links', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());

      const controls = await db.select().from(drataControls);
      expect(controls).toHaveLength(2);
      expect(controls.find((c) => c.drataId === 100)).toMatchObject({ code: 'DCF-1001', isReady: true, isMonitored: true });

      const links = await db.select().from(drataRequirementControls);
      expect(links).toHaveLength(3);
    });

    it('is idempotent — re-running the same mirror keeps row identity and counts', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
      const before = await services.withOrigin(adminOrigin).drata.getFrameworks();

      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
      const after = await services.withOrigin(adminOrigin).drata.getFrameworks();

      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(before[0].id);
      expect(await db.select().from(drataRequirements)).toHaveLength(2);
      expect(await db.select().from(drataRequirementControls)).toHaveLength(3);
    });

    it('applies readiness changes on re-sync', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());

      const updated = mirrorInput();
      updated.frameworks[0].isReady = true;
      updated.frameworks[0].numReadyInScopeRequirements = 2;
      updated.frameworks[0].requirements[1].isReady = true;
      updated.controls[1].isReady = true;
      await services.withOrigin(connectorOrigin).drata.replaceMirror(updated);

      const frameworks = await services.withOrigin(adminOrigin).drata.getFrameworks();
      expect(frameworks[0]).toMatchObject({ isReady: true, numReadyInScopeRequirements: 2 });
      const requirements = await services.withOrigin(adminOrigin).drata.getRequirements(frameworks[0].id);
      expect(requirements.every((r) => r.isReady)).toBe(true);
      const controls = await db.select().from(drataControls);
      expect(controls.every((c) => c.isReady)).toBe(true);
    });

    it('removes rows that disappeared from the mirror, links included', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());

      const shrunk = mirrorInput();
      shrunk.frameworks[0].requirements = shrunk.frameworks[0].requirements.slice(0, 1);
      shrunk.controls = shrunk.controls.slice(0, 1);
      await services.withOrigin(connectorOrigin).drata.replaceMirror(shrunk);

      expect(await db.select().from(drataRequirements)).toHaveLength(1);
      expect(await db.select().from(drataControls)).toHaveLength(1);
      const links = await db.select().from(drataRequirementControls);
      expect(links).toHaveLength(1);
    });

    describe('a mirror synced again', () => {
      it('should ring nothing and move no updated_at when it reports the same data', async () => {
        await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());

        await expectReplayedSyncSilent(() => services.withOrigin(connectorOrigin).drata.replaceMirror(
          mirrorInput({ syncedAt: new Date('2026-08-26T10:00:00Z') }),
        ));

        const [framework] = await db.select().from(drataFrameworks);
        expect(framework.lastReportedAt).toEqual(new Date('2026-08-26T10:00:00Z'));
      });

      it('should ring and move updated_at only where a control changed or a link was removed', async () => {
        await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
        const before = {
          frameworks: await db.select().from(drataFrameworks),
          requirements: await db.select().from(drataRequirements),
          controls: await db.select().from(drataControls),
          links: await db.select().from(drataRequirementControls),
        };

        const changed = mirrorInput({ syncedAt: new Date('2026-08-26T10:00:00Z') });
        changed.controls[0].name = 'MFA enforced everywhere';
        changed.frameworks[0].requirements[1].controlDrataIds = [101];
        const rung = await tablesRungBy(() => services.withOrigin(connectorOrigin).drata.replaceMirror(changed));

        expect(rung).toEqual(['drata_controls', 'drata_requirement_controls']);
        const movedBy = <R extends { id: string, updatedAt: Date }>(rows: Array<R>, after: Array<R>) =>
          after.filter((row) => row.updatedAt.getTime() !== rows.find((held) => held.id === row.id)?.updatedAt.getTime()).map((row) => row.id);
        expect(movedBy(before.frameworks, await db.select().from(drataFrameworks))).toEqual([]);
        expect(movedBy(before.requirements, await db.select().from(drataRequirements))).toEqual([]);
        const controlsAfter = await db.select().from(drataControls);
        expect(movedBy(before.controls, controlsAfter)).toEqual([controlsAfter.find((c) => c.drataId === 100)!.id]);

        const links = await db.select().from(drataRequirementControls);
        const requirementId = before.requirements.find((r) => r.drataId === 11)!.id;
        const removedControlId = before.controls.find((c) => c.drataId === 100)!.id;
        expect(links).toHaveLength(2);
        expect(links.some((l) => l.requirementId === requirementId && l.controlId === removedControlId)).toBe(false);
      });
    });

    it('removes a framework and cascades its requirements', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput({ frameworks: [] }));

      const frameworks = await services.withOrigin(adminOrigin).drata.getFrameworks();
      expect(frameworks).toHaveLength(0);
      expect(await db.select().from(drataRequirements)).toHaveLength(0);
      expect(await db.select().from(drataRequirementControls)).toHaveLength(0);
    });
  });

  describe('origin restrictions', () => {
    it('rejects a mirror write from a client origin', async () => {
      await expect(services.withOrigin(adminOrigin).drata.replaceMirror(mirrorInput()))
        .rejects.toThrow('Connector origin required');
    });

    it('rejects reads without tenant context', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
      const [framework] = await services.withOrigin(adminOrigin).drata.getFrameworks();

      const noTenantOrigin: EventOrigin = { type: 'platform', userId: adminUserId };
      await expect(services.withOrigin(noTenantOrigin).drata.getFramework(framework.id))
        .rejects.toThrow('Tenant context required');
      await expect(services.withOrigin(noTenantOrigin).drata.getRequirements(framework.id))
        .rejects.toThrow('Tenant context required');
    });
  });

  describe('tenant isolation', () => {
    it('does not expose the mirror to another tenant', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const frameworks = await services.withOrigin(tenantBOrigin).drata.getFrameworks();
      expect(frameworks).toHaveLength(0);
    });

    it('scopes framework detail reads to the owning tenant', async () => {
      await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
      const [framework] = await services.withOrigin(adminOrigin).drata.getFrameworks();

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const fromB = await services.withOrigin(tenantBOrigin).drata.getFramework(framework.id);
      expect(fromB).toBeNull();
      const requirementsFromB = await services.withOrigin(tenantBOrigin).drata.getRequirements(framework.id);
      expect(requirementsFromB).toHaveLength(0);
    });
  });
});
