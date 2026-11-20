import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));
// run-contract.ts reads app config at import time; the two mutations under test never use it.
vi.mock('../../../config', () => ({ config: () => ({}) }));

const { trpcInstance } = await import('../../../trpc');
const { jobsRouter } = await import('./jobs-router');

const CALLER_ID = 'caller-1';
const JOB_ID = '0198a6b2-0000-7000-8000-000000000001';

const hasManageSecurity = vi.fn();
const hasPlatformAccess = vi.fn();
const getJob = vi.fn();
const cancelJob = vi.fn();
const retryFromDlq = vi.fn();
const services = {
  withOrigin: () => ({
    capabilities: { hasManageSecurity },
    platformCapabilities: { hasPlatformAccess },
    jobs: { getJob, cancelJob, retryFromDlq },
  }),
};

const clientOrigin = { type: 'client', userId: CALLER_ID, tenantId: 'tenant-1' };
const connectorOrigin = { type: 'connector', serviceAccountId: CALLER_ID, tenantId: 'tenant-1' };
let origin: object = clientOrigin;

// The tenant procedure's own checks are the integration tests' concern; here it only hands the context over.
const procedure = trpcInstance.procedure.use(({ next }) => next({ ctx: { services, origin } }));
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the router reads only the context fields set above
const caller = jobsRouter(procedure as never).createCaller({} as never);

// Only a cancel is fenced against a run another asker folded into, and only for a caller who has no jobs access.
const controls = {
  cancelJob: {
    call: () => caller.cancelJob({ id: JOB_ID }),
    service: cancelJob,
    result: { cancelled: true },
    args: (viaJobsAccess: boolean) => [JOB_ID, { refuseIfShared: !viaJobsAccess }],
  },
  retryFromDlq: {
    call: () => caller.retryFromDlq({ id: JOB_ID }),
    service: retryFromDlq,
    result: { retried: true },
    args: () => [JOB_ID],
  },
};

beforeEach(() => {
  origin = clientOrigin;
  hasManageSecurity.mockReset().mockResolvedValue(false);
  hasPlatformAccess.mockReset().mockResolvedValue(false);
  getJob.mockReset().mockResolvedValue(undefined);
  cancelJob.mockReset().mockResolvedValue('cancelled');
  retryFromDlq.mockReset().mockResolvedValue(undefined);
});

describe.each(Object.entries(controls))('jobs.%s', (_name, { call, service, result, args }) => {
  it('lets a security manager control someone else\'s job without reading it', async () => {
    hasManageSecurity.mockResolvedValue(true);

    await expect(call()).resolves.toEqual(result);
    expect(service).toHaveBeenCalledWith(...args(true));
    expect(getJob).not.toHaveBeenCalled();
  });

  it('lets a caller with platform access control someone else\'s job', async () => {
    hasPlatformAccess.mockResolvedValue(true);

    await expect(call()).resolves.toEqual(result);
    expect(service).toHaveBeenCalledWith(...args(true));
  });

  it('lets a user without access control the job they started', async () => {
    getJob.mockResolvedValue({ triggeredBy: 'user', triggeredById: CALLER_ID });

    await expect(call()).resolves.toEqual(result);
    expect(service).toHaveBeenCalledWith(...args(false));
  });

  it('refuses a user without access the job of another user', async () => {
    getJob.mockResolvedValue({ triggeredBy: 'user', triggeredById: 'someone-else' });

    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(service).not.toHaveBeenCalled();
  });

  it('refuses a user without access a scheduled run', async () => {
    getJob.mockResolvedValue({ triggeredBy: 'scheduler', triggeredById: null });

    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(service).not.toHaveBeenCalled();
  });

  it('refuses a user without access an id that reads as no job', async () => {
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(service).not.toHaveBeenCalled();
  });

  it('lets a connector without access control the job it started', async () => {
    origin = connectorOrigin;
    getJob.mockResolvedValue({ triggeredBy: 'connector', triggeredById: CALLER_ID });

    await expect(call()).resolves.toEqual(result);
    expect(service).toHaveBeenCalledWith(...args(false));
  });

  it('refuses a connector without access a user\'s job carrying the same id string', async () => {
    origin = connectorOrigin;
    getJob.mockResolvedValue({ triggeredBy: 'user', triggeredById: CALLER_ID });

    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(service).not.toHaveBeenCalled();
  });
});

describe('jobs.cancelJob on a run another asker folded into', () => {
  it('refuses a user without access when the service finds the run shared', async () => {
    getJob.mockResolvedValue({ triggeredBy: 'user', triggeredById: CALLER_ID });
    cancelJob.mockResolvedValue('shared');

    await expect(caller.cancelJob({ id: JOB_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(cancelJob).toHaveBeenCalledWith(JOB_ID, { refuseIfShared: true });
  });

  it('never asks a security manager\'s cancel to refuse a shared run', async () => {
    hasManageSecurity.mockResolvedValue(true);

    await expect(caller.cancelJob({ id: JOB_ID })).resolves.toEqual({ cancelled: true });
    expect(cancelJob).toHaveBeenCalledWith(JOB_ID, { refuseIfShared: false });
  });
});
