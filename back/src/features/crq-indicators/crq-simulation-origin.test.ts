import { describe, expect, it } from 'vitest';
import { crqRunOrigin } from './crq-simulation-origin';

const TENANT = 'tenant-1';

describe('crqRunOrigin', () => {
  it('runs as the user who asked for the simulation', () => {
    expect(crqRunOrigin({ riskScenarioId: 'scenario-1', userId: 'user-1' }, TENANT, 'crq-simulation', true))
      .toEqual({ type: 'client', userId: 'user-1', tenantId: TENANT, job: { jobKind: 'crq-simulation', interactive: true } });
  });

  it('runs as the service account that asked for it', () => {
    expect(crqRunOrigin({ riskScenarioId: 'scenario-1', serviceAccountId: 'sa-1' }, TENANT, 'crq-simulation', true))
      .toEqual({ type: 'connector', serviceAccountId: 'sa-1', tenantId: TENANT, job: { jobKind: 'crq-simulation', interactive: true } });
  });

  // A payload with no identity is the one a recompute books. Reading it as a connector built a
  // `service_accounts` predicate on an undefined id, which Postgres refused and which sent every
  // such run to the dead-letter queue.
  it('runs as the job itself when nobody asked for it', () => {
    expect(crqRunOrigin({ riskScenarioId: 'scenario-1' }, TENANT, 'crq-simulation', false))
      .toEqual({ type: 'job', tenantId: TENANT, jobKind: 'crq-simulation', interactive: false });
  });

  // The run tag travels on all three shapes: a simulation borrowing a person's origin still has to
  // say which run wrote, or the doorbell reads its writes as that person's own edit.
  it('carries the run tag on a borrowed identity', () => {
    expect(crqRunOrigin({ riskScenarioId: 'scenario-1', userId: 'user-1' }, TENANT, 'crq-simulation', false))
      .toMatchObject({ job: { jobKind: 'crq-simulation', interactive: false } });
  });
});
