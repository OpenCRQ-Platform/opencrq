import type { EventOrigin } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * Gives a call under test the time to reach a lock another transaction already holds. It is a
 * synchronisation and never a verdict: a caller that took no lock simply runs to completion here,
 * and what judges it is the state it leaves behind.
 */
const waitUntilHeldUp = async (): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await db.execute<{ blocked: number }>(sql`
      SELECT count(*)::int AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
    `);
    if ((rows[0]?.blocked ?? 0) > 0) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
};

describe('Treatment Plans Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;
  let capabilityId: string;
  let otherCapabilityId: string;

  const createOrganization = async (origin: EventOrigin, name: string) => {
    const id = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id, name }]);
    return id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    organizationId = await createOrganization(adminOrigin, 'Payment platform');

    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    capabilityId = capabilities[0].id;
    otherCapabilityId = capabilities[1].id;
  });

  describe('CRUD', () => {
    it('should create a plan with its name as the only required value', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Q3 hardening' });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id);
      expect(plan).toBeTruthy();
      expect(plan!.name).toBe('Q3 hardening');
      expect(plan!.moves).toHaveLength(0);
    });

    it('should default a plan without a status to draft', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Q3 hardening' });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id);
      expect(plan!.status).toBe('draft');
    });

    it('should keep every declared value of a plan', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
        organizationId,
        name: 'Identity programme',
        status: 'active',
        ownerId: adminUserId,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        rationale: 'The identity controls carry the largest modelled reduction.',
        costOneOff: 120000,
        costRecurringAnnual: 35000,
      });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id);
      expect(plan).toMatchObject({
        name: 'Identity programme',
        status: 'active',
        ownerId: adminUserId,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        rationale: 'The identity controls carry the largest modelled reduction.',
        costOneOff: 120000,
        costRecurringAnnual: 35000,
      });
    });

    it('should list the plans of the tenant', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'First' });
      await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Second' });

      const plans = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans();
      expect(plans.map((plan) => plan.name).sort()).toEqual(['First', 'Second']);
    });

    it('should update a plan', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Draft plan' });

      await services.withOrigin(adminOrigin).treatmentPlans.updateTreatmentPlan(id, {
        name: 'Approved plan',
        status: 'active',
        endDate: '2026-12-31',
      });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id);
      expect(plan).toMatchObject({ name: 'Approved plan', status: 'active', endDate: '2026-12-31' });
    });

    it('should delete a plan', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Abandoned' });

      await services.withOrigin(adminOrigin).treatmentPlans.deleteTreatmentPlans([id]);

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id)).toBeUndefined();
    });

    it('should return undefined for a plan that does not exist', async () => {
      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(uuidv7())).toBeUndefined();
    });
  });

  describe('cost and return', () => {
    it('should sum the two costs into the first-year cost, and leave the return undefined until a run prices the plan', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
        organizationId, name: 'Priced plan', costOneOff: 120_000, costRecurringAnnual: 36_000,
      });

      const [row] = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans(organizationId);
      const projection = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanProjection(id);

      expect(row).toMatchObject({ costYear1: 156_000, returnPercent: null, totalAleReduction: null });
      expect(projection).toMatchObject({ costYear1: 156_000, returnPercent: null, totalAleReduction: null });
    });

    it('should carry no first-year cost for a plan whose cost was never entered', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Unpriced plan' });

      const [row] = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans(organizationId);

      expect(row).toMatchObject({ costYear1: null, returnPercent: null });
    });

    it('should edit each cost field on its own', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
        organizationId, name: 'Two fields', costOneOff: 120_000, costRecurringAnnual: 36_000,
      });

      await services.withOrigin(adminOrigin).treatmentPlans.updateTreatmentPlan(id, { costRecurringAnnual: null });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id);
      const [row] = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans(organizationId);
      expect(plan).toMatchObject({ costOneOff: 120_000, costRecurringAnnual: null });
      expect(row.costYear1).toBe(120_000);
    });
  });

  describe('moves', () => {
    let planId: string;

    beforeEach(async () => {
      planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Plan with moves' });
    });

    const movesOf = async () => await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);

    it('should add a move with a target strength alone', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null }]);

      expect((await movesOf())[0]).toMatchObject({ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null });
    });

    it('should add a move with a target coverage alone', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' }]);

      expect((await movesOf())[0]).toMatchObject({ capabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' });
    });

    it('should add a move with both targets', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }]);

      expect((await movesOf())[0]).toMatchObject({ capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: 'L3' });
    });

    it('should refuse a move that sets no target', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: null, targetCoverageBucket: null }]),
      ).rejects.toThrow('A treatment plan move must set a target strength or coverage');

      expect(await movesOf()).toHaveLength(0);
    });

    it('should hold at most one move per capability, on the row it already had', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L1', targetCoverageBucket: null }]);
      const [first] = await movesOf();
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: 'L3' }]);

      const moves = await movesOf();
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ id: first.id, targetStrengthRung: 'L3', targetCoverageBucket: 'L3' });
    });

    it('should hold one move per capability across capabilities', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [
        { capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null },
        { capabilityId: otherCapabilityId, targetStrengthRung: null, targetCoverageBucket: 'L1' },
      ]);

      expect(await movesOf()).toHaveLength(2);
    });

    it('should read a plan with its moves', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' }]);

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);
      expect(plan!.moves).toHaveLength(1);
      expect(plan!.moves[0]).toMatchObject({ capabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' });
    });

    /*
     * Anything that prices a plan prices one set of moves, and records which one. Changing the set
     * has to make those figures identifiable as stale.
     */
    it('should bump the scope version on every change to the set of moves', async () => {
      const versionOf = async (): Promise<number> =>
        (await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId))!.scopeVersion;
      expect(await versionOf()).toBe(1);

      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null }]);
      expect(await versionOf()).toBe(2);

      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null }]);
      expect(await versionOf()).toBe(3);

      await services.withOrigin(adminOrigin).treatmentPlans.setTreatmentPlanScope(planId, []);
      expect(await versionOf()).toBe(4);
    });

    /* Editing the rest of the plan changes no target, so nothing priced against it went stale. */
    it('should leave the scope version alone when the plan itself is edited', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null }]);
      await services.withOrigin(adminOrigin).treatmentPlans.updateTreatmentPlan(planId, { name: 'Renamed', costOneOff: 1000 });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);
      expect(plan!.name).toBe('Renamed');
      expect(plan!.scopeVersion).toBe(2);
    });
  });

  describe('cascade deletes', () => {
    it('should delete the moves of a deleted plan', async () => {
      const planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Doomed' });
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null }]);

      await services.withOrigin(adminOrigin).treatmentPlans.deleteTreatmentPlans([planId]);

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId)).toHaveLength(0);
    });

    it('should keep a plan and clear its owner when that user is deleted', async () => {
      const owner = await createTenantUser(services, db, adminOrigin);
      const planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
        organizationId,
        name: 'Owned',
        ownerId: owner.userId,
      });

      await services.withOrigin(adminOrigin).tenants.removeTenantUser(tenantId, owner.userId);
      await services.withOrigin({ type: 'auth' }).users.deleteUser(owner.userId);

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);
      expect(plan?.ownerId).toBeNull();
    });
  });

  describe('risk scope', () => {
    it('should list only the plans of the named risk scope', async () => {
      const otherScopeId = await createOrganization(adminOrigin, 'Industrial systems');
      await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Payment plan' });
      await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId: otherScopeId, name: 'Industrial plan' });

      const inScope = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans(organizationId);
      expect(inScope.map((plan) => plan.name)).toEqual(['Payment plan']);

      const everywhere = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans();
      expect(everywhere.map((plan) => plan.name).sort()).toEqual(['Industrial plan', 'Payment plan']);
    });

    it('should name the risk scope a plan belongs to', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Scoped' });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id);
      expect(plan).toMatchObject({ organizationId, organization: { id: organizationId, name: 'Payment platform' } });
    });

    it('should resolve the name of the owner a plan names', async () => {
      const id = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
        organizationId,
        name: 'Owned',
        ownerId: adminUserId,
      });

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(id);
      expect(plan!.owner).toMatchObject({ id: adminUserId });
    });
  });

  describe('setTreatmentPlanScope', () => {
    let planId: string;

    beforeEach(async () => {
      planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Reconciled' });
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null }]);
    });

    it('should add one control and remove another in the same save', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.setTreatmentPlanScope(planId, [
        { capabilityId: otherCapabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null },
      ]);

      const moves = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ capabilityId: otherCapabilityId, targetStrengthRung: 'L3' });
    });

    it('should expire the projection by bumping the scope version', async () => {
      const before = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);

      await services.withOrigin(adminOrigin).treatmentPlans.setTreatmentPlanScope(planId, [
        { capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null },
      ]);

      const after = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);
      expect(after!.scopeVersion).toBeGreaterThan(before!.scopeVersion);
    });

    it('should empty the plan when every control is unchecked', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.setTreatmentPlanScope(planId, []);

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId)).toHaveLength(0);
    });

    /**
     * The held transaction stands for a second save already under way: it holds the plan's row and
     * adds a control the save below never saw. A save reading the moves without the plan's lock
     * drops only what its own read carried, so that control survives its replacement and the plan
     * ends on the union of the two sets rather than on either one.
     */
    it('should land on the submitted set alone when another save of the same plan is in flight', async () => {
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const concurrentCapabilityId = capabilities[2].id;
      let commitHolder = (): void => {};
      const held = new Promise<void>((resolve) => {
        commitHolder = resolve;
      });
      let signalLocked = (): void => {};
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });

      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM treatment_plans WHERE id = ${planId} FOR UPDATE`);
        signalLocked();
        await held;
        await tx.execute(sql`
          INSERT INTO treatment_plan_moves (id, plan_id, capability_id, target_strength_rung)
          VALUES (${uuidv7()}, ${planId}, ${concurrentCapabilityId}, 'L1')
        `);
      });
      // Started before the holder owns the row, the save can take the lock first and commit before the holder's insert.
      await locked;

      const save = services.withOrigin(adminOrigin).treatmentPlans.setTreatmentPlanScope(planId, [
        { capabilityId: otherCapabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null },
      ]);
      await waitUntilHeldUp();
      commitHolder();
      await Promise.all([save, holder]);

      const moves = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
      expect(moves.map((move) => move.capabilityId)).toEqual([otherCapabilityId]);
    });

    it('should refuse a move that raises neither axis', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.setTreatmentPlanScope(planId, [
          { capabilityId, targetStrengthRung: null, targetCoverageBucket: null },
        ]),
      ).rejects.toThrow();

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId)).toHaveLength(1);
    });

    it('should refuse two moves for one capability', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.setTreatmentPlanScope(planId, [
          { capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null },
          { capabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' },
        ]),
      ).rejects.toThrow();

      const moves = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ targetStrengthRung: 'L2', targetCoverageBucket: null });
    });
  });

  describe('create with moves', () => {
    it('should create a plan holding the moves it was created with', async () => {
      const planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
        organizationId,
        name: 'From a scenario',
        moves: [
          { capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null },
          { capabilityId: otherCapabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' },
        ],
      });

      const moves = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
      expect(moves).toHaveLength(2);
      expect(moves.find((move) => move.capabilityId === capabilityId)).toMatchObject({ targetStrengthRung: 'L2', targetCoverageBucket: null });
      expect(moves.find((move) => move.capabilityId === otherCapabilityId)).toMatchObject({ targetStrengthRung: null, targetCoverageBucket: 'L2' });
    });

    it('should create no plan when one of its moves raises neither axis', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
          organizationId,
          name: 'Half written',
          moves: [{ capabilityId, targetStrengthRung: null, targetCoverageBucket: null }],
        }),
      ).rejects.toThrow();

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans()).toHaveLength(0);
    });

    it('should create no plan when one of its moves fails to save', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
          organizationId,
          name: 'Half written',
          moves: [
            { capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null },
            { capabilityId: uuidv7(), targetStrengthRung: 'L2', targetCoverageBucket: null },
          ],
        }),
      ).rejects.toThrow();

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans()).toHaveLength(0);
    });

    it('should refuse two moves for one capability and create no plan', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({
          organizationId,
          name: 'Split control',
          moves: [
            { capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null },
            { capabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' },
          ],
        }),
      ).rejects.toThrow();

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans()).toHaveLength(0);
    });
  });

  describe('addTreatmentPlanMoves', () => {
    let planId: string;

    beforeEach(async () => {
      planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Merged' });
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: 'L2' }]);
    });

    const moveOf = async (id: string) => {
      const moves = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
      return moves.find((move) => move.capabilityId === id);
    };

    it('should add a control the plan does not hold, leaving the others as they were', async () => {
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [
        { capabilityId: otherCapabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null },
      ]);

      expect(await moveOf(otherCapabilityId)).toMatchObject({ targetStrengthRung: 'L3', targetCoverageBucket: null });
      expect(await moveOf(capabilityId)).toMatchObject({ targetStrengthRung: 'L2', targetCoverageBucket: 'L2' });
    });

    it('should keep the target on file for the axis a new move leaves unset', async () => {
      const before = await moveOf(capabilityId);

      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [
        { capabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null },
      ]);

      const moves = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ id: before!.id, targetStrengthRung: 'L3', targetCoverageBucket: 'L2' });
    });

    it('should expire the projection by bumping the scope version', async () => {
      const before = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);

      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [
        { capabilityId: otherCapabilityId, targetStrengthRung: 'L1', targetCoverageBucket: null },
      ]);

      const after = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);
      expect(after!.scopeVersion).toBeGreaterThan(before!.scopeVersion);
    });

    it('should refuse a move that raises neither axis and add nothing', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [
          { capabilityId: otherCapabilityId, targetStrengthRung: 'L1', targetCoverageBucket: null },
          { capabilityId, targetStrengthRung: null, targetCoverageBucket: null },
        ]),
      ).rejects.toThrow();

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId)).toHaveLength(1);
    });

    it('should add nothing and keep the scope version when one of the moves fails to save', async () => {
      const before = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);

      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [
          { capabilityId: otherCapabilityId, targetStrengthRung: 'L1', targetCoverageBucket: null },
          { capabilityId: uuidv7(), targetStrengthRung: 'L1', targetCoverageBucket: null },
        ]),
      ).rejects.toThrow();

      const after = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);
      expect(after!.moves).toHaveLength(1);
      expect(after!.scopeVersion).toBe(before!.scopeVersion);
    });

    it('should refuse two moves for one capability and add nothing', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [
          { capabilityId: otherCapabilityId, targetStrengthRung: 'L1', targetCoverageBucket: null },
          { capabilityId: otherCapabilityId, targetStrengthRung: null, targetCoverageBucket: 'L2' },
        ]),
      ).rejects.toThrow();

      expect(await moveOf(otherCapabilityId)).toBeUndefined();
    });

    it('should refuse a plan that does not exist', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(uuidv7(), [
          { capabilityId, targetStrengthRung: 'L1', targetCoverageBucket: null },
        ]),
      ).rejects.toThrow();
    });
  });

  describe('candidate controls', () => {
    let planId: string;

    beforeEach(async () => {
      planId = await services.withOrigin(adminOrigin)
        .treatmentPlans.createTreatmentPlan({ organizationId, name: 'Scope posture' });
    });

    const candidateOf = async (id: string) => {
      const candidates = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanCandidates(planId);
      return candidates!.find((candidate) => candidate.capabilityId === id);
    };

    // The run prices a move against the scope's rung and a target is a commitment rather than a
    // floor, so a picker built on the tenant's rung would offer as a gain what the engine books as
    // a downgrade.
    it('should read a control at the posture its scope declares rather than the tenant one', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(capabilityId, 'L1', 'L1', null);
      await services.withOrigin(adminOrigin).controlCapabilities.declareScopePosture(organizationId, capabilityId, {
        strengthRung: 'L3', coverageBucket: 'L2', comment: null,
      });

      expect(await candidateOf(capabilityId)).toMatchObject({ currentStrengthRung: 'L3', currentCoverageBucket: 'L2' });
    });

    it('should follow the tenant on the axis the scope leaves inherited', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(capabilityId, 'L2', 'L3', null);
      await services.withOrigin(adminOrigin).controlCapabilities.declareScopePosture(organizationId, capabilityId, {
        strengthRung: null, coverageBucket: 'L0', comment: null,
      });

      expect(await candidateOf(capabilityId)).toMatchObject({ currentStrengthRung: 'L2', currentCoverageBucket: 'L0' });
    });

    it('should read a control neither level declares as deployed nowhere', async () => {
      expect(await candidateOf(otherCapabilityId)).toMatchObject({
        currentStrengthRung: 'L0',
        currentCoverageBucket: 'L0',
      });
    });
  });

  describe('scope candidate controls', () => {
    it('should read a control at the posture its scope declares, with no target', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.declareScopePosture(organizationId, capabilityId, {
        strengthRung: 'L2', coverageBucket: 'L1', comment: null,
      });

      const candidates = await services.withOrigin(adminOrigin).treatmentPlans.getScopeTreatmentPlanCandidates(organizationId);

      expect(candidates!.find((candidate) => candidate.capabilityId === capabilityId)).toMatchObject({
        currentStrengthRung: 'L2',
        currentCoverageBucket: 'L1',
        targetStrengthRung: null,
        targetCoverageBucket: null,
        inPlan: false,
      });
    });

    it('should read nothing for a scope that does not exist', async () => {
      expect(await services.withOrigin(adminOrigin).treatmentPlans.getScopeTreatmentPlanCandidates(uuidv7())).toBeUndefined();
    });
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;
    let planId: string;
    let moveId: string;

    beforeEach(async () => {
      const tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      planId = await services.withOrigin(adminOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Tenant A plan' });
      await services.withOrigin(adminOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L2', targetCoverageBucket: null }]);
      [{ id: moveId }] = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
    });

    it('should not list the plans of another tenant', async () => {
      expect(await services.withOrigin(tenantBOrigin).treatmentPlans.getTreatmentPlans()).toHaveLength(0);
    });

    it('should not read a plan of another tenant by id', async () => {
      expect(await services.withOrigin(tenantBOrigin).treatmentPlans.getTreatmentPlan(planId)).toBeUndefined();
    });

    it('should not read the moves of another tenant', async () => {
      expect(await services.withOrigin(tenantBOrigin).treatmentPlans.getTreatmentPlanMoves(planId)).toHaveLength(0);
    });

    // A policy-filtered update is a zero-row statement that returns normally, so the service reads
    // the plan first rather than answering "updated successfully" after changing nothing.
    it('should refuse an update naming a plan of another tenant', async () => {
      await expect(
        services.withOrigin(tenantBOrigin).treatmentPlans.updateTreatmentPlan(planId, { name: 'Stolen' }),
      ).rejects.toThrow();

      const plan = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId);
      expect(plan!.name).toBe('Tenant A plan');
    });

    it('should refuse an update naming a plan that does not exist', async () => {
      await expect(
        services.withOrigin(adminOrigin).treatmentPlans.updateTreatmentPlan(uuidv7(), { name: 'Ghost' }),
      ).rejects.toThrow();
    });

    it('should not read the projection of a plan of another tenant', async () => {
      expect(await services.withOrigin(tenantBOrigin).treatmentPlans.getTreatmentPlanProjection(planId)).toBeUndefined();
    });

    it('should not read the candidate controls of a plan of another tenant', async () => {
      expect(await services.withOrigin(tenantBOrigin).treatmentPlans.getTreatmentPlanCandidates(planId)).toBeUndefined();
    });

    it('should not read the candidate controls of a risk scope of another tenant', async () => {
      expect(await services.withOrigin(tenantBOrigin).treatmentPlans.getScopeTreatmentPlanCandidates(organizationId)).toBeUndefined();
    });

    it('should not create a plan in a risk scope of another tenant', async () => {
      await expect(
        services.withOrigin(tenantBOrigin).treatmentPlans.createTreatmentPlan({ organizationId, name: 'Trespassing' }),
      ).rejects.toThrow();

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlans()).toHaveLength(1);
    });

    it('should not delete a plan of another tenant', async () => {
      await services.withOrigin(tenantBOrigin).treatmentPlans.deleteTreatmentPlans([planId]);

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlan(planId)).toBeTruthy();
    });

    it('should not add a move to a plan of another tenant', async () => {
      await expect(
        services.withOrigin(tenantBOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId: otherCapabilityId, targetStrengthRung: 'L3', targetCoverageBucket: null }]),
      ).rejects.toThrow();

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId)).toHaveLength(1);
    });

    it('should not overwrite a move of another tenant', async () => {
      await expect(
        services.withOrigin(tenantBOrigin).treatmentPlans.addTreatmentPlanMoves(planId, [{ capabilityId, targetStrengthRung: 'L0', targetCoverageBucket: null }]),
      ).rejects.toThrow();

      const moves = await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId);
      expect(moves[0]).toMatchObject({ id: moveId, targetStrengthRung: 'L2' });
    });

    it('should not empty the moves of a plan of another tenant', async () => {
      await services.withOrigin(tenantBOrigin).treatmentPlans.setTreatmentPlanScope(planId, []);

      expect(await services.withOrigin(adminOrigin).treatmentPlans.getTreatmentPlanMoves(planId)).toHaveLength(1);
    });
  });
});
