import { newError } from '@app/utils';
import type { ActivityRecomputeScope } from './activity-recompute';
import { defineService } from '../../registry';
import { threatRelevanceSettingsService } from '../threat-relevance-settings';
import {
  buildActivityAnchorRows,
  chooseActivityScope,
  foldActivityAnchors,
  gateMovedFor,
  isStaleActivity,
  selectActivityFoldIds,
} from './activity-recompute';
import { buildActivityLineage } from './activity-lineage';
import { threatAnalysesRepository } from './repository';

export interface ActivityRecomputeResult {
  scope: ActivityRecomputeScope,
  rebuilt: number,
  folded: number,
}

export const threatActivityService = defineService(
  'threatActivity',
  threatAnalysesRepository,
).dependsOn(() => [threatRelevanceSettingsService]).implement({
  /**
   * Materialises every actor's activity dates and score from the anchors table, which it
   * also owns: the anchors are a projection of the claim tables and of the actors' own dates, so
   * rebuilding them is rerunning this. A threat is also dated by the threats attributed to it, read
   * from their stored anchors when it is folded.
   *
   * The run always issues the same statements, whatever it ends up writing. A run replaces its own
   * observed read set, so a pass that skipped the claim reads because it had nothing to rebuild
   * would drop them from the subscription and stop being woken by an ingestion at all. Every batch
   * therefore travels as a bound array, and the attributions are read whole for the tenant: the rows
   * read follow the scope, the statement's shape does not.
   *
   * Only the actors an ingestion touched have their anchors rebuilt; the scope decides the extra
   * fold on top of them, and a change-driven run folds the threats those actors date as well, and
   * every threat whose date came from a threat no longer below it. What still waits for the daily
   * pass is the score contribution of a descendant that was not the source of the date.
   */
  recomputeActivity: async (
    { repo, atomic, deps, eventOrigin },
    params: { now: Date, isDailyBooking: boolean },
  ): Promise<ActivityRecomputeResult> => {
    if (eventOrigin.type !== 'job') {
      throw newError('Threat activity is recomputed by its job alone', { origin: eventOrigin.type });
    }
    const { tenantId } = eventOrigin;
    const { confidenceGate: gate } = await deps.threatRelevanceSettings.getThreatRelevanceSettings();
    const watermarks = await repo.findActivityWatermarks();
    const stale = new Set(watermarks.filter(isStaleActivity).map((watermark) => watermark.id));
    const staleIds = [...stale];
    const scope = chooseActivityScope({
      gateMoved: gateMovedFor(watermarks, gate),
      isDailyBooking: params.isDailyBooking,
    });
    const edges = await repo.findActivityAttributionEdges(tenantId);
    const lineage = buildActivityLineage(edges, gate);
    const { foldIds, anchorReadIds } = selectActivityFoldIds({
      scope,
      watermarks,
      staleIds,
      lineage,
    });

    const claims = await repo.findActivityClaimsForAnalyses(staleIds);
    const anchorRows = buildActivityAnchorRows(
      tenantId,
      { location: claims.locations, sector: claims.sectors, cve: claims.cves, technique: claims.techniques },
      claims.actors,
    );

    const folded = new Set(foldIds);
    await atomic(async ({ repo: tx }) => {
      await tx.deleteActivityAnchorsForAnalyses(staleIds);
      await tx.insertActivityAnchors(anchorRows);
      const anchors = await tx.findActivityAnchorRows(anchorReadIds);
      const folds = foldActivityAnchors(foldIds, anchors, gate, params.now, lineage.descendants);
      // One call, since `updateActivityFold` can only order what it is handed in one go: split in
      // two, every stale row would be taken before every folded one whatever their keys.
      const rows = watermarks.flatMap((watermark) => {
        const fold = folds.get(watermark.id);
        return fold === undefined || !folded.has(watermark.id)
          ? []
          : [{ id: watermark.id, seenUpdatedAt: watermark.updatedAt, ...fold, withWatermark: stale.has(watermark.id) }];
      });
      await tx.updateActivityFold(rows, { gate, now: params.now });
    });
    return { scope, rebuilt: staleIds.length, folded: foldIds.filter((id) => !stale.has(id)).length };
  },
});
