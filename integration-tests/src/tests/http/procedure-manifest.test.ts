import { procedureManifestFingerprint } from '@app/back/src/features/app-router/procedure-manifest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { createServiceAccountClient } from '../../helpers/service-account-client';
import { signInAs } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

describe('Procedure manifest query (HTTP/tRPC)', () => {
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('should refuse an unauthenticated call', async () => {
    const client = createTrpcTestClient(await getTestServer());

    const res = await client.query('procedureManifest');

    expect(res.status).toBe(401);
    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });

  it('should serve a session user who has picked no tenant', async () => {
    const client = createTrpcTestClient(await getTestServer());
    const { userId } = await createTenantWithAdmin(services);
    await signInAs(client, userId);

    const res = await client.query('procedureManifest');

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({
      formatVersion: 1,
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(res.json.result.data.procedures).toContainEqual({ path: 'procedureManifest', type: 'query', input: null });
  });

  it('should serve a service account, the way XTM One authenticates', async () => {
    const server = await getTestServer();
    const { origin } = await createTenantWithAdmin(services);
    const serviceAccount = await createServiceAccountClient(server, services, origin);

    const res = await serviceAccount.query('procedureManifest');

    expect(res.status).toBe(200);
    expect(res.json.result.data.procedures.length).toBeGreaterThan(0);
  });

  it('should fingerprint the procedures it returns, the same on every call', async () => {
    const client = createTrpcTestClient(await getTestServer());
    const { userId } = await createTenantWithAdmin(services);
    await signInAs(client, userId);

    const first = (await client.query('procedureManifest')).json.result.data;
    const second = (await client.query('procedureManifest')).json.result.data;

    expect(second).toEqual(first);
    expect(procedureManifestFingerprint(first)).toBe(first.fingerprint);
  });
});
