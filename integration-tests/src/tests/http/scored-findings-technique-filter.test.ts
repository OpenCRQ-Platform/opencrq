import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

describe('Scored findings technique filter (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: 'admin@test.com' });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
  });

  it('should list the findings of one CVE narrowed to a technique', async () => {
    const res = await client.query('findingScore.listScoredFindings', {
      vulnerability: { kind: 'cve', cveId: 'CVE-2022-41040' },
      technique: 'T1190',
    }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.total).toBe(0);
  });

  it('should reject a technique without a CVE filter', async () => {
    const res = await client.query('findingScore.listScoredFindings', { technique: 'T1190' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a technique on a technique vulnerability filter', async () => {
    const res = await client.query('findingScore.listScoredFindings', {
      vulnerability: { kind: 'technique', externalId: 'T1059', expectationType: 'detection' },
      technique: 'T1190',
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a technique the ATT&CK catalogue does not hold', async () => {
    const res = await client.query('findingScore.listScoredFindings', {
      vulnerability: { kind: 'cve', cveId: 'CVE-2022-41040' },
      technique: 'T9999',
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a technique that is not an external id', async () => {
    const res = await client.query('findingScore.listScoredFindings', {
      vulnerability: { kind: 'cve', cveId: 'CVE-2022-41040' },
      technique: 'Exploit Public-Facing Application',
    }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});
