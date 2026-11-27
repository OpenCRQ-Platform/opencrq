import type { RunSnapshot, RunSummary } from '@app/module';
import { describe, expect, it, vi } from 'vitest';
import type { OpenctiBindingSettings } from './deployment-integrations';
import type { DeploymentStreamScheduleDeps } from './deployment-stream-schedule';
import { retryDue } from '../job-scheduler/connector-schedule';
import { deploymentServiceAccountId, openctiDeploymentStreamKey } from './deployment-integrations';
import { DEPLOYMENT_STREAM_RETRY_MS, needsDeploymentStream, runDeploymentStreamSchedule } from './deployment-stream-schedule';

const TENANT = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
const NOW = Date.parse('2026-11-26T12:00:00Z');
const DEPLOYMENT_ACCOUNT = deploymentServiceAccountId(TENANT, 'opencti');

const settings = (overrides: Partial<OpenctiBindingSettings>): OpenctiBindingSettings =>
  ({ serviceAccountId: DEPLOYMENT_ACCOUNT, streamId: 'stream-1', authFailedAt: null, boundByDeployment: true, ...overrides });

const run = (status: RunSnapshot['status'], finishedAt: Date | null): RunSnapshot => ({
  id: 'run-1',
  kind: 'opencti-deployment-stream',
  status,
  enqueuedAt: new Date(NOW - 60_000),
  startedAt: null,
  claimedAt: null,
  finishedAt,
  processedTotal: 0,
  expectedTotal: null,
  attempt: 1,
  maxAttempts: 1,
  triggeredBy: 'scheduler',
  triggeredById: null,
  askedByOthers: false,
});

const summary = (finishedAt: Date | null, active = false): RunSummary => ({
  kind: 'opencti-deployment-stream',
  activeRun: active ? run('running', null) : null,
  lastTerminalRun: finishedAt ? run('dlq', finishedAt) : null,
});

describe('needsDeploymentStream', () => {
  it('is true for a tenant nothing is bound for', () => {
    expect(needsDeploymentStream(null)).toBe(true);
    expect(needsDeploymentStream(settings({ serviceAccountId: null, streamId: null }))).toBe(true);
  });

  it('is false for a healthy deployment binding', () => {
    expect(needsDeploymentStream(settings({}))).toBe(false);
  });

  it('is true for a deployment binding whose stream no longer authenticates', () => {
    expect(needsDeploymentStream(settings({ authFailedAt: new Date(NOW) }))).toBe(true);
  });

  it('is false for an admin binding, failing or not', () => {
    expect(needsDeploymentStream(settings({ serviceAccountId: 'admin-account', authFailedAt: new Date(NOW), boundByDeployment: false }))).toBe(false);
    expect(needsDeploymentStream(settings({ serviceAccountId: 'admin-account', streamId: null, boundByDeployment: false }))).toBe(false);
  });

  it('is false for an admin binding that kept the deployment account', () => {
    expect(needsDeploymentStream(settings({ authFailedAt: new Date(NOW), boundByDeployment: false }))).toBe(false);
  });
});

describe('retryDue', () => {
  it('is false while a run is active', () => {
    expect(retryDue(summary(null, true), NOW, 1000)).toBe(false);
  });

  it('is true when nothing ever ended', () => {
    expect(retryDue(undefined, NOW, 1000)).toBe(true);
    expect(retryDue(summary(null), NOW, 1000)).toBe(true);
  });

  it('turns true exactly when the last run ended the retry period ago', () => {
    expect(retryDue(summary(new Date(NOW - 999)), NOW, 1000)).toBe(false);
    expect(retryDue(summary(new Date(NOW - 1000)), NOW, 1000)).toBe(true);
  });
});

describe('runDeploymentStreamSchedule', () => {
  const fakeDeps = (overrides: Partial<DeploymentStreamScheduleDeps> = {}): DeploymentStreamScheduleDeps => ({
    connection: () => ({ url: 'https://peer.example', token: 'tok' }),
    getSettings: vi.fn().mockResolvedValue(null),
    jobs: {
      getRunSummariesByKind: vi.fn().mockResolvedValue([]),
      enqueueJob: vi.fn().mockResolvedValue({ jobId: 'job-1', alreadyExisted: false }),
    },
    now: () => NOW,
    ...overrides,
  });

  it('enqueues the provisioning of a tenant that is not connected, under the shared key', async () => {
    const deps = fakeDeps();
    await expect(runDeploymentStreamSchedule(TENANT, deps)).resolves.toEqual({ outcome: 'enqueued' });
    expect(deps.jobs.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'opencti-deployment-stream',
      tenantId: TENANT,
      idempotencyKey: openctiDeploymentStreamKey(TENANT),
      triggeredBy: 'scheduler',
      skipIfActive: true,
      maxAttempts: 1,
    }));
  });

  it('does nothing for a tenant the deployment provides no connection', async () => {
    const deps = fakeDeps({ connection: () => undefined });
    await expect(runDeploymentStreamSchedule(TENANT, deps)).resolves.toEqual({ outcome: 'skipped' });
    expect(deps.jobs.enqueueJob).not.toHaveBeenCalled();
  });

  it('does nothing for a tenant already connected', async () => {
    const deps = fakeDeps({ getSettings: vi.fn().mockResolvedValue(settings({})) });
    await expect(runDeploymentStreamSchedule(TENANT, deps)).resolves.toEqual({ outcome: 'skipped' });
    expect(deps.jobs.enqueueJob).not.toHaveBeenCalled();
  });

  it('waits out the retry period after a run', async () => {
    const recent = vi.fn().mockResolvedValue([summary(new Date(NOW - DEPLOYMENT_STREAM_RETRY_MS + 1))]);
    const deps = fakeDeps({ jobs: { getRunSummariesByKind: recent, enqueueJob: vi.fn() } });
    await expect(runDeploymentStreamSchedule(TENANT, deps)).resolves.toEqual({ outcome: 'skipped' });
    expect(deps.jobs.enqueueJob).not.toHaveBeenCalled();
  });

  it('reports a run already holding the key', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.jobs.enqueueJob).mockResolvedValue({ jobId: 'job-1', alreadyExisted: true });
    await expect(runDeploymentStreamSchedule(TENANT, deps)).resolves.toEqual({ outcome: 'skipped_active' });
  });
});
