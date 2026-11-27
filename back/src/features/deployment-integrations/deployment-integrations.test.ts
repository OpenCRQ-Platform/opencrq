import { describe, expect, it, vi } from 'vitest';
import type { DeploymentIntegrationsDeps, OpenctiProvisioningDeps, OpenctiProvisioningEnqueueDeps } from './deployment-integrations';
import {
  deploymentServiceAccountId,
  enableDeploymentIntegrations,
  enqueueOpenctiProvisioning,
  normaliseUrl,
  openctiDeploymentStreamKey,
  provisionOpencti,
} from './deployment-integrations';

const TENANT = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
const CONNECTION = { url: 'https://peer.example', token: 'tok' };
const DEPLOYMENT_ACCOUNT = deploymentServiceAccountId(TENANT, 'opencti');

const fakeDeps = (overrides: Partial<DeploymentIntegrationsDeps> = {}): DeploymentIntegrationsDeps => ({
  openaev: { [TENANT]: CONNECTION },
  tenantExists: vi.fn().mockResolvedValue(true),
  provisionServiceAccount: vi.fn().mockResolvedValue(undefined),
  bindOpenaev: vi.fn().mockResolvedValue(true),
  logTrace: vi.fn(),
  logFromError: vi.fn(),
  ...overrides,
});

const binding = (overrides: { serviceAccountId?: string | null, streamId?: string | null, authFailedAt?: Date | null, boundByDeployment?: boolean }) => ({
  serviceAccountId: DEPLOYMENT_ACCOUNT,
  streamId: 'stream-1',
  authFailedAt: null,
  boundByDeployment: true,
  ...overrides,
});

const adminBinding = (overrides: { serviceAccountId?: string | null, streamId?: string | null } = {}) =>
  binding({ serviceAccountId: 'admin-account', streamId: 'admin-stream', boundByDeployment: false, ...overrides });

const fakeOpenctiDeps = (overrides: Partial<OpenctiProvisioningDeps> = {}): OpenctiProvisioningDeps => ({
  getSettings: vi.fn().mockResolvedValue(null),
  withManagedStreamLock: vi.fn().mockImplementation((_url: string, run: () => Promise<unknown>) => run()),
  ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'created', streamId: 'stream-1' }),
  provisionServiceAccount: vi.fn().mockResolvedValue(undefined),
  configureOpencti: vi.fn().mockResolvedValue(true),
  repointOpencti: vi.fn().mockResolvedValue(true),
  resumeOpencti: vi.fn().mockResolvedValue(true),
  recordOpenctiMissingCapability: vi.fn().mockResolvedValue(undefined),
  logTrace: vi.fn(),
  ...overrides,
});

