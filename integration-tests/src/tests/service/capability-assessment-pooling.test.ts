import type { DrataControlMirrorInput, EventOrigin, MaturityLevel } from '@app/module';
import {
  BUNDLED_CATALOGS,
  BUNDLED_CONTROL_LINKS,
  complianceRequirementControls,
  controlCapabilityAssessmentEvents,
  controlCapabilityAssessmentEventSources,
  controlCapabilityAssessments,
  controlCapabilityAssessmentSources,
  tenants,
} from '@app/module';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const [nistCsf] = BUNDLED_CATALOGS;
const frameworkId = nistCsf.framework.id;
const blankAnswer = { ownerId: null, dueDate: null, level: null, notApplicable: false, comment: null, updatedAt: null };

type Answer = MaturityLevel | 'na' | 'blank';

// EDR's evidence includes DCF-50 and DCF-291 (both org-wide) and DCF-293 and DCF-294, codes that
// evidence no other control and attest L1, the most EDR's Drata evidence reaches. Three of the four
// ready read L1 at that ceiling, with a broad coverage the org-wide pairs measure.
const EDR_DRATA_L1_BROAD = { 'DCF-50': true, 'DCF-291': true, 'DCF-293': true, 'DCF-294': false };

const mirrorControl = (code: string, isReady: boolean): DrataControlMirrorInput => ({
  drataId: Number(code.slice(4)),
  code,
  name: `${code} name`,
  description: null,
  isReady,
  isMonitored: isReady,
  hasEvidence: isReady,
  hasPolicy: isReady,
  archivedAt: null,
});

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

