import { TRPCError } from '@trpc/server';
import { z } from 'zod';

/** The account an integration runs as, created with the configuration when the caller names it. */
export const NewServiceAccountSchema = z.object({ name: z.string().trim().min(1).max(255) });

/**
 * Exactly one of `serviceAccountId` (an existing account) and `newServiceAccount` (one created in the
 * same transaction) may be sent; a body carrying both is ambiguous and refused.
 */
export const assertOneServiceAccountChoice = (input: { serviceAccountId?: string | null, newServiceAccount?: unknown }): void => {
  if (input.newServiceAccount !== undefined && input.serviceAccountId != null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Send either serviceAccountId or newServiceAccount, not both' });
  }
};
