import type { CoverageBucket, StrengthRung } from './constants';
import type { ResolvedPosture, ScopePostureOverrideInput, TenantPostureInput } from './scope-posture';
import { resolveScopePosture } from './scope-posture';

/** The first line a level logged for one control at or after a cutoff. */
export interface PostureEventAfter {
  capabilityId: string,
  /** Null for the tenant declaration, else the scope the line speaks for. */
  organizationId: string | null,
  oldStrength: StrengthRung | null,
  oldCoverage: CoverageBucket | null,
}

/** Both levels as they stand today, the point every past posture is rewound from. */
export interface DeclaredPostures {
  tenant: ReadonlyMap<string, TenantPostureInput>,
  scope: ReadonlyMap<string, ScopePostureOverrideInput>,
}

/** At the tenant level a line with no old value is a control nobody had declared yet. */
const tenantValueBefore = (event: PostureEventAfter): TenantPostureInput | undefined =>
  (event.oldStrength === null && event.oldCoverage === null
    ? undefined
    : { strengthRung: event.oldStrength ?? 'L0', coverageBucket: event.oldCoverage ?? 'L0' });

/** At the scope level a null axis inherits the tenant's, and two nulls are no override at all. */
const scopeValueBefore = (event: PostureEventAfter): ScopePostureOverrideInput | undefined =>
  (event.oldStrength === null && event.oldCoverage === null
    ? undefined
    : { strengthRung: event.oldStrength, coverageBucket: event.oldCoverage });

/**
 * A scope's posture as it stood just before a cutoff, axis by axis as `resolveScopePosture` reads
 * it, rebuilt backwards from today's declarations: a level that logged nothing for a control since
 * the cutoff holds today's value there, and one that did reads the old value of its first line since.
 *
 * Rewinding rather than replaying from the log's first line is what makes a cutoff in the future
 * answer today's posture exactly, and a control declared before the log began read the old value
 * of its first line. `firstEventsAfter` holds at most one line per control and level.
 */
export const rewindScopePosture = (
  capabilityIds: ReadonlyArray<string>,
  declared: DeclaredPostures,
  firstEventsAfter: ReadonlyArray<PostureEventAfter>,
): Map<string, ResolvedPosture> => {
  const tenantEvents = new Map(firstEventsAfter.filter((event) => event.organizationId === null).map((event) => [event.capabilityId, event]));
  const scopeEvents = new Map(firstEventsAfter.filter((event) => event.organizationId !== null).map((event) => [event.capabilityId, event]));
  return new Map(capabilityIds.map((capabilityId) => {
    const tenantEvent = tenantEvents.get(capabilityId);
    const scopeEvent = scopeEvents.get(capabilityId);
    return [capabilityId, resolveScopePosture(
      tenantEvent === undefined ? declared.tenant.get(capabilityId) : tenantValueBefore(tenantEvent),
      scopeEvent === undefined ? declared.scope.get(capabilityId) : scopeValueBefore(scopeEvent),
    )];
  }));
};

type ComparedPosture = Pick<ResolvedPosture, 'strengthRung' | 'coverageBucket'>;

export const samePosture = (one: ComparedPosture, other: ComparedPosture): boolean =>
  one.strengthRung === other.strengthRung
  && one.coverageBucket === other.coverageBucket;
