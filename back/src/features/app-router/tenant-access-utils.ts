type ClientOrConnectorOrigin =
  | { type: 'client', tenantId: string | undefined, userId: string }
  | { type: 'connector', tenantId: string };

/**
 * Whether `origin` may read tenant-keyed deployment config (e.g. `connectors.*`) for its own
 * `tenantId`. A connector's tenantId is already bound server-side to its service account, but a
 * client's comes straight off the unauthenticated `x-tenant-id` header, so it must be checked
 * against the tenants the caller reaches before being trusted: `callerReachesTenant` answers
 * through the tenants policy (`tenants.callerReachesTenant`), so the super administrator, who is a
 * member of none, passes as the policies let it.
 */
export const isOriginAuthorizedForItsTenant = async (
  origin: ClientOrConnectorOrigin,
  callerReachesTenant: (tenantId: string) => Promise<boolean>,
): Promise<boolean> => {
  if (!origin.tenantId) {
    return false;
  }
  return origin.type === 'connector' || callerReachesTenant(origin.tenantId);
};