describe('Published assessments feeding the controls', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let jobOrigin: EventOrigin;
  let tenantId: string;
  let edrId: string;
  let edrRequirements: Array<string>;

  const admin = () => services.withOrigin(adminOrigin);

  const publish = async (
    levels: ReadonlyArray<Answer>,
    requirementIds: ReadonlyArray<string> = edrRequirements,
    name = `Assessment ${uuidv7()}`,
  ) => {
    const id = await admin().complianceAssessments.createAssessment({ name, frameworkId });
    for (const [index, level] of levels.entries()) {
      await admin().complianceAssessments.answerRequirement({
        ...blankAnswer,
        assessmentId: id,
        requirementId: requirementIds[index],
        level: typeof level === 'number' ? level : null,
        notApplicable: level === 'na',
      });
    }
    await admin().complianceAssessments.publishAssessment(id);
    return id;
  };

  const mirror = async (readyByCode: Record<string, boolean>) => {
    const serviceAccountId = uuidv7();
    await admin().serviceAccounts.createServiceAccount({ id: serviceAccountId, name: `Drata ${serviceAccountId}` });
    await admin().integrationSettings.configureIntegration('drata', serviceAccountId);
    await services.withOrigin({ type: 'connector', serviceAccountId, tenantId }).drata.replaceMirror({
      syncedAt: new Date(),
      frameworks: [],
      controls: Object.entries(readyByCode).map(([code, isReady]) => mirrorControl(code, isReady)),
    });
  };

  const derive = () => services.withOrigin(jobOrigin).controlCapabilities.rederiveAssessments();

  const edr = async () => (await admin().controlCapabilities.getControlCapability(edrId))!;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    jobOrigin = { type: 'job', tenantId, jobKind: 'capability-derivation', interactive: false };
    const capabilities = await admin().controlCapabilities.getControlCapabilities();
    edrId = capabilities.find((capability) => capability.externalId === 'EDR')!.id;
    edrRequirements = (BUNDLED_CONTROL_LINKS.get(frameworkId) ?? [])
      .filter((link) => link.capabilityId === edrId)
      .map((link) => link.requirementId)
      .sort();
  });

  it('should reach EDR through seven capability-typed requirements', () => {
    expect(edrRequirements).toHaveLength(7);
  });

  describe('strength', () => {
    it('should pool Drata and the answers on the worked EDR case, at L2, naming both sources', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      // Drata at its ceiling votes the answers' mean: (2 x 1 + 2 x 0.5) / 1.5 = 2
      await publish([3, 3, 3, 3]);

      await derive();

      const detail = await edr();
      expect(detail.assessment).toMatchObject({
        strengthRung: 'L2',
        strengthMode: 'auto',
        coverageBucket: 'L2',
        coverageBasis: 'measured',
      });
      expect(detail.assessmentSources).toEqual(expect.arrayContaining([
        { axis: 'strength', source: 'drata', frameworkTitle: null },
        { axis: 'strength', source: 'nist-csf-2.0', frameworkTitle: 'NIST CSF 2.0' },
        { axis: 'coverage', source: 'drata', frameworkTitle: null },
      ]));
      expect(detail.assessmentSources).toHaveLength(3);
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event).toMatchObject({ type: 'assessment_set', connector: 'derivation', userId: null });
    });

    it('should weigh a Drata reading 1 and the answers 0.5 together, however much evidence stands behind Drata', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      await publish([0, 0, 0, 0]);

      await derive();

      // (1 x 1 + 0 x 0.5) / 1.5 = 0.67
      expect((await edr()).assessment?.strengthRung).toBe('L1');
    });

    it('should rebuild the sources on the row the update kept when a later derivation moves it', async () => {
      await publish([0, 0, 0, 0]);
      await derive();
      const before = await edr();
      await mirror(EDR_DRATA_L1_BROAD);

      await derive();

      // (1 x 1 + 0 x 0.5) / 1.5 = 0.67
      const after = await edr();
      expect(after.assessment?.strengthRung).toBe('L1');
      expect(after.assessmentSources.map((source) => `${source.axis}:${source.source}`).sort())
        .toEqual(['coverage:drata', 'strength:drata', 'strength:nist-csf-2.0']);
      expect(before.assessmentSources.map((source) => source.source)).not.toContain('drata');
    });
  });

  describe('coverage', () => {
    it('should assume a coverage from the capability answers without Drata, marked as assumed', async () => {
      await publish([2, 2, 2, 2]);

      await derive();

      expect((await edr()).assessment).toMatchObject({
        strengthRung: 'L1',
        coverageBucket: 'L1',
        coverageBasis: 'assumed',
      });
      const pooled = await admin().controlCapabilities.getPooledAssessments();
      expect(pooled.find((entry) => entry.capabilityId === edrId)?.assumedFromLevel).toBe(2);
    });

    it('should take a coverage-typed answer as the coverage, no longer assumed, and keep it out of the strength', async () => {
      const coverageRequirement = edrRequirements[0];
      const link = and(
        eq(complianceRequirementControls.requirementId, coverageRequirement),
        eq(complianceRequirementControls.capabilityId, edrId),
      );
      await db.update(complianceRequirementControls).set({ axis: 'coverage' }).where(link);
      try {
        await publish([0, 3, 3, 3]);

        await derive();

        expect((await edr()).assessment).toMatchObject({ strengthRung: 'L2', coverageBucket: 'L0', coverageBasis: 'typed' });
      } finally {
        await db.update(complianceRequirementControls).set({ axis: 'capability' }).where(link);
      }
    });

    describe('fed by coverage-typed answers alone', () => {
      const typeAsCoverage = async (requirementIds: ReadonlyArray<string>, test: () => Promise<void>) => {
        const links = requirementIds.map((requirementId) => and(
          eq(complianceRequirementControls.requirementId, requirementId),
          eq(complianceRequirementControls.capabilityId, edrId),
        ));
        for (const link of links) {
          await db.update(complianceRequirementControls).set({ axis: 'coverage' }).where(link);
        }
        try {
          await test();
        } finally {
          for (const link of links) {
            await db.update(complianceRequirementControls).set({ axis: 'capability' }).where(link);
          }
        }
      };

      it('should create no row, then follow the answers once the strength is declared and the coverage re-attached in one save', () =>
        typeAsCoverage(edrRequirements, async () => {
          await publish([4, 4, 4, 4]);
          await derive();
          expect((await edr()).assessment).toBeNull();

          await admin().controlCapabilities.upsertAssessment(edrId, 'L2', null, 'Reason', ['coverage']);
          expect((await edr()).assessment).toMatchObject({ strengthRung: 'L2', strengthMode: 'manual', coverageBucket: 'L3', coverageMode: 'auto', coverageBasis: 'typed' });

          await publish([1, 1, 1, 1]);
          await derive();
          expect((await edr()).assessment).toMatchObject({ strengthRung: 'L2', strengthMode: 'manual', coverageBucket: 'L1', coverageMode: 'auto' });
        }));

      it('should re-attach the coverage of a control declared by hand, and refuse to re-attach a strength nothing feeds', () =>
        typeAsCoverage(edrRequirements, async () => {
          await admin().controlCapabilities.upsertAssessment(edrId, 'L2', 'L0', null);
          await publish([4, 4, 4, 4]);

          await admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Reason', ['coverage']);

          expect((await edr()).assessment).toMatchObject({ strengthRung: 'L2', strengthMode: 'manual', coverageBucket: 'L3', coverageMode: 'auto' });
          await expect(admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Reason', ['strength']))
            .rejects.toThrow('No source feeds this control');
        }));

      it('should clear a derived strength its capability answers stopped feeding while the coverage answers go on', () =>
        typeAsCoverage(edrRequirements.slice(0, 1), async () => {
          await publish([3, 3, 3, 3]);
          await derive();
          expect((await edr()).assessment).toMatchObject({ strengthRung: 'L2', strengthMode: 'auto', coverageBucket: 'L2', coverageBasis: 'typed' });

          await publish([4, 'na', 'na', 'na']);
          await derive();

          const detail = await edr();
          expect(detail.assessment).toMatchObject({ strengthRung: 'L0', strengthMode: 'auto', coverageBucket: 'L3', coverageMode: 'auto' });
          expect(detail.assessmentSources.map((source) => source.axis)).toEqual(['coverage']);
        }));
    });
  });

  describe('latest published answer per requirement', () => {
    it('should keep an earlier answer the later assessment left unanswered, and drop one it marked not applicable', async () => {
      await publish([4, 4, 0, 4]);
      await publish([1, 'blank', 'na']);

      const readings = (await admin().complianceAssessments.getPublishedControlReadings())
        .filter((reading) => reading.capabilityId === edrId)
        .map((reading) => reading.level)
        .sort();

      expect(readings).toEqual([1, 4, 4]);
    });

    it('should ignore a draft, and stop feeding a control once its only assessment is reopened', async () => {
      const id = await publish([3, 3, 3, 3]);
      await derive();
      expect((await edr()).assessment?.strengthRung).toBe('L2');

      await admin().complianceAssessments.reopenAssessment(id);
      await derive();

      const detail = await edr();
      expect(detail.assessment).toBeNull();
      const [cleared] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(cleared).toMatchObject({ type: 'assessment_cleared', connector: 'derivation', oldStrength: 'L2', newStrength: null });
    });
  });

  describe('a single derived axis no source feeds any more', () => {
    it('should clear a derived strength beside a declared coverage once its only assessment is reopened, and feed it again on the next publication', async () => {
      const id = await publish([3, 3, 3, 3]);
      await derive();
      await admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', 'Reason');

      await admin().complianceAssessments.reopenAssessment(id);
      await derive();

      const cleared = await edr();
      expect(cleared.assessment).toMatchObject({
        strengthRung: 'L0',
        strengthMode: 'auto',
        coverageBucket: 'L3',
        coverageMode: 'manual',
      });
      expect(cleared.assessmentSources).toEqual([]);
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event).toMatchObject({
        type: 'assessment_cleared',
        connector: 'derivation',
        oldStrength: 'L2',
        newStrength: null,
        oldCoverage: 'L3',
        newCoverage: 'L3',
      });

      await publish([4, 4, 4, 4]);
      await derive();
      expect((await edr()).assessment).toMatchObject({ strengthRung: 'L3', coverageBucket: 'L3', coverageMode: 'manual' });
    });

    it('should clear a derived coverage beside a declared strength once the later assessment marks its answers not applicable', async () => {
      await publish([2, 2, 2, 2]);
      await derive();
      await admin().controlCapabilities.upsertAssessment(edrId, 'L3', null, 'Reason');

      await publish(['na', 'na', 'na', 'na']);
      await derive();

      const cleared = await edr();
      expect(cleared.assessment).toMatchObject({
        strengthRung: 'L3',
        strengthMode: 'manual',
        coverageBucket: 'L0',
        coverageMode: 'auto',
      });
      expect(cleared.assessmentSources).toEqual([]);
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event).toMatchObject({ type: 'assessment_cleared', oldCoverage: 'L1', newCoverage: null, oldStrength: 'L3', newStrength: 'L3' });

      const outcome = await derive();
      expect(outcome).toEqual({ written: 0, cleared: 0, crossings: [] });
    });

    it('should report the axis a clearing moved, and none when the axis already sat at the floor', async () => {
      const edrCrossings = async () => (await derive()).crossings.filter((crossing) => crossing.capabilityId === edrId);
      const id = await publish([3, 3, 3, 3]);
      await derive();
      await admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', 'Reason');
      await admin().complianceAssessments.reopenAssessment(id);
      expect(await edrCrossings()).toEqual([{ capabilityId: edrId, axes: ['strength'] }]);

      const atFloor = await publish([0, 0, 0, 0]);
      await derive();
      expect((await edr()).assessment?.strengthRung).toBe('L0');
      await admin().complianceAssessments.reopenAssessment(atFloor);

      expect(await edrCrossings()).toEqual([]);
    });
  });

  describe('one mode per axis', () => {
    it('should keep a coverage declared by hand while a later publication moves the strength, then return it to the cascade', async () => {
      await publish([2, 2, 2, 2]);
      await derive();
      await admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', 'Rolled out everywhere');

      await publish([4, 4, 4, 4]);
      await derive();

      expect((await edr()).assessment).toMatchObject({
        strengthRung: 'L3',
        strengthMode: 'auto',
        coverageBucket: 'L3',
        coverageMode: 'manual',
        coverageBasis: 'declared',
      });

      await admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Reason', ['coverage']);

      expect((await edr()).assessment).toMatchObject({ coverageBucket: 'L3', coverageMode: 'auto', coverageBasis: 'assumed' });
      await publish([1, 1, 1, 1]);
      await derive();
      expect((await edr()).assessment).toMatchObject({ strengthRung: 'L1', coverageBucket: 'L1', coverageMode: 'auto' });
    });

    it('should refuse a first declaration naming one axis only', async () => {
      await expect(admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', null)).rejects.toThrow('A first declaration names both axes');
    });

    it('should name the user who declares both axes at the values the derivation held, and only once', async () => {
      await publish([2, 2, 2, 2]);
      await derive();
      const { strengthRung, coverageBucket } = (await edr()).assessment!;

      await admin().controlCapabilities.upsertAssessment(edrId, strengthRung, coverageBucket, 'Reason');
      await admin().controlCapabilities.upsertAssessment(edrId, strengthRung, coverageBucket, 'Reason');

      const events = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(events[0]).toMatchObject({ type: 'sources_changed', connector: null, userId: adminUserId });
      expect(events[1]).toMatchObject({ connector: 'derivation' });
      expect((await edr()).lastAssessedConnector).toBeNull();
    });

    it('should keep the coverage another save wrote while a strength declaration waited on the row', async () => {
      await admin().controlCapabilities.upsertAssessment(edrId, 'L1', 'L1', null);
      const edrRow = and(eq(controlCapabilityAssessments.capabilityId, edrId), eq(controlCapabilityAssessments.tenantId, tenantId));
      let commitHolder = (): void => {};
      const held = new Promise<void>((resolve) => {
        commitHolder = resolve;
      });
      let signalLocked = (): void => {};
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });

      const holder = db.transaction(async (tx) => {
        await tx.select({ id: controlCapabilityAssessments.id }).from(controlCapabilityAssessments).where(edrRow).for('update');
        signalLocked();
        await held;
        await tx.update(controlCapabilityAssessments).set({ coverageBucket: 'L3' }).where(edrRow);
      });
      await locked;

      const save = admin().controlCapabilities.upsertAssessment(edrId, 'L3', null, null);
      await waitUntilHeldUp();
      commitHolder();
      await Promise.all([save, holder]);

      expect((await edr()).assessment).toMatchObject({ strengthRung: 'L3', coverageBucket: 'L3' });
    });

    it('should report the strength it put back over the one another save wrote while it waited on the row', async () => {
      await admin().controlCapabilities.upsertAssessment(edrId, 'L1', 'L1', null);
      const edrRow = and(eq(controlCapabilityAssessments.capabilityId, edrId), eq(controlCapabilityAssessments.tenantId, tenantId));
      let commitHolder = (): void => {};
      const held = new Promise<void>((resolve) => {
        commitHolder = resolve;
      });
      let signalLocked = (): void => {};
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });

      const holder = db.transaction(async (tx) => {
        await tx.select({ id: controlCapabilityAssessments.id }).from(controlCapabilityAssessments).where(edrRow).for('update');
        signalLocked();
        await held;
        await tx.update(controlCapabilityAssessments).set({ strengthRung: 'L3' }).where(edrRow);
      });
      await locked;

      const save = admin().controlCapabilities.upsertAssessment(edrId, 'L1', null, null);
      await waitUntilHeldUp();
      commitHolder();
      const [crossings] = await Promise.all([save, holder]);

      expect(crossings).toEqual([{ capabilityId: edrId, axes: ['strength'] }]);
    });

    it('should never move a control declared by hand on both axes', async () => {
      await admin().controlCapabilities.upsertAssessment(edrId, 'L0', 'L0', null);
      await publish([5, 5, 5, 5]);

      await derive();

      expect((await edr()).assessment).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0', strengthMode: 'manual', coverageMode: 'manual' });
    });
  });

  describe('saving both axes at once', () => {
    it('should re-attach the strength and declare the coverage of a control never assessed', async () => {
      await publish([3, 3, 3, 3]);

      await admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', 'Rolled out everywhere', ['strength']);

      const detail = await edr();
      expect(detail.assessment).toMatchObject({ strengthRung: 'L2', strengthMode: 'auto', coverageBucket: 'L3', coverageMode: 'manual' });
      expect(detail.assessmentSources).toEqual([{ axis: 'strength', source: 'nist-csf-2.0', frameworkTitle: 'NIST CSF 2.0' }]);
    });

    it('should journal that first save as one switch of the strength, the coverage never passing through auto', async () => {
      await publish([3, 3, 3, 3]);

      await admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', 'Rolled out everywhere', ['strength']);

      const events = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ newCoverage: 'L3', strengthMode: 'auto', coverageMode: null, comment: 'Rolled out everywhere' });
    });

    it('should refuse an axis both declared and re-attached, writing nothing', async () => {
      await publish([3, 3, 3, 3]);

      await expect(admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', null, ['coverage'])).rejects.toThrow('An axis is either declared or re-attached');
      expect((await edr()).assessment).toBeNull();
    });
  });

  describe('switching an axis between auto and manual', () => {
    it('should journal a re-attach of both axes with its comment, as a switch of both to auto', async () => {
      await publish([3, 3, 3, 3]);
      await admin().controlCapabilities.upsertAssessment(edrId, 'L0', 'L0', null);

      await admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Back to the answers', ['strength', 'coverage']);

      const [reattach] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(reattach).toMatchObject({
        connector: 'derivation',
        comment: 'Back to the answers',
        strengthMode: 'auto',
        coverageMode: 'auto',
      });
    });

    it('should journal a re-attach of the strength alone as a switch of that axis only', async () => {
      await publish([3, 3, 3, 3]);
      await admin().controlCapabilities.upsertAssessment(edrId, 'L0', 'L0', null);

      await admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Back to the answers', ['strength']);

      const [reattach] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(reattach).toMatchObject({ comment: 'Back to the answers', strengthMode: 'auto', coverageMode: null });
    });

    it('should journal a declaration over a derived coverage as a switch of that axis to manual', async () => {
      await publish([3, 3, 3, 3]);
      await derive();

      await admin().controlCapabilities.upsertAssessment(edrId, null, 'L3', 'Rolled out everywhere');

      const [detach] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(detach).toMatchObject({
        connector: null,
        userId: adminUserId,
        comment: 'Rolled out everywhere',
        strengthMode: null,
        coverageMode: 'manual',
      });
    });

    it('should save a value change on an axis already manual without a comment, switching no mode', async () => {
      await admin().controlCapabilities.upsertAssessment(edrId, 'L1', 'L1', null);

      await admin().controlCapabilities.upsertAssessment(edrId, 'L2', null, null);

      const [change] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(change).toMatchObject({
        type: 'strength_change',
        comment: null,
        strengthMode: null,
        coverageMode: null,
      });
    });

    it('should declare over a derived axis without a comment', async () => {
      await publish([3, 3, 3, 3]);
      await derive();

      await admin().controlCapabilities.upsertAssessment(edrId, 'L3', null, null);

      expect((await edr()).assessment).toMatchObject({ strengthRung: 'L3', strengthMode: 'manual', coverageMode: 'auto' });
      const [latest] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(latest).toMatchObject({ comment: null, strengthMode: 'manual' });
    });

    it('should store a blank comment as no comment', async () => {
      await publish([3, 3, 3, 3]);
      await derive();

      await admin().controlCapabilities.upsertAssessment(edrId, 'L3', null, '   ');

      const [latest] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(latest).toMatchObject({ comment: null, strengthMode: 'manual' });
    });

    it('should declare over the derived row another write created while the save waited on it', async () => {
      const edrKey = { capabilityId: edrId, tenantId };
      let commitHolder = (): void => {};
      const held = new Promise<void>((resolve) => {
        commitHolder = resolve;
      });
      let signalInserted = (): void => {};
      const inserted = new Promise<void>((resolve) => {
        signalInserted = resolve;
      });

      const holder = db.transaction(async (tx) => {
        await tx.insert(controlCapabilityAssessments).values({
          id: uuidv7(), ...edrKey, strengthRung: 'L2', strengthMode: 'auto', coverageBucket: 'L2', coverageMode: 'auto', coverageBasis: 'typed',
        });
        signalInserted();
        await held;
      });
      await inserted;

      const save = admin().controlCapabilities.upsertAssessment(edrId, 'L3', 'L3', null);
      await waitUntilHeldUp();
      commitHolder();
      await holder;

      await save;
      expect((await edr()).assessment).toMatchObject({ strengthRung: 'L3', strengthMode: 'manual', coverageBucket: 'L3', coverageMode: 'manual' });
    });

    it('should re-attach without a comment', async () => {
      await publish([3, 3, 3, 3]);
      await admin().controlCapabilities.upsertAssessment(edrId, 'L0', 'L0', null);

      await admin().controlCapabilities.upsertAssessment(edrId, null, null, null, ['strength', 'coverage']);

      expect((await edr()).assessment).toMatchObject({ strengthMode: 'auto', coverageMode: 'auto' });
      const [latest] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(latest).toMatchObject({ comment: null, strengthMode: 'auto', coverageMode: 'auto' });
    });
  });

  describe('derivation provenance', () => {
    it('should date the derivation when a re-attach leaves the value where the declaration held it', async () => {
      await publish([3, 3, 3, 3]);
      const pooled = (await admin().controlCapabilities.getPooledAssessments())
        .find((entry) => entry.capabilityId === edrId)!;
      await admin().controlCapabilities.upsertAssessment(edrId, pooled.strengthRung, pooled.coverageBucket, null);

      await admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Reason', ['strength', 'coverage']);

      const detail = await edr();
      expect(detail.assessment).toMatchObject({ strengthMode: 'auto', coverageMode: 'auto' });
      expect(detail.lastDerivedAt).not.toBeNull();
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event).toMatchObject({ type: 'sources_changed', connector: 'derivation', userId: expect.any(String) });
    });

    it('should date the derivation when a source joins without moving the value', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      await derive();

      // (1 x 1 + 1 x 0.5) / 1.5 = 1
      await publish([1, 1, 1, 1]);
      await derive();

      expect((await edr()).assessment).toMatchObject({ strengthRung: 'L1', coverageBucket: 'L2' });
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event).toMatchObject({ type: 'sources_changed', connector: 'derivation', userId: null });
    });
  });

  describe('sources of each event', () => {
    const NIST = { source: 'nist-csf-2.0', frameworkTitle: 'NIST CSF 2.0' };
    const DRATA = { source: 'drata', frameworkTitle: null, complianceAssessmentId: null, complianceAssessmentName: null };
    const assessmentSource = (complianceAssessmentId: string, complianceAssessmentName: string) =>
      ({ ...NIST, complianceAssessmentId, complianceAssessmentName });
    const eventSourceIds = (column: 'eventId' | 'tenantId', value: string) =>
      db.select({ id: controlCapabilityAssessmentEventSources.id })
        .from(controlCapabilityAssessmentEventSources)
        .where(eq(controlCapabilityAssessmentEventSources[column], value));

    it('should name, per axis, Drata and the published assessment with its framework and its name that day', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      const id = await publish([3, 3, 1, 3], edrRequirements, 'T2 2026');

      await derive();

      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event.connector).toBe('derivation');
      expect(event.sources).toEqual([
        { axis: 'coverage', ...DRATA },
        { axis: 'strength', ...DRATA },
        { axis: 'strength', ...assessmentSource(id, 'T2 2026') },
      ]);
    });

    it('should name both assessments when the latest answers feeding one value come from two of them', async () => {
      const earlier = await publish([1, 1, 1, 1], edrRequirements, 'T4 2025');
      const later = await publish([3, 3, 3, 'blank'], edrRequirements, 'T2 2026');

      await derive();

      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event.sources).toEqual([
        { axis: 'coverage', ...assessmentSource(later, 'T2 2026') },
        { axis: 'coverage', ...assessmentSource(earlier, 'T4 2025') },
        { axis: 'strength', ...assessmentSource(later, 'T2 2026') },
        { axis: 'strength', ...assessmentSource(earlier, 'T4 2025') },
      ]);
    });

    it('should name Drata alone when no assessment is published', async () => {
      await mirror(EDR_DRATA_L1_BROAD);

      await derive();

      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(event.sources).toEqual([{ axis: 'coverage', ...DRATA }, { axis: 'strength', ...DRATA }]);
    });

    it('should record no source on a declaration', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      await derive();

      await admin().controlCapabilities.upsertAssessment(edrId, 'L0', 'L0', 'Reason');

      const [declaration] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(declaration).toMatchObject({ connector: null, userId: adminUserId, sources: [] });
    });

    it('should record the sources the derivation holds again on a re-attachment', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      const id = await publish([3, 3, 3, 3], edrRequirements, 'T2 2026');
      await admin().controlCapabilities.upsertAssessment(edrId, 'L0', 'L0', null);

      await admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Reason', ['strength', 'coverage']);

      const [reattach] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(reattach).toMatchObject({ connector: 'derivation', userId: adminUserId });
      expect(reattach.sources).toEqual([
        { axis: 'coverage', ...DRATA },
        { axis: 'strength', ...DRATA },
        { axis: 'strength', ...assessmentSource(id, 'T2 2026') },
      ]);
    });

    it('should record no source when the derivation clears an axis nothing feeds any more', async () => {
      const id = await publish([3, 3, 3, 3]);
      await derive();

      await admin().complianceAssessments.reopenAssessment(id);
      await derive();

      const [cleared, derived] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(cleared).toMatchObject({ type: 'assessment_cleared', sources: [] });
      expect(derived.sources.length).toBeGreaterThan(0);
    });

    it('should keep the name an assessment had when it fed the value, after it is reopened and renamed', async () => {
      const id = await publish([3, 3, 3, 3], edrRequirements, 'T2 2026');
      await derive();

      await admin().complianceAssessments.reopenAssessment(id);
      await derive();
      await admin().complianceAssessments.renameAssessment(id, 'Q2 2026');
      await admin().complianceAssessments.publishAssessment(id);
      await derive();

      const [renamed, cleared, original] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(cleared.type).toBe('assessment_cleared');
      expect(renamed.sources.map((source) => source.complianceAssessmentName)).toEqual(['Q2 2026', 'Q2 2026']);
      expect(original.sources.map((source) => source.complianceAssessmentName)).toEqual(['T2 2026', 'T2 2026']);
    });

    it('should read an event recorded without sources as having none', async () => {
      await db.insert(controlCapabilityAssessmentEvents).values([{
        id: uuidv7(),
        capabilityId: edrId,
        tenantId,
        connector: 'derivation',
        type: 'assessment_set',
        newStrength: 'L2',
        newCoverage: 'L2',
      }]);

      const events = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(events).toHaveLength(1);
      expect(events[0].sources).toEqual([]);
    });

    it('should show another tenant none of them, and refuse a source row across tenants', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      await derive();
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      const otherTenantId = await createTenant(services, adminUserId);

      const otherEvents = await services.withOrigin({ type: 'client', userId: adminUserId, tenantId: otherTenantId })
        .controlCapabilities.getCapabilityEvents(edrId);
      const rejection: unknown = await db.insert(controlCapabilityAssessmentEventSources)
        .values([{ id: uuidv7(), eventId: event.id, tenantId: otherTenantId, axis: 'coverage', source: 'drata' }])
        .then(() => undefined, (error: unknown) => error);

      expect(otherEvents).toEqual([]);
      expect(rejection).toMatchObject({ cause: { constraint: 'control_capability_assessment_event_sources_event_fk' } });
    });

    it('should refuse an assessment id without its name', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      await derive();
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);

      const rejection: unknown = await db.insert(controlCapabilityAssessmentEventSources)
        .values([{ id: uuidv7(), eventId: event.id, tenantId, axis: 'strength', source: 'nist-csf-2.0', complianceAssessmentId: uuidv7() }])
        .then(() => undefined, (error: unknown) => error);

      expect(rejection).toMatchObject({ cause: { constraint: 'control_capability_assessment_event_sources_assessment_ck' } });
    });

    it('should go with their event, and with their tenant', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      await derive();
      const [event] = await admin().controlCapabilities.getCapabilityEvents(edrId);
      expect(await eventSourceIds('eventId', event.id)).toHaveLength(2);

      await db.delete(controlCapabilityAssessmentEvents).where(eq(controlCapabilityAssessmentEvents.id, event.id));
      expect(await eventSourceIds('eventId', event.id)).toEqual([]);

      await admin().controlCapabilities.upsertAssessment(edrId, 'L0', 'L0', 'Reason');
      await admin().controlCapabilities.upsertAssessment(edrId, null, null, 'Reason', ['strength', 'coverage']);
      expect((await eventSourceIds('tenantId', tenantId)).length).toBeGreaterThan(0);

      await db.delete(tenants).where(eq(tenants.id, tenantId));
      expect(await eventSourceIds('tenantId', tenantId)).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('should show another tenant none of the sources a derivation recorded, and refuse a source row across tenants', async () => {
      await mirror(EDR_DRATA_L1_BROAD);
      await publish([3, 3, 3, 3]);
      await derive();
      expect((await edr()).assessmentSources.length).toBeGreaterThan(0);
      const otherTenantId = await createTenant(services, adminUserId);

      const other = await services.withOrigin({ type: 'client', userId: adminUserId, tenantId: otherTenantId })
        .controlCapabilities.getControlCapability(edrId);
      const [assessment] = await db.select({ id: controlCapabilityAssessments.id }).from(controlCapabilityAssessments)
        .where(and(eq(controlCapabilityAssessments.capabilityId, edrId), eq(controlCapabilityAssessments.tenantId, tenantId)));
      const rejection: unknown = await db.insert(controlCapabilityAssessmentSources)
        .values([{ assessmentId: assessment.id, tenantId: otherTenantId, axis: 'coverage', source: 'iso-27001' }])
        .then(() => undefined, (error: unknown) => error);

      expect(other!.assessment).toBeNull();
      expect(other!.assessmentSources).toEqual([]);
      expect(rejection).toMatchObject({ cause: { constraint: 'control_capability_assessment_sources_assessment_fk' } });
    });
  });
});
