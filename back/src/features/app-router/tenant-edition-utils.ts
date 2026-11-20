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

import { TRPCError } from '@trpc/server';
import type { EventOrigin } from '@app/module';
import { requireEnterpriseEdition } from '../edition';
import { isOriginAuthorizedForItsTenant } from './tenant-access-utils';

/**
 * Multi-tenancy is an Enterprise Edition feature. A Community Edition
 * deployment still holds whatever tenants it had while entitled - nothing is
 * deleted on a downgrade - but a user reaches exactly one of them.
 *
 * That one is the first they were given. Tenant ids are UUIDv7, whose
 * lexicographic order is creation order, so "first" is decided without an
 * extra column, a migration, or a per-user choice to store.
 */
export const communityEditionTenantId = (tenantIds: Array<string>): string | undefined =>
  [...tenantIds].sort((left, right) => left.localeCompare(right))[0];

/** The tenants a caller may see, which in Community Edition is at most one. */
export const visibleTenants = <T extends { id: string }>(tenants: Array<T>, isEnterpriseEdition: boolean): Array<T> => {
  if (isEnterpriseEdition) {
    return tenants;
  }
  const allowed = communityEditionTenantId(tenants.map(({ id }) => id));
  return tenants.filter((tenant) => tenant.id === allowed);
};

/**
 * Whether the platform serves `tenantId` at all.
 *
 * Membership is not the answer on its own: a Community deployment keeps every membership it had
 * while entitled - nothing is deleted on a downgrade - so a member of a tenant the platform put
 * out of reach still passes every membership check. This is the second question every path
 * carrying a client-supplied tenant has to ask, whether it arrives as `x-tenant-id` or as an
 * endpoint's own input.
 */
export const isTenantReachable = async (
  tenantId: string,
  listTenantIds: () => Promise<Array<string>>,
): Promise<boolean> => {
  if (await requireEnterpriseEdition()) {
    return true;
  }
  return tenantId === communityEditionTenantId(await listTenantIds());
};

const reachabilityPerRequest = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * `isTenantReachable`, answered once per `request`. A tRPC middleware runs once per call a batched
 * request carries, and on a Community platform each run lists the caller's tenants again for an
 * answer that cannot differ within one request. The memo hangs off the request object, so it dies
 * with it and a membership change lands on the next one.
 */
export const isTenantReachableOnce = (
  request: object,
  tenantId: string,
  listTenantIds: () => Promise<Array<string>>,
): Promise<boolean> => {
  const perTenant = reachabilityPerRequest.get(request) ?? new Map<string, Promise<boolean>>();
  reachabilityPerRequest.set(request, perTenant);
  const answered = perTenant.get(tenantId);
  if (answered) {
    return answered;
  }
  const pending = isTenantReachable(tenantId, listTenantIds);
  perTenant.set(tenantId, pending);
  return pending;
};

/**
 * Throws `FORBIDDEN` unless `origin` is a client authenticated for `tenantId` on a platform that
 * serves it: the request's own `x-tenant-id` (`origin.tenantId`) must match the tenant the input
 * targets, the caller must reach it (see `isOriginAuthorizedForItsTenant`), and the tenant must
 * be one this edition reaches (see `isTenantReachable`) — the first two would let a client claim
 * a tenant it does not belong to, the third one it belongs to but the platform no longer serves.
 */
export const assertOriginAuthorizedForTenant = async (
  origin: EventOrigin,
  tenantId: string,
  callerReachesTenant: (tenantId: string) => Promise<boolean>,
  listTenantIds: () => Promise<Array<string>>,
): Promise<void> => {
  if (origin.type !== 'client' || origin.tenantId !== tenantId
    || !(await isOriginAuthorizedForItsTenant(origin, callerReachesTenant))
    || !(await isTenantReachable(tenantId, listTenantIds))) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
};
