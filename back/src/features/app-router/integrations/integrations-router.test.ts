import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const TENANT_ID = '0198a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5c';
const OTHER_TENANT_ID = '0198a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5d';

const connectors = vi.hoisted((): { current: Record<string, unknown> } => ({ current: {} }));
vi.mock('../../../config', () => ({ config: () => ({ connectors: connectors.current }) }));

const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../xtm/public-product-urls', () => ({ publicProductUrls: { resolve } }));

const { integrationsRouter } = await import('./integrations-router');
const { trpcInstance } = await import('../../../trpc');

const OPENCTI = { url: 'http://opencti:8080', token: 'connector-token' };
const OPENAEV = { url: 'http://openaev:8080', token: 'connector-token' };

beforeEach(() => {
  connectors.current = { opencti: { [TENANT_ID]: OPENCTI }, openaev: { [TENANT_ID]: OPENAEV } };
  resolve.mockReset().mockImplementation((product: string) => Promise.resolve(`https://${product}.example.com`));
});

const statusFor = async (reachesTenant: boolean) => {
  const withOrigin = vi.fn(() => ({
    tenants: { callerReachesTenant: () => Promise.resolve(reachesTenant) },
    integrationSettings: { getAllIntegrationSettings: () => Promise.resolve([]) },
    openctiConnector: { getSettings: () => Promise.resolve(null) },
    defaultThreats: { getSettings: () => Promise.resolve(null) },
  }));
  const origin = { type: 'client', userId: 'user-1', tenantId: TENANT_ID, markings: null, openctiAccess: null } as const;
  const procedure = trpcInstance.procedure.use(({ next }) => next({ ctx: { services: { withOrigin }, origin, user: null } }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the router reads only the context fields set above
  return await integrationsRouter(procedure as never).createCaller({} as never).getConnectorsStatus();
};

describe('integrations.getConnectorsStatus', () => {
  it('should give the URL each product names itself for the tenant\'s connection, not the connection\'s own', async () => {
    const status = await statusFor(true);

    expect(status.opencti.url).toBe('https://opencti.example.com');
    expect(status.openaev.url).toBe('https://openaev.example.com');
    expect(resolve).toHaveBeenCalledWith('opencti', OPENCTI);
    expect(resolve).toHaveBeenCalledWith('openaev', OPENAEV);
  });

  it('should give no URL, and ask nobody, for a product the tenant has no connection to', async () => {
    connectors.current = { opencti: { [OTHER_TENANT_ID]: OPENCTI } };

    const status = await statusFor(true);

    expect(status.opencti.url).toBeNull();
    expect(status.openaev.url).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('should give no URL, and ask nobody, to a caller who does not reach the tenant', async () => {
    const status = await statusFor(false);

    expect(status.opencti.url).toBeNull();
    expect(status.openaev.url).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
});
