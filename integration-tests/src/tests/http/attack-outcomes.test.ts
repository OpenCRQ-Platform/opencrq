import { AttackOutcome_FinancialFraudFundsTheft, deriveSeedId } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Attack outcomes (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Attack Outcomes Tenant' }, adminId);
  });

  it('ships the curated technique set for an outcome over the tenant-scoped boundary', async () => {
    const attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_FinancialFraudFundsTheft);

    const res = await client.query('attackOutcomes.getCuratedMitreTechniquesForOutcome', { attackOutcomeId }, { tenantId });

    expect(res.status).toBe(200);
    const curated: Array<{ externalId: string, category: string, name: string, revoked: boolean }> = res.json.result.data;
    // FinancialFraudFundsTheft curates T1114.003 (signature) alongside its parent T1114 (related).
    const byExternalId = new Map(curated.map((technique) => [technique.externalId, technique]));
    expect(byExternalId.get('T1114.003')?.category).toBe('signature');
    expect(byExternalId.get('T1114')?.category).toBe('related');
    for (const technique of curated) {
      expect(technique.name).toBeTruthy();
      expect(technique.revoked).toBe(false);
    }
  });
});
