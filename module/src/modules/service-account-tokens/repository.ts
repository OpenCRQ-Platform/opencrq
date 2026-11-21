import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { serviceAccounts } from '../service-accounts/schema';
import { serviceAccountTokens } from './schema';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
const sqlAsDate = (expr: ReturnType<typeof sql>) => expr as unknown as Date;

export const serviceAccountTokensRepository = defineRepository({
  findServiceAccountTenantId: async ({ db, views }, serviceAccountId: string) => {
    const result = await db.select({ tenantId: views.serviceAccounts.tenantId })
      .from(views.serviceAccounts)
      .where(eq(views.serviceAccounts.id, serviceAccountId))
      .limit(1);
    return result[0]?.tenantId;
  },

  insertToken: ({ db }, token: typeof serviceAccountTokens.$inferInsert) =>
    db.insert(serviceAccountTokens).values(token),

  findTokensByServiceAccountId: async ({ db, views }, serviceAccountId: string) =>
    db.select({
      id: views.serviceAccountTokens.id,
      serviceAccountId: views.serviceAccountTokens.serviceAccountId,
      tenantId: views.serviceAccountTokens.tenantId,
      name: views.serviceAccountTokens.name,
      tokenId: views.serviceAccountTokens.tokenId,
      lastUsedAt: views.serviceAccountTokens.lastUsedAt,
      expiresAt: views.serviceAccountTokens.expiresAt,
      revokedAt: views.serviceAccountTokens.revokedAt,
      createdAt: views.serviceAccountTokens.createdAt,
    }).from(views.serviceAccountTokens)
      .where(eq(views.serviceAccountTokens.serviceAccountId, serviceAccountId))
      .orderBy(desc(views.serviceAccountTokens.createdAt)),

  findTokenById: async ({ db, views }, id: string) => {
    const result = await db.select({
      id: views.serviceAccountTokens.id,
      serviceAccountId: views.serviceAccountTokens.serviceAccountId,
      tenantId: views.serviceAccountTokens.tenantId,
      name: views.serviceAccountTokens.name,
      tokenId: views.serviceAccountTokens.tokenId,
      lastUsedAt: views.serviceAccountTokens.lastUsedAt,
      expiresAt: views.serviceAccountTokens.expiresAt,
      revokedAt: views.serviceAccountTokens.revokedAt,
      createdAt: views.serviceAccountTokens.createdAt,
    }).from(views.serviceAccountTokens)
      .where(eq(views.serviceAccountTokens.id, id))
      .limit(1);
    return result[0];
  },

  revokeToken: ({ db }, id: string) =>
    db.update(serviceAccountTokens).set({ revokedAt: sqlAsDate(sql`now()`) }).where(eq(serviceAccountTokens.id, id)),

  findTokenForValidation: async ({ rawDb }, tokenId: string) => {
    // eslint-disable-next-line no-restricted-syntax -- cross-tenant lookup: the token is queried to *determine* the tenant, so no tenant context exists yet; rawDb() makes the intentional scope bypass explicit
    const result = await rawDb()
      .select({
        id: serviceAccountTokens.id,
        tokenHash: serviceAccountTokens.tokenHash,
        revokedAt: serviceAccountTokens.revokedAt,
        expiresAt: serviceAccountTokens.expiresAt,
        serviceAccountId: serviceAccountTokens.serviceAccountId,
        tenantId: serviceAccountTokens.tenantId,
        saActive: serviceAccounts.active,
      })
      .from(serviceAccountTokens)
      .innerJoin(serviceAccounts, eq(serviceAccountTokens.serviceAccountId, serviceAccounts.id))
      .where(and(eq(serviceAccountTokens.tokenId, tokenId), isNull(serviceAccountTokens.revokedAt)))
      .limit(1);
    return result[0];
  },

  /** Revokes the live tokens of an account that carry `name`; answers how many it revoked. */
  revokeTokensByName: async ({ db }, serviceAccountId: string, name: string) => {
    const revoked = await db.update(serviceAccountTokens)
      .set({ revokedAt: sqlAsDate(sql`now()`) })
      .where(and(
        eq(serviceAccountTokens.serviceAccountId, serviceAccountId),
        eq(serviceAccountTokens.name, name),
        isNull(serviceAccountTokens.revokedAt),
      ))
      .returning();
    return revoked.length;
  },

  updateLastUsed: ({ db }, id: string) =>
    db.update(serviceAccountTokens).set({ lastUsedAt: sqlAsDate(sql`now()`) }).where(eq(serviceAccountTokens.id, id)),
});
