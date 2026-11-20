import type { EventOrigin } from '@app/module';
import { STREAM_LOG_SCOPE_KIND } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };
const KIND = 'drata-sync';

describe('connector logs', () => {
  let tenantId: string;
  let adminId: string;
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
    adminId = setup.userId;
    adminOrigin = setup.origin;
  });

  const system = () => services.withOrigin(SYSTEM_ORIGIN);
  const reader = () => services.withOrigin(adminOrigin).jobLogs;

  const runTo = async (status: 'running' | 'succeeded', payload: Record<string, unknown>) => {
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId, payload });
    await system().jobs.claimNext('worker-1', [KIND], 30_000);
    if (status === 'succeeded') {
      await system().jobs.recordSuccess(jobId, 'worker-1');
    }
    return jobId;
  };

  const capture = async (
    line: { jobId: string | null, message: string, tenant?: string, scopeKind?: string, occurredAt?: Date, detail?: string },
  ) => system().jobLogs.appendLines([{
    id: uuidv7(),
    tenantId: line.tenant ?? tenantId,
    jobId: line.jobId,
    scopeId: line.jobId ?? 'stream-session',
    scopeKind: line.scopeKind ?? KIND,
    level: 'trace',
    message: line.message,
    detail: line.detail ?? null,
    occurredAt: line.occurredAt ?? new Date(),
  }]);

  it('files a line under the run that wrote it', async () => {
    const jobId = await runTo('succeeded', { a: 1 });
    await capture({ jobId, message: 'Starting Drata sync' });
    await capture({ jobId, message: 'Drata sync complete' });

    const groups = await reader().listRunGroups(tenantId, KIND, 3);

    expect(groups).toHaveLength(1);
    expect(groups[0].runId).toBe(jobId);
    expect(groups[0].status).toBe('succeeded');
    expect(groups[0].lines.map((line) => line.message)).toEqual(['Starting Drata sync', 'Drata sync complete']);
  });

  it('reads the runs oldest first, and only the newest few', async () => {
    const first = await runTo('succeeded', { a: 1 });
    const second = await runTo('succeeded', { b: 2 });
    const third = await runTo('succeeded', { c: 3 });
    for (const jobId of [first, second, third]) {
      await capture({ jobId, message: `line of ${jobId}` });
    }

    const groups = await reader().listRunGroups(tenantId, KIND, 2);

    expect(groups.map((group) => group.runId)).toEqual([second, third]);
  });

  it('keeps a run with no captured line as an empty group, the reader deciding what to render', async () => {
    const jobId = await runTo('succeeded', { a: 1 });

    const groups = await reader().listRunGroups(tenantId, KIND, 3);

    expect(groups).toEqual([expect.objectContaining({ runId: jobId, lines: [] })]);
  });

  it('drops the lines of the runs beyond the newest few when a run ends', async () => {
    const first = await runTo('succeeded', { a: 1 });
    const second = await runTo('succeeded', { b: 2 });
    const third = await runTo('succeeded', { c: 3 });
    for (const jobId of [first, second, third]) {
      await capture({ jobId, message: `line of ${jobId}` });
    }

    await system().jobLogs.trimToRecentRuns(tenantId, KIND, 2);

    const groups = await reader().listRunGroups(tenantId, KIND, 3);
    expect(groups.find((group) => group.runId === first)?.lines).toEqual([]);
    expect(groups.find((group) => group.runId === second)?.lines).toHaveLength(1);
    expect(groups.find((group) => group.runId === third)?.lines).toHaveLength(1);
  });

  it('does not let an absorbed ask spend a kept-run slot or evict a run that wrote lines', async () => {
    const first = await runTo('succeeded', { a: 1 });
    const second = await runTo('succeeded', { b: 2 });
    const third = await runTo('succeeded', { c: 3 });
    for (const jobId of [first, second, third]) {
      await capture({ jobId, message: `line of ${jobId}` });
    }
    // A queued survivor, newer than the three runs above, plus two asks it absorbed.
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { d: 4 } });
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { d: 4 } });
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { d: 4 } });

    await system().jobLogs.trimToRecentRuns(tenantId, KIND, 2);

    const groups = await reader().listRunGroups(tenantId, KIND, 5);
    expect(groups.find((group) => group.runId === third)?.lines).toHaveLength(1);
    expect(groups.find((group) => group.runId === second)?.lines).toHaveLength(1);
    expect(groups.find((group) => group.runId === first)?.lines).toEqual([]);
  });

  it('leaves a run still in progress alone, it being among the newest', async () => {
    const older = await runTo('succeeded', { a: 1 });
    const running = await runTo('running', { b: 2 });
    await capture({ jobId: older, message: 'from the older run' });
    await capture({ jobId: running, message: 'from the run in progress' });

    await system().jobLogs.trimToRecentRuns(tenantId, KIND, 1);

    const groups = await reader().listRunGroups(tenantId, KIND, 3);
    expect(groups.find((group) => group.runId === running)?.lines).toHaveLength(1);
    expect(groups.find((group) => group.runId === older)?.lines).toEqual([]);
  });

  it('counts neither a run still waiting for its first attempt among the kept runs nor shows it', async () => {
    const finished = await runTo('succeeded', { a: 1 });
    await capture({ jobId: finished, message: 'from the finished run' });
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { b: 2 } });
    await system().jobs.enqueueJob({ kind: KIND, tenantId, payload: { c: 3 } });

    await system().jobLogs.trimToRecentRuns(tenantId, KIND, 2);

    expect(await reader().listRunGroups(tenantId, KIND, 3)).toEqual([
      expect.objectContaining({ runId: finished, lines: [expect.objectContaining({ message: 'from the finished run' })] }),
    ]);
  });

  it('trims another kind of job on its own count, never on this one', async () => {
    const drataRun = await runTo('succeeded', { a: 1 });
    const { jobId: otherRun } = await system().jobs.enqueueJob({ kind: 'noop', tenantId, payload: { a: 1 } });
    await system().jobs.claimNext('worker-1', ['noop'], 30_000);
    await capture({ jobId: drataRun, message: 'drata line' });
    await capture({ jobId: otherRun, message: 'noop line', scopeKind: 'noop' });

    await system().jobLogs.trimToRecentRuns(tenantId, KIND, 0);

    expect(await reader().listRunGroups(tenantId, 'noop', 3)).toEqual([
      expect.objectContaining({ runId: otherRun, lines: [expect.objectContaining({ message: 'noop line' })] }),
    ]);
  });

  it('reads a stream session as a flat list, oldest line first', async () => {
    await capture({ jobId: null, scopeKind: STREAM_LOG_SCOPE_KIND, message: 'first', occurredAt: new Date('2026-08-28T09:00:00Z') });
    await capture({ jobId: null, scopeKind: STREAM_LOG_SCOPE_KIND, message: 'second', occurredAt: new Date('2026-08-28T09:00:01Z') });

    const lines = await reader().listScopeLines(tenantId, STREAM_LOG_SCOPE_KIND, 10);

    expect(lines.map((line) => line.message)).toEqual(['first', 'second']);
  });

  it('bounds a stream session by line count, the session never ending', async () => {
    for (let i = 0; i < 5; i += 1) {
      await capture({
        jobId: null,
        scopeKind: STREAM_LOG_SCOPE_KIND,
        message: `line ${i}`,
        occurredAt: new Date(Date.UTC(2026, 7, 28, 9, 0, i)),
      });
    }

    await system().jobLogs.trimToLineCount(tenantId, STREAM_LOG_SCOPE_KIND, 2);

    const lines = await reader().listScopeLines(tenantId, STREAM_LOG_SCOPE_KIND, 10);
    expect(lines.map((line) => line.message)).toEqual(['line 3', 'line 4']);
  });

  it('bounds a burst whose lines share one millisecond', async () => {
    const sameInstant = new Date(Date.UTC(2026, 7, 28, 9, 0, 0));
    for (let i = 0; i < 5; i += 1) {
      await capture({
        jobId: null,
        scopeKind: STREAM_LOG_SCOPE_KIND,
        message: `line ${i}`,
        occurredAt: sameInstant,
      });
    }

    await system().jobLogs.trimToLineCount(tenantId, STREAM_LOG_SCOPE_KIND, 2);

    const lines = await reader().listScopeLines(tenantId, STREAM_LOG_SCOPE_KIND, 10);
    expect(lines.map((line) => line.message)).toEqual(['line 3', 'line 4']);
  });

  it('leaves a session shorter than its bound untouched', async () => {
    await capture({ jobId: null, scopeKind: STREAM_LOG_SCOPE_KIND, message: 'only line' });

    await system().jobLogs.trimToLineCount(tenantId, STREAM_LOG_SCOPE_KIND, 500);

    expect(await reader().listScopeLines(tenantId, STREAM_LOG_SCOPE_KIND, 10)).toHaveLength(1);
  });

  it('shows a tenant nothing of another tenant, run or stream', async () => {
    const otherTenantId = await createTenant(services, adminId);
    const { jobId } = await system().jobs.enqueueJob({ kind: KIND, tenantId: otherTenantId, payload: { a: 1 } });
    await capture({ jobId, tenant: otherTenantId, message: 'not yours' });
    await capture({ jobId: null, tenant: otherTenantId, scopeKind: STREAM_LOG_SCOPE_KIND, message: 'not yours either' });

    expect(await reader().listRunGroups(otherTenantId, KIND, 3)).toEqual([]);
    expect(await reader().listScopeLines(otherTenantId, STREAM_LOG_SCOPE_KIND, 10)).toEqual([]);
  });

  it('refuses a line written for another tenant', async () => {
    const otherTenantId = await createTenant(services, adminId);

    await expect(services.withOrigin(adminOrigin).jobLogs.appendLines([{
      id: uuidv7(),
      tenantId: otherTenantId,
      jobId: null,
      scopeId: 'stream-session',
      scopeKind: STREAM_LOG_SCOPE_KIND,
      level: 'trace',
      message: 'planted',
      detail: null,
      occurredAt: new Date(),
    }])).rejects.toThrow();
  });
});
