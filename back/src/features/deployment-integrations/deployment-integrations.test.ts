import { describe, expect, it, vi } from 'vitest';
import type { DeploymentIntegrationsDeps } from './deployment-integrations';
import { deploymentServiceAccountId, enableDeploymentIntegrations, pickDeploymentStream } from './deployment-integrations';

const TENANT = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
const CONNECTION = { url: 'https://peer.example', token: 'tok' };

const fakeDeps = (overrides: Partial<DeploymentIntegrationsDeps> = {}): DeploymentIntegrationsDeps => ({
  opencti: { [TENANT]: CONNECTION },
  openaev: { [TENANT]: CONNECTION },
  tenantExists: vi.fn().mockResolvedValue(true),
  provisionServiceAccount: vi.fn().mockResolvedValue(undefined),
  bindOpenaev: vi.fn().mockResolvedValue(true),
  configureOpencti: vi.fn().mockResolvedValue(true),
  isOpenctiConfigured: vi.fn().mockResolvedValue(false),
  listOpenctiStreams: vi.fn().mockResolvedValue([{ id: 'stopped', verdict: 'stopped' }, { id: 'live', verdict: 'delivers' }]),
  logTrace: vi.fn(),
  logFromError: vi.fn(),
  ...overrides,
});

describe('pickDeploymentStream', () => {
  it('takes the first stream that delivers, else none', () => {
    expect(pickDeploymentStream([{ id: 'a', verdict: 'undecidable' }, { id: 'b', verdict: 'delivers' }, { id: 'c', verdict: 'delivers' }])).toBe('b');
    expect(pickDeploymentStream([{ id: 'a', verdict: 'incompatible' }])).toBeNull();
    expect(pickDeploymentStream([])).toBeNull();
  });
});

describe('enableDeploymentIntegrations', () => {
  it('binds an account to each provided integration and enables OpenCTI on its delivering stream', async () => {
    const deps = fakeDeps();
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).toHaveBeenCalledWith(expect.objectContaining({ id: deploymentServiceAccountId(TENANT, 'openaev'), tenantId: TENANT }));
    expect(deps.bindOpenaev).toHaveBeenCalledWith(TENANT, deploymentServiceAccountId(TENANT, 'openaev'));
    expect(deps.configureOpencti).toHaveBeenCalledWith(TENANT, deploymentServiceAccountId(TENANT, 'opencti'), 'live');
    expect(deps.logFromError).not.toHaveBeenCalled();
  });

  it('derives one account per tenant and product, so every boot lands on the same ones', () => {
    expect(deploymentServiceAccountId(TENANT, 'opencti')).toBe(deploymentServiceAccountId(TENANT, 'opencti'));
    expect(deploymentServiceAccountId(TENANT, 'opencti')).not.toBe(deploymentServiceAccountId(TENANT, 'openaev'));
  });

  it('leaves an OpenCTI an admin configured untouched, without reading its streams', async () => {
    const deps = fakeDeps({ isOpenctiConfigured: vi.fn().mockResolvedValue(true) });
    await enableDeploymentIntegrations(deps);
    expect(deps.listOpenctiStreams).not.toHaveBeenCalled();
    expect(deps.configureOpencti).not.toHaveBeenCalled();
  });

  it('leaves OpenCTI for an admin when no stream delivers, creating no account for it', async () => {
    const deps = fakeDeps({ openaev: undefined, listOpenctiStreams: vi.fn().mockResolvedValue([{ id: 'x', verdict: 'incompatible' }]) });
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
    expect(deps.configureOpencti).not.toHaveBeenCalled();
  });

  it('skips a tenant the platform does not hold', async () => {
    const deps = fakeDeps({ tenantExists: vi.fn().mockResolvedValue(false) });
    await enableDeploymentIntegrations(deps);
    expect(deps.provisionServiceAccount).not.toHaveBeenCalled();
  });

  it('never fails the boot: an unreachable OpenCTI is logged and OpenAEV still comes up', async () => {
    const deps = fakeDeps({ listOpenctiStreams: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(enableDeploymentIntegrations(deps)).resolves.toBeUndefined();
    expect(deps.logFromError).toHaveBeenCalledTimes(1);
    expect(deps.bindOpenaev).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the deployment provides no connection', async () => {
    const deps = fakeDeps({ opencti: undefined, openaev: undefined });
    await enableDeploymentIntegrations(deps);
    expect(deps.tenantExists).not.toHaveBeenCalled();
  });
});
