import { serviceAccounts } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantSecurityProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const ServiceAccountsSchema = createSelectSchema(serviceAccounts);

const NamedRefSchema = z.object({ id: z.string(), name: z.string() });

const ServiceAccountListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  groups: z.array(NamedRefSchema),
  roles: z.array(NamedRefSchema),
});

const NAMES_BY_IDS_CAP = 200;

export const serviceAccountsRouter = (securityProcedure: TenantSecurityProcedure) => router({
  // bounded-by: the tenant's service accounts, which a security manager creates by hand
  getServiceAccounts: securityProcedure
    .output(z.array(ServiceAccountsSchema.pick({ id: true, name: true, active: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .serviceAccounts.getServiceAccounts()),
  // bounded-by: the tenant's service accounts, which a security manager creates by hand, each with at most the tenant's groups and roles
  listServiceAccounts: securityProcedure
    .output(z.array(ServiceAccountListRowSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .serviceAccounts.listServiceAccounts()),
  getServiceAccount: securityProcedure
    .input(z.object({ id: z.uuid() }))
    .output(ServiceAccountsSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .serviceAccounts.getServiceAccount(input.id) ?? null),
  // bounded-by: NAMES_BY_IDS_CAP input ids, at most one account per id
  getNamesByIds: securityProcedure
    .input(z.object({ ids: z.array(z.uuid()).max(NAMES_BY_IDS_CAP) }))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(({ input, ctx: { services, origin } }) => (input.ids.length === 0
      ? []
      : services.withOrigin(origin).serviceAccounts.getServiceAccountNamesByIds(input.ids))),
  createServiceAccount: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string().min(1), description: z.string().nullable().optional() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .serviceAccounts.createServiceAccount(input);
    }),
  updateServiceAccount: securityProcedure
    .input(z.object({ id: z.uuid(), name: z.string().min(1).optional(), active: z.boolean().optional(), description: z.string().nullable().optional() }))
    .output(z.void())
    .mutation(async ({ input: { id, ...values }, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .serviceAccounts.updateServiceAccount(id, values);
    }),
  addGroupToServiceAccount: securityProcedure
    .input(z.object({ serviceAccountId: z.uuid(), groupId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .serviceAccounts.addGroupToServiceAccount(input.serviceAccountId, input.groupId);
    }),
  removeGroupFromServiceAccount: securityProcedure
    .input(z.object({ serviceAccountId: z.uuid(), groupId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .serviceAccounts.removeGroupFromServiceAccount(input.serviceAccountId, input.groupId);
    }),
  // bounded-by: the tenant's groups, each once, which a security manager creates by hand
  getServiceAccountGroups: securityProcedure
    .input(z.object({ serviceAccountId: z.uuid() }))
    .output(z.array(z.object({ group: NamedRefSchema })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .serviceAccounts.getServiceAccountGroups(input.serviceAccountId)),
  // bounded-by: the tenant's roles, each once, which a security manager creates by hand
  getServiceAccountRoles: securityProcedure
    .input(z.object({ serviceAccountId: z.uuid() }))
    .output(z.array(NamedRefSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .serviceAccounts.getServiceAccountRoles(input.serviceAccountId)),
  // bounded-by: the tenant's service accounts, each once, which a security manager creates by hand
  getGroupServiceAccounts: securityProcedure
    .input(z.object({ groupId: z.uuid() }))
    .output(z.array(z.object({ serviceAccount: ServiceAccountsSchema.pick({ id: true }) })))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .serviceAccounts.getGroupServiceAccounts(input.groupId)),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the account's tokens, revoked ones are never deleted
  listTokens: securityProcedure
    .input(z.object({ serviceAccountId: z.uuid() }))
    .output(z.array(z.object({
      id: z.string(),
      name: z.string(),
      tokenId: z.string(),
      lastUsedAt: z.string().nullable(),
      expiresAt: z.string().nullable(),
      revokedAt: z.string().nullable(),
      createdAt: z.string().nullable(),
    })))
    .query(async ({ input, ctx: { services, origin } }) => {
      const tokens = await services.withOrigin(origin).serviceAccountTokens.listTokens(input.serviceAccountId);
      return tokens.map((t) => ({
        id: t.id,
        name: t.name,
        tokenId: t.tokenId,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        expiresAt: t.expiresAt?.toISOString() ?? null,
        revokedAt: t.revokedAt?.toISOString() ?? null,
        createdAt: t.createdAt?.toISOString() ?? null,
      }));
    }),

  generateToken: securityProcedure
    .input(z.object({
      serviceAccountId: z.uuid(),
      name: z.string().min(1),
      expiresAt: z.string().nullable().optional(),
    }))
    .output(z.object({ plainToken: z.string() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const expiresAt = input.expiresAt != null ? new Date(input.expiresAt) : input.expiresAt;
      const { plainToken } = await services.withOrigin(origin).serviceAccountTokens.generateToken({
        serviceAccountId: input.serviceAccountId,
        name: input.name,
        expiresAt,
      });
      return { plainToken };
    }),

  rotateToken: securityProcedure
    .input(z.object({ tokenId: z.uuid() }))
    .output(z.object({ plainToken: z.string() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { plainToken } = await services.withOrigin(origin).serviceAccountTokens.rotateToken(input.tokenId);
      return { plainToken };
    }),

  revokeToken: securityProcedure
    .input(z.object({ tokenId: z.uuid() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await services.withOrigin(origin)
        .serviceAccountTokens.revokeToken(input.tokenId);
    }),
});
