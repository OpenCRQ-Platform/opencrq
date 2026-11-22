import { describe, expect, it, vi } from 'vitest';
import type { DeploymentIntegrationsDeps } from './deployment-integrations';
import { deploymentServiceAccountId, enableDeploymentIntegrations } from './deployment-integrations';

const TENANT = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
const CONNECTION = { url: 'https://peer.example', token: 'tok' };

const fakeDeps = (overrides: Partial<DeploymentIntegrationsDeps> = {}): DeploymentIntegrationsDeps => ({
  opencti: undefined,
  openaev: { [TENANT]: CONNECTION },
  tenantExists: vi.fn().mockResolvedValue(true),
  provisionServiceAccount: vi.fn().mockResolvedValue(undefined),
  bindOpenaev: vi.fn().mockResolvedValue(true),
  isOpenctiConfigured: vi.fn().mockResolvedValue(false),
  ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'created', streamId: 'stream-1' }),
  configureOpencti: vi.fn().mockResolvedValue(true),
  recordOpenctiMissingCapability: vi.fn().mockResolvedValue(undefined),
  logTrace: vi.fn(),
  logFromError: vi.fn(),
  ...overrides,
});

const openctiOnly = (overrides: Partial<DeploymentIntegrationsDeps> = {}) =>
  fakeDeps({ openaev: undefined, opencti: { [TENANT]: CONNECTION }, ...overrides });

describe('enableDeploymentIntegrations', () => {
  it('binds an account to the OpenAEV integration the deployment provides', async () => {
    const deps = fakeDeps();
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).toHaveBeenCalledWith(expect.objectContaining({ id: deploymentServiceAccountId(TENANT, 'openaev'), tenantId: TENANT }));
    expect(deps.bindOpenaev).toHaveBeenCalledWith(TENANT, deploymentServiceAccountId(TENANT, 'openaev'));
    expect(deps.logFromError).not.toHaveBeenCalled();
  });

  it('creates the managed OpenCTI stream and binds it with the deployment account', async () => {
    const deps = openctiOnly();
    await enableDeploymentIntegrations(deps);
    const account = deploymentServiceAccountId(TENANT, 'opencti');
    expect(deps.ensureManagedStream).toHaveBeenCalledWith(CONNECTION);
    expect(deps.provisionServiceAccount).toHaveBeenCalledWith(expect.objectContaining({ id: account, name: 'OpenCTI (deployment)' }));
    expect(deps.configureOpencti).toHaveBeenCalledWith(TENANT, account, 'stream-1');
    expect(deps.recordOpenctiMissingCapability).toHaveBeenCalledWith(TENANT, null);
  });

  it('binds the stream an earlier release created, without creating another', async () => {
    const deps = openctiOnly({ ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'unchanged', streamId: 'stream-old' }) });
    await enableDeploymentIntegrations(deps);
    expect(deps.configureOpencti).toHaveBeenCalledWith(TENANT, deploymentServiceAccountId(TENANT, 'opencti'), 'stream-old');
  });

  it('keeps a binding an admin made, while still keeping the managed stream up to date', async () => {
    const deps = openctiOnly({
      isOpenctiConfigured: vi.fn().mockResolvedValue(true),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'updated', streamId: 'stream-1' }),
    });
    await enableDeploymentIntegrations(deps);
    expect(deps.ensureManagedStream).toHaveBeenCalledTimes(1);
    expect(deps.configureOpencti).not.toHaveBeenCalled();
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
  });

  it('leaves an unconfigured tenant idle with the missing capability recorded, never failing the boot', async () => {
    const deps = openctiOnly({
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'missing_capability', capability: 'TAXIIAPI_SETCOLLECTIONS' }),
    });
    await expect(enableDeploymentIntegrations(deps)).resolves.toBeUndefined();
    expect(deps.recordOpenctiMissingCapability).toHaveBeenCalledWith(TENANT, 'TAXIIAPI_SETCOLLECTIONS');
    expect(deps.configureOpencti).not.toHaveBeenCalled();
    expect(deps.logFromError).not.toHaveBeenCalled();
  });

  it('records no missing capability on a tenant an admin configured', async () => {
    const deps = openctiOnly({
      isOpenctiConfigured: vi.fn().mockResolvedValue(true),
      ensureManagedStream: vi.fn().mockResolvedValue({ kind: 'missing_capability', capability: 'TAXIIAPI_SETCOLLECTIONS' }),
    });
    await enableDeploymentIntegrations(deps);
    expect(deps.recordOpenctiMissingCapability).not.toHaveBeenCalled();
  });

  it('never fails the boot: an unreachable OpenCTI is logged', async () => {
    const deps = openctiOnly({ ensureManagedStream: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(enableDeploymentIntegrations(deps)).resolves.toBeUndefined();
    expect(deps.logFromError).toHaveBeenCalledTimes(1);
  });

  it('derives one account per tenant and product, so every boot lands on the same one', () => {
    expect(deploymentServiceAccountId(TENANT, 'openaev')).toBe(deploymentServiceAccountId(TENANT, 'openaev'));
    expect(deploymentServiceAccountId(TENANT, 'opencti')).not.toBe(deploymentServiceAccountId(TENANT, 'openaev'));
  });

  it('skips a tenant the platform does not hold', async () => {
    const deps = fakeDeps({ tenantExists: vi.fn().mockResolvedValue(false), opencti: { [TENANT]: CONNECTION } });
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
    expect(deps.ensureManagedStream).not.toHaveBeenCalled();
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
