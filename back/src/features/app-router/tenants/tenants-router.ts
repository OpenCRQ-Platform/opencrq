/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { PlatformCapability_CreateTenants, supportedLocaleSchema, TenantDeletionConflictError, tenantNameSchema, TenantNotFoundError } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { PlatformProcedure, TenantProcedure } from '../app-router-router';
import { requireEnterpriseEdition } from '../../edition';
import { withConflictOn, withNotFoundOn } from '../structured-error-conflict';
import { assertOriginAuthorizedForTenant, communityEditionTenantId, isTenantReachable, visibleTenants } from '../tenant-edition-utils';
import { userSessionOnly } from '../user-session-only';
import { router } from '../../../trpc';

const NAMES_BY_IDS_CAP = 200;

const NamedRefSchema = z.object({ id: z.string(), name: z.string() });

const TenantUserListRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  groups: z.array(NamedRefSchema),
  roles: z.array(NamedRefSchema),
  /** False for an account no one ever signed in to, an invited person's included. */
  hasSignedIn: z.boolean(),
});

const TenantUserProfileSchema = z.object({ name: z.string().nullable(), title: z.string().nullable() });

export const tenantsRouter = (authProcedure: PlatformProcedure, tenantProcedure: TenantProcedure) => router({
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the deployment's tenants, their creator is a member of each
  getTenants: authProcedure
    .output(z.array(NamedRefSchema))
    .query(async ({ ctx: { services, origin } }) => visibleTenants(
      await services.withOrigin(origin).tenants.getTenants(),
      await requireEnterpriseEdition(),
    )),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the deployment's tenants, their creator is a member of each
  getTenantsWithMemberCount: authProcedure
    .output(z.array(NamedRefSchema.extend({ memberCount: z.number() })))
    .query(async ({ ctx: { services, origin } }) => visibleTenants(
      await services.withOrigin(origin).tenants.getTenantsWithMemberCount(),
      await requireEnterpriseEdition(),
    )),
  getTenant: authProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      // Membership alone would still name the tenants a Community deployment
      // put out of reach, so this answers the same question the tenant-scoped
      // procedures do rather than leaving one endpoint outside the gate.
      if (!(await requireEnterpriseEdition())) {
        const reachable = await scoped.tenants.getTenants();
        if (input.id !== communityEditionTenantId(reachable.map(({ id }) => id))) {
          return null;
        }
      }
      return await scoped.tenants.getTenant(input.id) ?? null;
    }),
  setTenantDefaultLocale: tenantProcedure
    .use(userSessionOnly)
    .input(z.object({ locale: supportedLocaleSchema.nullable() }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      if (!await scoped.capabilities.hasManageSecurity()) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await scoped.tenants.setTenantDefaultLocale(input.locale);
    }),
  createTenantsTransaction: authProcedure
    .input(z.object({
      id: z.uuid(),
      name: tenantNameSchema,
    }))
    .mutation(async ({ input, ctx: { user, origin, services } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // Multi-tenancy is Enterprise Edition: a Community deployment holds one
      // tenant, so what refuses here is the platform already having one. The
      // caller's own view is scoped to their memberships, and a user who has
      // none - the state `removeTenantUser` leaves behind - would read zero and
      // create one more tenant the platform then has to serve.
      if (!(await requireEnterpriseEdition())) {
        const existing = await services.withOrigin({ type: 'system' }).tenants.getTenants();
        if (existing.length > 0) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Multiple tenants require an Enterprise Edition license' });
        }
      }
      return services.withOrigin(origin).tenants.createTenant(input, user.id, { provisionOnboarding: true });
    }),
  renameTenant: authProcedure
    .input(z.object({ id: z.uuid(), name: tenantNameSchema }))
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin, user } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const scoped = services.withOrigin(origin);
      const canRename = await scoped.platformCapabilities.hasPlatformCapability(PlatformCapability_CreateTenants);
      if (!canRename) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to rename tenants' });
      }
      if (!(await isTenantReachable(input.id, async () => (await scoped.tenants.getTenants()).map(({ id }) => id)))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }
      await withNotFoundOn(TenantNotFoundError, () => scoped.tenants.renameTenant(input.id, input.name));
    }),
  deleteTenantsTransaction: authProcedure
    .input(z.array(z.uuid()))
    .mutation(async ({ input, ctx: { services, origin, user } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const canDelete = await services.withOrigin(origin).platformCapabilities
        .hasPlatformCapability(PlatformCapability_CreateTenants);
      if (!canDelete) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to delete tenants' });
      }
      return withConflictOn(TenantDeletionConflictError, () => services.withOrigin(origin).tenants.deleteTenants(input));
    }),
  removeTenantUser: authProcedure
    .input(z.object({ tenantId: z.uuid(), userId: z.uuid() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      await assertOriginAuthorizedForTenant(
        origin,
        input.tenantId,
        (t) => services.withOrigin(origin).tenants.callerReachesTenant(t),
        async () => (await services.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
      );
      const canManage = await services.withOrigin(origin).capabilities.hasManageSecurity();
      if (!canManage) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (!(await services.withOrigin(origin).tenants.isTenantUser(input.tenantId, input.userId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This user is not a member of the tenant' });
      }
      return services.withOrigin(origin)
        .tenants.removeTenantUser(input.tenantId, input.userId);
    }),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's invited members
  getTenantUsers: authProcedure
    .input(z.object({ tenantId: z.uuid() }))
    // XTM One's member tool prints the name and title a member holds in the tenant.
    .output(z.array(z.object({
      userId: z.string(),
      tenantName: z.string().nullable(),
      tenantTitle: z.string().nullable(),
      user: z.object({ email: z.string(), name: z.string().nullable() }),
    })))
    .query(async ({ input, ctx: { services, origin } }) => {
      await assertOriginAuthorizedForTenant(
        origin,
        input.tenantId,
        (t) => services.withOrigin(origin).tenants.callerReachesTenant(t),
        async () => (await services.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
      );
      return services.withOrigin(origin)
        .tenants.getTenantUsers(input.tenantId);
    }),
  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the tenant's invited members
  listTenantUsers: authProcedure
    .input(z.object({ tenantId: z.uuid() }))
    .output(z.array(TenantUserListRowSchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      await assertOriginAuthorizedForTenant(
        origin,
        input.tenantId,
        (t) => services.withOrigin(origin).tenants.callerReachesTenant(t),
        async () => (await services.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
      );
      return services.withOrigin(origin)
        .tenants.listTenantUsers(input.tenantId);
    }),
  // bounded-by: NAMES_BY_IDS_CAP input ids, at most one member per id
  getTenantUserNamesByIds: authProcedure
    .input(z.object({ tenantId: z.uuid(), ids: z.array(z.uuid()).max(NAMES_BY_IDS_CAP) }))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(async ({ input, ctx: { services, origin } }) => {
      await assertOriginAuthorizedForTenant(
        origin,
        input.tenantId,
        (t) => services.withOrigin(origin).tenants.callerReachesTenant(t),
        async () => (await services.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
      );
      return input.ids.length === 0
        ? []
        : services.withOrigin(origin).tenants.getTenantUserNamesByIds(input.tenantId, input.ids);
    }),
  getTenantUserProfile: authProcedure
    .input(z.object({ tenantId: z.uuid(), userId: z.uuid() }))
    .output(TenantUserProfileSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      await assertOriginAuthorizedForTenant(
        origin,
        input.tenantId,
        (t) => services.withOrigin(origin).tenants.callerReachesTenant(t),
        async () => (await services.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
      );
      return await services.withOrigin(origin)
        .tenants.getTenantUserProfile(input.tenantId, input.userId) ?? null;
    }),
  updateTenantUserProfile: authProcedure
    .input(z.object({
      tenantId: z.uuid(),
      userId: z.uuid(),
      name: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx: { services, origin, user } }) => {
      if (!user) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await assertOriginAuthorizedForTenant(
        origin,
        input.tenantId,
        (t) => services.withOrigin(origin).tenants.callerReachesTenant(t),
        async () => (await services.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
      );
      const isSelf = user.id === input.userId;
      if (!isSelf) {
        const canManage = await services.withOrigin(origin)
          .capabilities.hasManageSecurity();
        if (!canManage) {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
      }
      // A super administrator reaches the tenant with no membership, so no tenant profile to write.
      if (!(await services.withOrigin(origin).tenants.isTenantUser(input.tenantId, input.userId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This user is not a member of the tenant' });
      }
      return services.withOrigin(origin)
        .tenants.updateTenantUserProfile(input.tenantId, input.userId, {
          name: input.name,
          title: input.title,
        });
    }),
});
