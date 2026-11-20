import type { EventOrigin } from '@app/module';
import { BUNDLED_CATALOGS, BUNDLED_CONTROL_LINKS, loadDoorbellParents } from '@app/module';
import { CAPABILITY_DERIVATION_JOB } from '@app/back/src/features/capability-derivation';
import { capabilityDerivationHandler } from '@app/back/src/features/capability-derivation/capability-derivation-handler';
import { createDispatcher } from '@app/back/src/features/recompute-dispatcher/dispatcher-core';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { OBSERVED_JOB_FIXTURES } from '../../helpers/observed-job-fixtures';
import { db, pool } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The job runtime's own modules build their engine from the backend config while this file is still
// being evaluated, so the connection is resolved inside the factory rather than from its imports.
vi.mock('../../../../back/src/config', async () => {
  const setup = await import('../../setup/pg-config');
  return {
    config: () => ({
      postgres: { ...setup.pgConfig, database: setup.getWorkerDbName() },
      jobs: { enabled: true },
    }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const services = createTestServices(db);

const settle = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await settle(25);
  }
};

describe('the capability derivation is woken by what feeds it, never by its own writes', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let listener: pg.Client;
  let dispatcher: ReturnType<typeof createDispatcher>;
  let asked: Array<{ kind: string, tenantId: string }>;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    asked = [];

    dispatcher = createDispatcher([{ kind: CAPABILITY_DERIVATION_JOB, observed: true }], {
      enqueue: (kind, forTenant) => {
        asked.push({ kind, tenantId: forTenant });
        return Promise.resolve();
      },
      loadObservations: () => services.withOrigin({ type: 'system' }).jobDependencies.getAllObservations(),
      listTenantIds: async () => (await services.withOrigin({ type: 'system' }).tenants.getTenants()).map((tenant) => tenant.id),
      persistObservation: () => Promise.resolve(),
      loadDoorbellParents: () => loadDoorbellParents(db),
      settings: { factor: 0, floorMs: 10, capMs: 50, reconnectMinIntervalMs: 1_000 },
      onError: () => undefined,
    });

    listener = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
    await listener.connect();
    listener.on('notification', (message) => {
      dispatcher.handleEvent(JSON.parse(message.payload ?? '{}'));
    });
    await listener.query('LISTEN data_changed');
  });

  afterEach(async () => {
    dispatcher.stop();
    await listener.end();
  });

  const runDerivation = async () => {
    const { createRunObservation, finalizeRunObservation } = await import('@app/back/src/engines/job-runtime/run-observation');
    const { createJobContext } = await import('@app/back/src/engines/job-runtime/job-context-factory');
    const observation = createRunObservation(pool);
    await capabilityDerivationHandler(createJobContext({
      jobId: uuidv7(),
      tenantId,
      kind: CAPABILITY_DERIVATION_JOB,
      interactive: false,
      payload: {},
      attempt: 1,
      state: null,
      signal: new AbortController().signal,
      deps: { updateProgress: () => Promise.resolve(), saveStateSnapshot: () => Promise.resolve() },
      runDb: observation.db,
      observation: observation.recorder,
    }));
    return finalizeRunObservation(pool, observation, CAPABILITY_DERIVATION_JOB, tenantId, false, () => undefined);
  };

  const createAssessment = () => services.withOrigin(adminOrigin).complianceAssessments
    .createAssessment({ name: `Assessment ${uuidv7()}`, frameworkId: BUNDLED_CATALOGS[0].framework.id });

  it('should read the mirror, the published answers and the typed links', async () => {
    await OBSERVED_JOB_FIXTURES[CAPABILITY_DERIVATION_JOB]({ services, db, tenantId, adminOrigin });

    const persisted = await runDerivation();

    expect(persisted.reads).toEqual(expect.arrayContaining([
      'drata_controls',
      'compliance_assessments',
      'compliance_assessment_answers',
      'compliance_requirement_controls',
      'control_capability_assessments',
    ]));
  });

  it('should ask for a run when an assessment is published', async () => {
    await OBSERVED_JOB_FIXTURES[CAPABILITY_DERIVATION_JOB]({ services, db, tenantId, adminOrigin });
    await runDerivation();
    const id = await createAssessment();
    await dispatcher.start();
    await settle(200);
    asked = [];

    await services.withOrigin(adminOrigin).complianceAssessments.publishAssessment(id);

    await waitFor(() => asked.length > 0);
    expect(asked[0]).toEqual({ kind: CAPABILITY_DERIVATION_JOB, tenantId });
  });

  it('should ask for a run when a Drata sync rewrites the mirror', async () => {
    await OBSERVED_JOB_FIXTURES[CAPABILITY_DERIVATION_JOB]({ services, db, tenantId, adminOrigin });
    await runDerivation();
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Second Drata bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('drata', serviceAccountId);
    await dispatcher.start();
    await settle(200);
    asked = [];

    await services.withOrigin({ type: 'connector', serviceAccountId, tenantId }).drata.replaceMirror({
      syncedAt: new Date(),
      frameworks: [],
      controls: [{ drataId: 88, code: 'DCF-88', name: 'WAF', description: null, isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: true, archivedAt: null }],
    });

    await waitFor(() => asked.length > 0);
    expect(asked[0]).toEqual({ kind: CAPABILITY_DERIVATION_JOB, tenantId });
  });

  it('should not ask for a run on the controls its own run rewrote', async () => {
    await OBSERVED_JOB_FIXTURES[CAPABILITY_DERIVATION_JOB]({ services, db, tenantId, adminOrigin });
    await runDerivation();
    const scoped = services.withOrigin(adminOrigin);
    const idpId = (await scoped.controlCapabilities.getControlCapabilities()).find((capability) => capability.externalId === 'IDP')!.id;
    const id = await createAssessment();
    const frameworkId = BUNDLED_CATALOGS[0].framework.id;
    for (const link of (BUNDLED_CONTROL_LINKS.get(frameworkId) ?? []).filter((candidate) => candidate.capabilityId === idpId)) {
      await scoped.complianceAssessments.answerRequirement({
        assessmentId: id, requirementId: link.requirementId, ownerId: null, dueDate: null, level: null, notApplicable: true, comment: null, updatedAt: null,
      });
    }
    await scoped.complianceAssessments.publishAssessment(id);
    const before = (await scoped.controlCapabilities.getControlCapability(idpId))!.assessmentSources;
    await dispatcher.start();
    await settle(200);
    asked = [];

    await runDerivation();
    await settle(500);

    expect((await scoped.controlCapabilities.getControlCapability(idpId))!.assessmentSources).toHaveLength(before.length - 1);
    expect(asked).toEqual([]);
  });
});
