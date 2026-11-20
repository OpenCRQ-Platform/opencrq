import type { DrataControlMirrorInput, EventOrigin } from '@app/module';
import { controlCapabilityAssessments, controlCapabilityAssessmentSources, deriveCapabilityAssessments } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

// IGA's evidence pairs in the vendored mapping, codes that evidence no other control: L1 by DCF-43
// (slice), DCF-70 (org-wide) and DCF-335, L2 by DCF-11 (org-wide), DCF-524 and DCF-894 (slices).
// All ready, IGA derives L2 x L3, the most any control derives from Drata. WAF has the single pair
// DCF-88, attesting L1.
const IGA_CODES = ['DCF-43', 'DCF-70', 'DCF-335', 'DCF-11', 'DCF-524', 'DCF-894'];

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

describe('Drata capability derivation', () => {
  let adminOrigin: EventOrigin;
  let connectorOrigin: EventOrigin;
  let jobOrigin: EventOrigin;
  let tenantId: string;

  const syncDerived = async (readyByCode: Record<string, boolean>) => {
    await services.withOrigin(connectorOrigin).drata.replaceMirror({
      syncedAt: new Date(),
      frameworks: [],
      controls: Object.entries(readyByCode).map(([code, isReady]) => mirrorControl(code, isReady)),
    });
    await services.withOrigin(jobOrigin).controlCapabilities.rederiveAssessments();
  };

  const getCapability = async (externalId: string) => {
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    return capabilities.find((capability) => capability.externalId === externalId)!;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Test Drata Bot',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('drata', serviceAccountId);
    connectorOrigin = { type: 'connector', serviceAccountId, tenantId: setup.tenantId };
    jobOrigin = { type: 'job', tenantId: setup.tenantId, jobKind: 'capability-derivation', interactive: false };
  });

  describe('a tenant with Drata and no published assessment', () => {
    it('should write, for every control, exactly what the Drata derivation reads from the mirror', async () => {
      const readyByCode = {
        ...Object.fromEntries(IGA_CODES.map((code) => [code, code !== 'DCF-11'])),
        'DCF-88': true,
      };
      await syncDerived(readyByCode);

      const expected = deriveCapabilityAssessments(new Map(Object.entries(readyByCode)));
      const written = (await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities())
        .filter((capability) => capability.assessment !== null);
      expect(written.map((capability) => ({
        externalId: capability.externalId,
        strengthRung: capability.assessment!.strengthRung,
        coverageBucket: capability.assessment!.coverageBucket,
      })).sort((a, b) => a.externalId.localeCompare(b.externalId))).toEqual(expected.map((entry) => ({
        externalId: entry.capabilityExternalId,
        strengthRung: entry.strengthRung,
        coverageBucket: entry.coverageBucket,
      })).sort((a, b) => a.externalId.localeCompare(b.externalId)));
    });
  });

  describe('first sync on a virgin tenant', () => {
    it('should write an assessment derived on both axes, with an event naming the derivation', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));

      const iga = await getCapability('IGA');
      expect(iga.assessment).toEqual({
        strengthRung: 'L2',
        coverageBucket: 'L3',
        strengthMode: 'auto',
        coverageMode: 'auto',
        coverageBasis: 'measured',
        comment: null,
      });
      expect(iga.lastAssessedConnector).toBe('derivation');
      expect(iga.lastAssessedBy).toBeNull();

      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(iga.id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('assessment_set');
      expect(events[0].connector).toBe('derivation');
      expect(events[0].userId).toBeNull();

      const detail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(iga.id);
      expect(detail!.assessmentSources).toEqual(expect.arrayContaining([
        { axis: 'strength', source: 'drata', frameworkTitle: null },
        { axis: 'coverage', source: 'drata', frameworkTitle: null },
      ]));
      expect(detail!.assessmentSources).toHaveLength(2);
    });

    it('should write an explicit L0 x L0 when mirrored evidence exists and nothing is ready', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, false])));

      const iga = await getCapability('IGA');
      expect(iga.assessment!.strengthRung).toBe('L0');
      expect(iga.assessment!.coverageBucket).toBe('L0');
      expect(iga.assessment!.strengthMode).toBe('auto');
    });

    it('should leave capabilities without mirrored evidence never-assessed', async () => {
      await syncDerived({ 'DCF-88': true });

      const iga = await getCapability('IGA');
      expect(iga.assessment).toBeNull();
    });
  });

  describe('later syncs', () => {
    it('should refresh a derived assessment when readiness moved, with a change event', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, code !== 'DCF-11'])));

      const iga = await getCapability('IGA');
      expect(iga.assessment!.strengthRung).toBe('L1');
      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(iga.id);
      expect(events).toHaveLength(2);
    });

    it('should write nothing when nothing moved', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));

      const iga = await getCapability('IGA');
      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(iga.id);
      expect(events).toHaveLength(1);
    });

    it('should keep the last value of a control whose Drata evidence left the mirror', async () => {
      await syncDerived({ ...Object.fromEntries(IGA_CODES.map((code) => [code, true])), 'DCF-88': true });
      await syncDerived({ 'DCF-88': true });

      const iga = await getCapability('IGA');
      expect(iga.assessment!.strengthRung).toBe('L2');
    });

    // NAC: the mapping keys no pair for it since #2727, which re-judged its only code, DCF-606.
    const seedDrataDerived = async (externalId: string, modes: { strengthMode: 'auto' | 'manual', coverageMode: 'auto' | 'manual' }) => {
      const capability = await getCapability(externalId);
      const assessmentId = uuidv7();
      await db.insert(controlCapabilityAssessments).values({
        id: assessmentId,
        capabilityId: capability.id,
        tenantId,
        strengthRung: 'L1',
        coverageBucket: 'L2',
        coverageBasis: 'measured',
        ...modes,
      });
      await db.insert(controlCapabilityAssessmentSources).values([
        { assessmentId, tenantId, axis: 'strength', source: 'drata' },
        { assessmentId, tenantId, axis: 'coverage', source: 'drata' },
      ]);
      return capability.id;
    };

    it('should clear a Drata-derived value once the mapping keys no pair for its control, with an event naming the derivation', async () => {
      const nacId = await seedDrataDerived('NAC', { strengthMode: 'auto', coverageMode: 'auto' });

      await syncDerived({ 'DCF-606': true, 'DCF-88': true });

      const nac = await getCapability('NAC');
      expect(nac.assessment).toBeNull();
      const [cleared] = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(nacId);
      expect(cleared).toMatchObject({ type: 'assessment_cleared', connector: 'derivation', oldStrength: 'L1', newStrength: null, oldCoverage: 'L2', newCoverage: null });
    });

    it('should keep the hand-declared axis of a control the mapping no longer evidences', async () => {
      await seedDrataDerived('NAC', { strengthMode: 'manual', coverageMode: 'auto' });

      await syncDerived({ 'DCF-88': true });

      const nac = await getCapability('NAC');
      expect(nac.assessment!.strengthRung).toBe('L1');
      expect(nac.assessment!.strengthMode).toBe('manual');
    });

    it('should never touch a manual assessment', async () => {
      const waf = await getCapability('WAF');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(waf.id, 'L2', 'L2', null);

      await syncDerived({ 'DCF-88': true });

      const after = await getCapability('WAF');
      expect(after.assessment!.strengthRung).toBe('L2');
      expect(after.assessment!.coverageBucket).toBe('L2');
      expect(after.assessment!.strengthMode).toBe('manual');
      expect(after.assessment!.coverageMode).toBe('manual');
    });
  });

  describe('mode flips', () => {
    it('should detach a hand declaration of both axes from the derivation', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));
      const iga = await getCapability('IGA');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(iga.id, 'L1', 'L1', 'Reason');

      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));

      const after = await getCapability('IGA');
      expect(after.assessment).toEqual({
        strengthRung: 'L1',
        coverageBucket: 'L1',
        strengthMode: 'manual',
        coverageMode: 'manual',
        coverageBasis: 'declared',
        comment: 'Reason',
      });
      const detail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(iga.id);
      expect(detail!.assessmentSources).toEqual([]);
    });

    it('should detach at the derived values, dropping the sources', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));
      const iga = await getCapability('IGA');
      const { strengthRung, coverageBucket } = iga.assessment!;

      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(iga.id, strengthRung, coverageBucket, 'Reason');

      const detached = await getCapability('IGA');
      expect(detached.assessment).toEqual({
        strengthRung: 'L2',
        coverageBucket: 'L3',
        strengthMode: 'manual',
        coverageMode: 'manual',
        coverageBasis: 'declared',
        comment: 'Reason',
      });
      const detail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(iga.id);
      expect(detail!.assessmentSources).toEqual([]);
    });

    it('should detach one axis alone, the other one still following the mirror', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));
      const iga = await getCapability('IGA');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(iga.id, null, iga.assessment!.coverageBucket, 'Reason');

      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, code !== 'DCF-11' && code !== 'DCF-524'])));

      const after = await getCapability('IGA');
      expect(after.assessment).toMatchObject({ strengthRung: 'L1', strengthMode: 'auto', coverageBucket: 'L3', coverageMode: 'manual' });
    });

    it('should re-adopt the values recomputed from the mirror over a declaration, recording both actors', async () => {
      await syncDerived(Object.fromEntries(IGA_CODES.map((code) => [code, true])));
      const iga = await getCapability('IGA');
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(iga.id, 'L1', 'L1', 'Reason');

      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(iga.id, null, null, 'Back to the mirror', ['strength', 'coverage']);

      const adopted = await getCapability('IGA');
      expect(adopted.assessment).toEqual({
        strengthRung: 'L2',
        coverageBucket: 'L3',
        strengthMode: 'auto',
        coverageMode: 'auto',
        coverageBasis: 'measured',
        comment: 'Back to the mirror',
      });
      expect(adopted.lastAssessedConnector).toBe('derivation');
      expect(adopted.lastAssessedBy).not.toBeNull();
    });
  });

  describe('origin gate', () => {
    it('should reject a derivation run from a client origin', async () => {
      await expect(services.withOrigin(adminOrigin).controlCapabilities.rederiveAssessments())
        .rejects.toThrow('Job origin required');
    });
  });
});
