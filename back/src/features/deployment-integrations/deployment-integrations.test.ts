import { describe, expect, it, vi } from 'vitest';
import type { DeploymentIntegrationsDeps } from './deployment-integrations';
import * as deploymentIntegrations from './deployment-integrations';
import { deploymentServiceAccountId, enableDeploymentIntegrations } from './deployment-integrations';

const TENANT = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
const CONNECTION = { url: 'https://peer.example', token: 'tok' };

const fakeDeps = (overrides: Partial<DeploymentIntegrationsDeps> = {}): DeploymentIntegrationsDeps => ({
  openaev: { [TENANT]: CONNECTION },
  tenantExists: vi.fn().mockResolvedValue(true),
  provisionServiceAccount: vi.fn().mockResolvedValue(undefined),
  bindOpenaev: vi.fn().mockResolvedValue(true),
  logTrace: vi.fn(),
  logFromError: vi.fn(),
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

  it('never binds an OpenCTI Live Stream: only an admin picks the stream OpenCRQ mirrors', async () => {
    // A deployment that provides an OpenCTI connection and nothing else leaves the tenant untouched.
    const deps = { ...fakeDeps({ openaev: undefined }), opencti: { [TENANT]: CONNECTION } };
    await enableDeploymentIntegrations(deps);
    expect(deps.tenantExists).not.toHaveBeenCalled();
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
    expect(Object.keys(deploymentIntegrations)).not.toContain('pickDeploymentStream');
  });

  it('derives one account per tenant, so every boot lands on the same one', () => {
    expect(deploymentServiceAccountId(TENANT, 'openaev')).toBe(deploymentServiceAccountId(TENANT, 'openaev'));
  });

  it('skips a tenant the platform does not hold', async () => {
    const deps = fakeDeps({ tenantExists: vi.fn().mockResolvedValue(false) });
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
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
