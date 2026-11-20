import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { RepositoryContext } from '../../registry';
import { eq, sql } from 'drizzle-orm';

// The secured view is already a subquery named after the table, so a self-join goes through a
// second subquery over it rather than alias(), which only takes a table.
const successorTechniqueOf = ({ db, views }: Pick<RepositoryContext, 'db' | 'views'>) => db
  .select({
    id: views.mitreTechniques.id,
    externalId: views.mitreTechniques.externalId,
    name: views.mitreTechniques.name,
    parentTechniqueId: views.mitreTechniques.parentTechniqueId,
  })
  .from(views.mitreTechniques)
  .as('successor_technique');

/**
 * How a column of cited ATT&CK external ids is read as the vendored data plays it: left-join
 * `successors` on `on`, and `playedAs` is the successor of a revoked id and the id itself otherwise.
 * One hop reaches the final successor: `parse-stix.ts` resolves the revoked-by chain to its live end
 * (`resolveTransitive`), or to null when it ends on a technique nothing replaces.
 */
export const techniqueSuccessorsOf = (context: Pick<RepositoryContext, 'db' | 'views'>, cited: AnyPgColumn) => {
  const { db, views } = context;
  const successor = successorTechniqueOf(context);
  const successors = db
    .select({
      externalId: views.mitreTechniques.externalId,
      successorExternalId: sql<string>`${successor.externalId}`.as('successor_external_id'),
      successorName: sql<string>`${successor.name}`.as('successor_name'),
    })
    .from(views.mitreTechniques)
    .innerJoin(successor, eq(successor.id, views.mitreTechniques.replacedByTechniqueId))
    .where(eq(views.mitreTechniques.revoked, true))
    .as('revoked_technique_successors');
  return {
    successors,
    on: eq(successors.externalId, cited),
    playedAs: sql<string>`coalesce(${successors.successorExternalId}, ${cited})`,
    /** The catalogue's name of the successor, `citedName` where the cited id is played as it is. */
    playedNameOf: (citedName: AnyPgColumn) => sql<string>`coalesce(${successors.successorName}, ${citedName})`,
  };
};
