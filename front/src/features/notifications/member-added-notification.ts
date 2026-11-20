import { z } from 'zod';

const MEMBER_ADDED_NOTIFICATION = 'member-added';

const TenantDataSchema = z.object({ tenantId: z.string(), tenantName: z.string(), addedBy: z.string() });
const PlatformDataSchema = z.object({ platformGroupNames: z.array(z.string()).min(1), addedBy: z.string() });

/** Who added the reader, and where: rendered in the reader's language, which the stored title is not. */
export type MemberAdded =
  | { scope: 'tenant', tenantId: string, tenantName: string, addedBy: string }
  | { scope: 'platform', groupNames: string, addedBy: string };

export const parseMemberAdded = (notification: { type?: string, data?: unknown }): MemberAdded | null => {
  if (notification.type !== MEMBER_ADDED_NOTIFICATION) {
    return null;
  }
  const tenant = TenantDataSchema.safeParse(notification.data);
  if (tenant.success) {
    return { scope: 'tenant', ...tenant.data };
  }
  const platform = PlatformDataSchema.safeParse(notification.data);
  return platform.success
    ? { scope: 'platform', groupNames: platform.data.platformGroupNames.join(', '), addedBy: platform.data.addedBy }
    : null;
};
