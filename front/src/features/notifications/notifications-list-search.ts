import { z } from 'zod';

export const NOTIFICATIONS_LIST_SEARCH_DEFAULTS = { status: 'all' } as const;

export const notificationsListSearchSchema = z.object({
  status: z.enum(['all', 'unread']).catch('all').default('all'),
});