describe('enableDeploymentIntegrations', () => {
  it('binds an account to the OpenAEV integration the deployment provides', async () => {
    const deps = fakeDeps();
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).toHaveBeenCalledWith(expect.objectContaining({ id: deploymentServiceAccountId(TENANT, 'openaev'), tenantId: TENANT }));
    expect(deps.bindOpenaev).toHaveBeenCalledWith(TENANT, deploymentServiceAccountId(TENANT, 'openaev'));
    expect(deps.logFromError).not.toHaveBeenCalled();
  });

  it('derives one account per tenant and product, so every boot lands on the same one', () => {
    expect(deploymentServiceAccountId(TENANT, 'openaev')).toBe(deploymentServiceAccountId(TENANT, 'openaev'));
    expect(deploymentServiceAccountId(TENANT, 'opencti')).not.toBe(deploymentServiceAccountId(TENANT, 'openaev'));
  });

  it('skips a tenant the platform does not hold', async () => {
    const deps = fakeDeps({ tenantExists: vi.fn().mockResolvedValue(false) });
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
    expect(deps.bindOpenaev).not.toHaveBeenCalled();
  });

  it('never fails the boot: an unreachable OpenAEV is logged', async () => {
    const deps = fakeDeps({ bindOpenaev: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(enableDeploymentIntegrations(deps)).resolves.toBeUndefined();
    expect(deps.logFromError).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the deployment provides no connection', async () => {
    const deps = fakeDeps({ openaev: undefined });
    await enableDeploymentIntegrations(deps);
    expect(deps.tenantExists).not.toHaveBeenCalled();
  });
});

describe('enqueueOpenctiProvisioning', () => {
  const OTHER = '01a043da-ff47-72c2-aaa4-7da56d85c83f';
  const fakeEnqueueDeps = (overrides: Partial<OpenctiProvisioningEnqueueDeps> = {}): OpenctiProvisioningEnqueueDeps => ({
    opencti: { [TENANT]: CONNECTION },
    tenantExists: vi.fn().mockResolvedValue(true),
    enqueueJob: vi.fn().mockResolvedValue({ jobId: 'run-1', alreadyExisted: false }),
    logTrace: vi.fn(),
    logFromError: vi.fn(),
    ...overrides,
  });

  it('asks once per tenant under its key, folding into a run already under way, with one attempt', async () => {
    const deps = fakeEnqueueDeps();
    await enqueueOpenctiProvisioning(deps);
    expect(deps.enqueueJob).toHaveBeenCalledWith({
      kind: 'opencti-deployment-stream',
      tenantId: TENANT,
      payload: {},
      idempotencyKey: openctiDeploymentStreamKey(TENANT),
      triggeredBy: 'system',
      interactive: false,
      skipIfActive: true,
      maxAttempts: 1,
    });
  });

  it('skips a tenant the platform does not hold', async () => {
    const deps = fakeEnqueueDeps({ tenantExists: vi.fn().mockResolvedValue(false) });
    await enqueueOpenctiProvisioning(deps);
    expect(deps.enqueueJob).not.toHaveBeenCalled();
  });

  it('logs a failed enqueue and still asks for the next tenant', async () => {
    const deps = fakeEnqueueDeps({
      opencti: { [TENANT]: CONNECTION, [OTHER]: CONNECTION },
      enqueueJob: vi.fn().mockRejectedValueOnce(new Error('pool exhausted')).mockResolvedValue({ jobId: 'run-2', alreadyExisted: false }),
    });
    await expect(enqueueOpenctiProvisioning(deps)).resolves.toBeUndefined();
    expect(deps.logFromError).toHaveBeenCalledTimes(1);
    expect(deps.enqueueJob).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: OTHER }));
  });

  it('does nothing when the deployment provides no OpenCTI', async () => {
    const deps = fakeEnqueueDeps({ opencti: undefined });
    await enqueueOpenctiProvisioning(deps);
    expect(deps.tenantExists).not.toHaveBeenCalled();
  });
});

