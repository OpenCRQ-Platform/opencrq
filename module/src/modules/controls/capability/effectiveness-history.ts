import type { CoverageBucket, StrengthRung } from './constants';
import type { ResolvedPosture, ScopePostureOverrideInput, TenantPostureInput } from './scope-posture';
import { DEFAULT_COVERAGE_BUCKET, DEFAULT_STRENGTH_RUNG, resolveScopePosture } from './scope-posture';

/** The fields of a journal line the replay reads. */
export interface ReplayedEvent {
  id: string,
  /** Null is the tenant declaration. */
  organizationId: string | null,
  newStrength: StrengthRung | null,
  newCoverage: CoverageBucket | null,
  createdAt: Date,
}

/** The posture in force from `at`, null while the control is not assessed. */
export interface EffectivenessHistoryLine<Event> {
  at: Date,
  posture: ResolvedPosture | null,
  /** Null on the line anchoring the replay on the live value. */
  event: Event | null,
}

const samePosture = (a: ResolvedPosture | null, b: ResolvedPosture | null): boolean => (
  a === null || b === null
    ? a === b
    : a.strengthRung === b.strengthRung
      && a.coverageBucket === b.coverageBucket
);

/**
 * Replays a control's journal into the posture the page would have shown after each line, keeping
 * only the lines that moved it. Inside a scope, the scope's declarations and the tenant lines it
 * inherits are merged through `resolveScopePosture`, so a tenant move on an axis the scope declares
 * moves nothing.
 *
 * A tenant line stores the row after the write: a cleared axis is null although the row now holds
 * the floor, and both null is the row deleted. A scope line stores the whole overlay, a null axis following the tenant.
 *
 * The journal can end away from the live state (a scope declaration nobody wrote by hand leaves no
 * line, and rows can predate their first line), so a last line at `readAt` brings it to `live`.
 */
export const replayEffectivenessHistory = <Event extends ReplayedEvent>(
  events: ReadonlyArray<Event>,
  live: ResolvedPosture | null,
  scoped: boolean,
  readAt: Date,
): Array<EffectivenessHistoryLine<Event>> => {
  const ordered = events.toSorted((a, b) => (
    a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : Number(a.id > b.id))
  ));
  let tenant: TenantPostureInput | undefined;
  let override: ScopePostureOverrideInput | undefined;
  const lines: Array<EffectivenessHistoryLine<Event>> = [];
  let last: ResolvedPosture | null = null;

  ordered.forEach((event) => {
    const cleared = event.newStrength === null && event.newCoverage === null;
    if (event.organizationId === null) {
      tenant = cleared ? undefined : {
        strengthRung: event.newStrength ?? DEFAULT_STRENGTH_RUNG,
        coverageBucket: event.newCoverage ?? DEFAULT_COVERAGE_BUCKET,
      };
    } else {
      override = cleared ? undefined : { strengthRung: event.newStrength, coverageBucket: event.newCoverage };
    }
    let posture: ResolvedPosture | null = null;
    if (scoped ? tenant !== undefined || override !== undefined : tenant !== undefined) {
      posture = resolveScopePosture(tenant, scoped ? override : undefined);
    }
    if (lines.length === 0 ? posture !== null : !samePosture(posture, last)) {
      lines.push({ at: event.createdAt, posture, event });
      last = posture;
    }
  });

  if (!samePosture(last, live)) {
    lines.push({ at: readAt, posture: live, event: null });
  }
  return lines;
};
