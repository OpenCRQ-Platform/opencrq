import type { TRPCLink } from '@trpc/client';
import { createTRPCUntypedClient } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { describe, expect, it } from 'vitest';
import { tenantBatchLink, tenantStampLink } from './tenant-batch-link';
import { getRequestTenantId, runInTenant } from './tenant-accessor';

const recordingClient = () => {
  const requests: Array<{ tenantId: string | null, path: string }> = [];
  const created: Array<string | null> = [];
  const batchLinkFor = (tenantId: string | null): TRPCLink<AnyRouter> => {
    created.push(tenantId);
    return () => ({ op }) => observable((observer) => {
      requests.push({ tenantId, path: op.path });
      observer.next({ result: { type: 'data', data: tenantId } });
      observer.complete();
    });
  };
  const client = createTRPCUntypedClient<AnyRouter>({
    links: [tenantStampLink(getRequestTenantId), tenantBatchLink(batchLinkFor)],
  });
  return { client, requests, created };
};

describe('tenantBatchLink', () => {
  it('should send each operation through the batch link of the tenant it was bound to', async () => {
    const { client, requests, created } = recordingClient();

    await Promise.all([
      runInTenant('acme', () => client.query('organizations.getOrganizations')),
      runInTenant('tarnwick', () => client.query('organizations.getOrganizations')),
      runInTenant('acme', () => client.query('assets.getAssets')),
    ]);

    expect(requests).toEqual([
      { tenantId: 'acme', path: 'organizations.getOrganizations' },
      { tenantId: 'tarnwick', path: 'organizations.getOrganizations' },
      { tenantId: 'acme', path: 'assets.getAssets' },
    ]);
    expect(created).toEqual(['acme', 'tarnwick']);
  });

  it('should send an unbound operation without a tenant when none is committed', async () => {
    const { client, requests } = recordingClient();

    await client.query('tenants.getTenants');

    expect(requests).toEqual([{ tenantId: null, path: 'tenants.getTenants' }]);
  });
});