describe('provisionOpencti', () => {
  it('creates the managed stream and binds it with the deployment account', async () => {
    const deps = fakeOpenctiDeps();
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('configured');
    expect(deps.ensureManagedStream).toHaveBeenCalledWith(CONNECTION);
    expect(deps.provisionServiceAccount).toHaveBeenCalledWith(expect.objectContaining({ id: DEPLOYMENT_ACCOUNT, name: 'OpenCTI (deployment)' }));
    expect(deps.configureOpencti).toHaveBeenCalledWith(TENANT, DEPLOYMENT_ACCOUNT, 'stream-1');
    expect(deps.recordOpenctiMissingCapability).toHaveBeenCalledWith(TENANT, null);
  });

  it('binds the stream an earlier release created, without creating another', async () => {
    const deps = fakeOpenctiDeps({ ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'unchanged', streamId: 'stream-old' }) });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('configured');
    expect(deps.configureOpencti).toHaveBeenCalledWith(TENANT, DEPLOYMENT_ACCOUNT, 'stream-old');
  });

  it('reads the streams under the lock of the OpenCTI, however its URL is spelled', async () => {
    const deps = fakeOpenctiDeps();
    await provisionOpencti(deps, TENANT, { url: ' HTTPS://Peer.example/ ', token: 'tok' });
    expect(deps.withManagedStreamLock).toHaveBeenCalledWith('https://peer.example', expect.any(Function));
  });

  it('takes one lock for an OpenCTI spelled with or without its default port', () => {
    expect(normaliseUrl('https://peer.example:443/')).toBe(normaliseUrl('https://peer.example'));
    expect(normaliseUrl('http://peer.example:80/opencti/')).toBe('http://peer.example/opencti');
  });

  it('keeps a binding an admin made, while still keeping the managed stream up to date', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue(adminBinding()),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'updated', streamId: 'stream-1' }),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('kept');
    expect(deps.ensureManagedStream).toHaveBeenCalledTimes(1);
    expect(deps.configureOpencti).not.toHaveBeenCalled();
    expect(deps.repointOpencti).not.toHaveBeenCalled();
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
  });

  it('keeps an account bound without a stream as an admin\'s', async () => {
    const deps = fakeOpenctiDeps({ getSettings: vi.fn().mockResolvedValue(adminBinding({ streamId: null })) });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('kept');
    expect(deps.configureOpencti).not.toHaveBeenCalled();
  });

  it('leaves an unconfigured tenant idle with the missing capability recorded', async () => {
    const deps = fakeOpenctiDeps({
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'missing_capability', capability: 'TAXIIAPI_SETCOLLECTIONS' }),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('missing_capability');
    expect(deps.recordOpenctiMissingCapability).toHaveBeenCalledWith(TENANT, 'TAXIIAPI_SETCOLLECTIONS');
    expect(deps.configureOpencti).not.toHaveBeenCalled();
  });

  it('records no missing capability on a tenant an admin configured', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue(adminBinding()),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'missing_capability', capability: 'TAXIIAPI_SETCOLLECTIONS' }),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('missing_capability');
    expect(deps.recordOpenctiMissingCapability).not.toHaveBeenCalled();
  });

  it('keeps a deployment binding already on the managed stream', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue(binding({})),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'unchanged', streamId: 'stream-1' }),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('kept');
    expect(deps.repointOpencti).not.toHaveBeenCalled();
    expect(deps.configureOpencti).not.toHaveBeenCalled();
  });

  it('moves a deployment binding that points at another stream to the managed one', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue(binding({ streamId: 'stream-deleted' })),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'created', streamId: 'stream-2' }),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('repointed');
    expect(deps.repointOpencti).toHaveBeenCalledWith(TENANT, 'stream-deleted', 'stream-2');
  });

  it('keeps the stream an admin picked while keeping the deployment account Configure preselected', async () => {
    const deps = fakeOpenctiDeps({ getSettings: vi.fn().mockResolvedValue(adminBinding({ serviceAccountId: DEPLOYMENT_ACCOUNT })) });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('kept');
    expect(deps.repointOpencti).not.toHaveBeenCalled();
    expect(deps.resumeOpencti).not.toHaveBeenCalled();
  });

  it('resumes a deployment binding stopped on an authentication failure once the token lists the streams', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue(binding({ authFailedAt: new Date() })),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'unchanged', streamId: 'stream-1' }),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('resumed');
    expect(deps.resumeOpencti).toHaveBeenCalledWith(TENANT, 'stream-1');
    expect(deps.repointOpencti).not.toHaveBeenCalled();
  });

  it('answers kept when the failure was cleared between the read and the resume', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue(binding({ authFailedAt: new Date() })),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'unchanged', streamId: 'stream-1' }),
      resumeOpencti: vi.fn().mockResolvedValue(false),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('kept');
  });

  it('never resumes an admin binding stopped on an authentication failure', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue({ ...adminBinding({ streamId: 'stream-1' }), authFailedAt: new Date() }),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'unchanged', streamId: 'stream-1' }),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('kept');
    expect(deps.resumeOpencti).not.toHaveBeenCalled();
  });

  it('answers kept when an admin took the binding between the read and the move', async () => {
    const deps = fakeOpenctiDeps({
      getSettings: vi.fn().mockResolvedValue(binding({ streamId: 'stream-old' })),
      repointOpencti: vi.fn().mockResolvedValue(false),
    });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('kept');
  });

  it('asks nothing of OpenCTI when another run holds the lock', async () => {
    const deps = fakeOpenctiDeps({ withManagedStreamLock: vi.fn().mockResolvedValue(null) });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).resolves.toBe('locked');
    expect(deps.ensureManagedStream).not.toHaveBeenCalled();
    expect(deps.configureOpencti).not.toHaveBeenCalled();
  });

  it('rejects when an OpenCTI call fails, for the job runtime to record', async () => {
    const deps = fakeOpenctiDeps({ ensureManagedStream: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(provisionOpencti(deps, TENANT, CONNECTION)).rejects.toThrow('ECONNREFUSED');
  });
});
