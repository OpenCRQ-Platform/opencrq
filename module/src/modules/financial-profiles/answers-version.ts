import type { SQL } from 'drizzle-orm';
import { inArray, sql } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';
import { DECLARED_ESTATE_LOSS_KINDS } from '../declared-estate/constants';

/**
 * The latest change to what a scope's loss derivation reads: its financial profile, and its
 * declared `DECLARED_ESTATE_LOSS_KINDS`. The journal is read beside the rows because clearing a
 * declaration deletes its row, and that change must still move the version forward.
 *
 * Correlated on `views.financialProfiles`, which the caller's query must select from or join.
 */
export const lossAnswersVersion = ({ views }: Pick<RepositoryContext, 'views'>): SQL<Date> => sql<Date>`greatest(
  ${views.financialProfiles.updatedAt},
  (
    select max(${views.declaredEstate.setAt})
    from ${views.declaredEstate}
    where ${views.declaredEstate.organizationId} = ${views.financialProfiles.organizationId}
      and ${inArray(views.declaredEstate.kind, [...DECLARED_ESTATE_LOSS_KINDS])}
  ),
  (
    select max(${views.declaredEstateEvents.createdAt})
    from ${views.declaredEstateEvents}
    where ${views.declaredEstateEvents.organizationId} = ${views.financialProfiles.organizationId}
      and ${inArray(views.declaredEstateEvents.kind, [...DECLARED_ESTATE_LOSS_KINDS])}
  )
)`;
