import { createHash } from 'node:crypto';
import { SERVICE_ACCOUNT_TOKEN_PREFIX } from '@app/utils';
import { and, eq } from 'drizzle-orm';
import {
  ServiceAccount_CveSyncAcme,
  ServiceAccount_CveSyncTarnwick,
  ServiceAccountToken_CveSyncAcme,
  ServiceAccountToken_CveSyncTarnwick,
  Tenant_Acme,
  Tenant_Tarnwick,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';
import { groups } from '../../modules/groups/schema';
import { serviceAccountGroups, serviceAccounts } from '../../modules/service-accounts/schema';
import { serviceAccountTokens } from '../../modules/service-account-tokens/schema';

// Stable seed tokens for manual e2e testing.
// These are NOT generated randomly — they are fixed so the token value is documented.
//
// Acme Sync Bot token: flgrn_ocrq_tkn_CVESyncBotAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
// Tarnwick Sync Bot token: flgrn_ocrq_tkn_CVESyncBotTwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
const TOKEN_ACME_ID_PART = 'CVESyncBotAc';
const TOKEN_TARNWICK_ID_PART = 'CVESyncBotTw';
const TOKEN_SECRET_PART = 'A'.repeat(40);

const PLAIN_TOKEN_ACME = `${SERVICE_ACCOUNT_TOKEN_PREFIX}${TOKEN_ACME_ID_PART}${TOKEN_SECRET_PART}`;
const PLAIN_TOKEN_TARNWICK = `${SERVICE_ACCOUNT_TOKEN_PREFIX}${TOKEN_TARNWICK_ID_PART}${TOKEN_SECRET_PART}`;

const hashToken = (plain: string): string =>
  createHash('sha256').update(plain, 'utf8').digest('hex');

const findConnectorsGroup = async (db: Parameters<Parameters<typeof registerPlatformSeed>[1]>[0]['db'], tenantId: string) => {
  const result = await db.select({ id: groups.id }).from(groups)
    .where(and(eq(groups.slug, 'connectors'), eq(groups.tenantId, tenantId)))
    .limit(1);
  if (!result[0]) {
    throw new Error(`[service-accounts-seeder] Connectors group not found for tenant ${tenantId}`);
  }
  return result[0].id;
};

registerPlatformSeed('service-accounts', async ({ db }) => {
  // The 'Connectors' group is auto-created by createTenantWithAdmin — look it up by slug.
  const connectorsAcmeId = await findConnectorsGroup(db, Tenant_Acme);
  const connectorsTarnwickId = await findConnectorsGroup(db, Tenant_Tarnwick);

  await db.insert(serviceAccounts).values({
    id: ServiceAccount_CveSyncAcme,
    tenantId: Tenant_Acme,
    name: 'Sync Bot',
    description: 'Automated connector that syncs CVE data from external feeds.',
    active: true,
  });
  await db.insert(serviceAccountGroups).values({
    serviceAccountId: ServiceAccount_CveSyncAcme,
    groupId: connectorsAcmeId,
  });
  await db.insert(serviceAccountTokens).values({
    id: ServiceAccountToken_CveSyncAcme,
    serviceAccountId: ServiceAccount_CveSyncAcme,
    tenantId: Tenant_Acme,
    name: 'Default token',
    tokenId: TOKEN_ACME_ID_PART,
    tokenHash: hashToken(PLAIN_TOKEN_ACME),
  });

  await db.insert(serviceAccounts).values({
    id: ServiceAccount_CveSyncTarnwick,
    tenantId: Tenant_Tarnwick,
    name: 'Sync Bot',
    description: 'Automated connector that syncs CVE data from external feeds.',
    active: true,
  });
  await db.insert(serviceAccountGroups).values({
    serviceAccountId: ServiceAccount_CveSyncTarnwick,
    groupId: connectorsTarnwickId,
  });
  await db.insert(serviceAccountTokens).values({
    id: ServiceAccountToken_CveSyncTarnwick,
    serviceAccountId: ServiceAccount_CveSyncTarnwick,
    tenantId: Tenant_Tarnwick,
    name: 'Default token',
    tokenId: TOKEN_TARNWICK_ID_PART,
    tokenHash: hashToken(PLAIN_TOKEN_TARNWICK),
  });
});
