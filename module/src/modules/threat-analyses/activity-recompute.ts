import { uuidv7 } from 'uuidv7';
import type { ActivityLineage } from './activity-lineage';
import type { ActivityAnchor, ActivityAnchorKind } from './activity-scoring';
import type { threatActivityAnchors } from './schema';
import { computeActivityAssessment, notAfter } from './activity-scoring';
import { DEFAULT_RELATION_CONFIDENCE } from './constants';

/**
 * What a run writes beyond the actors whose anchors it just rebuilt.
 *
 * `changed` writes those alone, `tenant` folds every actor again because the gate that filters the
 * anchors moved, and `clock` folds every actor again because the score decays with the day.
 */
export type ActivityRecomputeScope = 'changed' | 'tenant' | 'clock';

type ClaimKind = Exclude<ActivityAnchorKind, 'actor'>;

// Fixed order: the noisy-OR multiplies one factor per distinct day, so the order of the days is
// the last ulp of the score.
const CLAIM_KINDS: Array<ClaimKind> = ['location', 'sector', 'cve', 'technique'];

export interface ActivityWatermark {
  id: string,
  updatedAt: Date,
  activityComputedAt: Date | null,
  activityGate: number | null,
  /** The threat that supplied `last_observed_at` at the last fold, not a foreign key. */
  lastObservedViaAnalysisId: string | null,
}

export interface ActivityClaimRow {
  analysisId: string,
  stixRelationId: string,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relConfidence: number | null,
  producerStixId: string | null,
}

export interface ActivityActorRow {
  analysisId: string,
  stixId: string,
  firstSeen: Date | null,
  lastSeen: Date | null,
}

export interface ActivityAnchorRow {
  analysisId: string,
  kind: ActivityAnchorKind,
  observedAt: Date | null,
  authoredAt: Date | null,
  confidence: number | null,
}

export interface ActivityFold {
  lastObservedAt: Date | null,
  /** The descendant whose date `lastObservedAt` is, `null` when the threat's own date is the latest. */
  lastObservedViaId: string | null,
  lastAuthoredAt: Date | null,
  activityScore: number | null,
}

/** An actor an ingestion touched since its anchors were last built, `null` marking one never built. */
export const isStaleActivity = (watermark: ActivityWatermark): boolean =>
  watermark.activityComputedAt === null || watermark.updatedAt > watermark.activityComputedAt;

export const gateMovedFor = (watermarks: Array<ActivityWatermark>, gate: number): boolean =>
  watermarks.some((watermark) => watermark.activityGate !== gate);

/**
 * A gate change invalidates every fold, so it outranks the day's pass, which in turn outranks the
 * change-driven one. Nothing is lost by the order: the actors an ingestion touched are rebuilt
 * whatever the scope, and only the extra whole-tenant pass is at stake here.
 */
export const chooseActivityScope = (
  input: { gateMoved: boolean, isDailyBooking: boolean },
): ActivityRecomputeScope => {
  if (input.gateMoved) {
    return 'tenant';
  }
  return input.isDailyBooking ? 'clock' : 'changed';
};

export const buildActivityAnchorRows = (
  tenantId: string,
  claims: Record<ClaimKind, Array<ActivityClaimRow>>,
  actors: Array<ActivityActorRow>,
): Array<typeof threatActivityAnchors.$inferInsert> => {
  const rows: Array<typeof threatActivityAnchors.$inferInsert> = [];
  for (const kind of CLAIM_KINDS) {
    for (const claim of claims[kind]) {
      rows.push({
        id: uuidv7(),
        tenantId,
        analysisId: claim.analysisId,
        kind,
        stixRelationId: claim.stixRelationId,
        observedAt: claim.relStopTime ?? claim.relStartTime,
        authoredAt: claim.relCreated,
        confidence: claim.relConfidence,
        producerStixId: claim.producerStixId,
      });
    }
  }
  for (const actor of actors) {
    rows.push({
      id: uuidv7(),
      tenantId,
      analysisId: actor.analysisId,
      kind: 'actor',
      stixRelationId: actor.stixId,
      observedAt: actor.lastSeen ?? actor.firstSeen,
      authoredAt: null,
      confidence: null,
      producerStixId: null,
    });
  }
  return rows;
};

const laterOf = (current: Date | null, candidate: Date): Date =>
  (current === null || candidate > current ? candidate : current);

interface AnalysisFoldState {
  claimsByKind: Map<ClaimKind, Array<ActivityAnchor>>,
  lastSeen: Date | null,
  lastObservedAt: Date | null,
  lastAuthoredAt: Date | null,
}

const emptyFoldState = (): AnalysisFoldState => ({
  claimsByKind: new Map(CLAIM_KINDS.map((kind) => [kind, []])),
  lastSeen: null,
  lastObservedAt: null,
  lastAuthoredAt: null,
});

const observedAnchorsOf = (state: AnalysisFoldState): Array<ActivityAnchor> => [
  ...(state.lastSeen === null ? [] : [{ date: state.lastSeen, provenance: 'observed' as const }]),
  ...CLAIM_KINDS.flatMap((kind) => state.claimsByKind.get(kind) ?? []),
];

