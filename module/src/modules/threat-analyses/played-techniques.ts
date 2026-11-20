import type { RepositoryContext } from '../../registry';
import { inArray } from 'drizzle-orm';
import { techniqueSuccessorsOf } from '../mitre-attack/technique-successors';

/**
 * The techniques each analysis holds, read as the vendored ATT&CK plays them: a revoked technique
 * reads as its successor, so a feed still citing T1562.001 holds T1685. A revoked id has no
 * applicable family and no control edge, which would drop it from the attack run's repertoire. The
 * successor is taken at the cited grain, before any fold to the parent, because ATT&CK split some
 * revoked parents' sub-techniques across several new parents.
 */
export const playedTechniquesOf = async (
  context: Pick<RepositoryContext, 'db' | 'views'>,
  analysisIds: Array<string>,
): Promise<Array<{ analysisId: string, techniqueExternalId: string }>> => {
  if (analysisIds.length === 0) {
    return [];
  }
  const { db, views } = context;
  const { successors, on, playedAs } = techniqueSuccessorsOf(context, views.threatAnalysisTechniques.mitreExternalId);
  return db
    .selectDistinct({
      analysisId: views.threatAnalysisTechniques.analysisId,
      techniqueExternalId: playedAs,
    })
    .from(views.threatAnalysisTechniques)
    .leftJoin(successors, on)
    .where(inArray(views.threatAnalysisTechniques.analysisId, analysisIds));
};
