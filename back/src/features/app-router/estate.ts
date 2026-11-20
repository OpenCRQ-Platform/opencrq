import type { ResolvedEstate } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

/** Added to a paged input by a reader that narrows to the estate of the risk scope the page sits in. */
export const estateInput = z.object({ organizationId: z.uuid().nullable().default(null) });

interface EstateResolver {
  organizations: { resolveEstate: (organizationId: string) => Promise<ResolvedEstate | undefined> },
}

/**
 * The scope id a reader must join the mapping on, or `null`. Resolved once at the boundary so the
 * readers never read the mode themselves: an open scope is measured over the whole tenant estate
 * and so narrows nothing, and no scope at all is the tenant's own library.
 */
export const resolveMappedOrganizationId = async (
  services: EstateResolver,
  organizationId: string | null,
): Promise<string | null> => {
  if (organizationId === null) {
    return null;
  }
  const estate = await services.organizations.resolveEstate(organizationId);
  if (estate === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Risk scope not found' });
  }
  return estate.mode === 'closed' ? organizationId : null;
};