/**
 * Folds a tenant's anchors into one result per actor, the confidence gate applied here rather than
 * when the rows were written, which is what lets a gate change rewrite no anchor at all.
 *
 * The `actor` row is not gated: a threat's own `last_seen ?? first_seen` is an attribute of the
 * actor, not a claim about it.
 *
 * `last_authored_at` takes the authoring date of a claim nothing observed, alone: on a claim that
 * carries a window the window is what dates it, and counting the authoring date here would date an
 * actor by when it was written about.
 *
 * The assessment sees observed anchors alone. `last_authored_at` is still written, for the engine.
 *
 * An observed date later than `now` counts as `now` while the stored anchor keeps the source's, so
 * the daily pass gives the threat that date back once the clock has passed it.
 *
 * `descendants` maps a threat to the threats attributed to it, directly or not. Their observed
 * anchors, gated the same way, date the threat above them, so `rows` may hold rows of threats absent
 * from `analysisIds`: they only date their ancestors and get no fold. Authoring dates never climb,
 * since a campaign being written about says nothing of when its actor acted.
 */
export const foldActivityAnchors = (
  analysisIds: Array<string>,
  rows: Array<ActivityAnchorRow>,
  gate: number,
  now: Date,
  descendants: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, ActivityFold> => {
  const states = new Map<string, AnalysisFoldState>();
  for (const row of rows) {
    let state = states.get(row.analysisId);
    if (state === undefined) {
      state = emptyFoldState();
      states.set(row.analysisId, state);
    }
    const observedAt = notAfter(row.observedAt, now);
    if (row.kind === 'actor') {
      if (observedAt !== null) {
        state.lastSeen = laterOf(state.lastSeen, observedAt);
        state.lastObservedAt = laterOf(state.lastObservedAt, observedAt);
      }
      continue;
    }
    if ((row.confidence ?? DEFAULT_RELATION_CONFIDENCE) < gate) {
      continue;
    }
    if (observedAt !== null) {
      state.claimsByKind.get(row.kind)?.push({ date: observedAt, provenance: 'observed' });
      state.lastObservedAt = laterOf(state.lastObservedAt, observedAt);
    } else if (row.authoredAt !== null) {
      state.lastAuthoredAt = laterOf(state.lastAuthoredAt, row.authoredAt);
    }
  }

  const folds = new Map<string, ActivityFold>();
  for (const analysisId of analysisIds) {
    const own = states.get(analysisId) ?? emptyFoldState();
    const anchors = observedAnchorsOf(own);
    let lastObservedAt = own.lastObservedAt;
    let lastObservedViaId: string | null = null;
    for (const descendantId of [...(descendants.get(analysisId) ?? [])].sort()) {
      const descendant = states.get(descendantId);
      if (descendant === undefined) {
        continue;
      }
      anchors.push(...observedAnchorsOf(descendant));
      // Ids are walked in order and only a strictly later date replaces the source, so a tie goes
      // to the threat itself, then to the smallest id.
      if (descendant.lastObservedAt !== null && (lastObservedAt === null || descendant.lastObservedAt > lastObservedAt)) {
        lastObservedAt = descendant.lastObservedAt;
        lastObservedViaId = descendantId;
      }
    }
    const { activityScore } = computeActivityAssessment(anchors, now);
    folds.set(analysisId, {
      lastObservedAt,
      lastObservedViaId,
      lastAuthoredAt: own.lastAuthoredAt,
      activityScore,
    });
  }
  return folds;
};

/**
 * The threats a run folds, and the threats whose anchors it has to read to do so: a folded threat
 * is dated by its descendants too, which an ingestion did not necessarily touch.
 *
 * On a change-driven run an ingestion reaches the ancestors of the threats it touched, so those
 * are folded with them. So is a threat whose date came from a threat that is no longer one of its
 * descendants: a link lost at any hop, a campaign past the cap or a deleted source leaves nothing
 * stale above it. Ids absent from the watermarks are not threats of the tenant.
 */
export const selectActivityFoldIds = (input: {
  scope: ActivityRecomputeScope,
  watermarks: ReadonlyArray<ActivityWatermark>,
  staleIds: Array<string>,
  lineage: ActivityLineage,
}): { foldIds: Array<string>, anchorReadIds: Array<string> } => {
  const watermarkIds = input.watermarks.map((watermark) => watermark.id);
  const wanted = new Set<string>();
  if (input.scope === 'changed') {
    for (const id of input.staleIds) {
      wanted.add(id);
      for (const ancestorId of input.lineage.ancestors.get(id) ?? []) {
        wanted.add(ancestorId);
      }
    }
    for (const { id, lastObservedViaAnalysisId: viaId } of input.watermarks) {
      if (viaId !== null && input.lineage.descendants.get(id)?.has(viaId) !== true) {
        wanted.add(id);
      }
    }
  } else {
    for (const id of watermarkIds) {
      wanted.add(id);
    }
  }
  const foldIds = watermarkIds.filter((id) => wanted.has(id));
  const anchorReadIds = new Set(foldIds);
  for (const id of foldIds) {
    for (const descendantId of input.lineage.descendants.get(id) ?? []) {
      anchorReadIds.add(descendantId);
    }
  }
  return { foldIds, anchorReadIds: [...anchorReadIds] };
};
