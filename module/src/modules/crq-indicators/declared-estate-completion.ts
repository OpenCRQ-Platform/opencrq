import type { DoorCountRow } from './attack-run-door-estate';
import type { EstateCountRow } from './attack-run-estate';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { DeclaredEstateKind } from '../declared-estate/constants';
import type { AttackRunDeclaredKind } from './engine/attack-run-law';
import { isEffectivelyExposed } from '../attack-surfaces/entry-applicability';
import { DECLARED_ESTATE_KIND_VALUES, DECLARED_ESTATE_KINDS, declaredEstateKindOf } from '../declared-estate/constants';

export interface DeclaredKindRow {
  readonly kind: DeclaredEstateKind,
  readonly low: number,
  readonly high: number,
  readonly internetFacing: boolean | null,
}

export interface DeclaredEstateCompletion {
  /** Virtual rows for the estate counts, at an unknown criticality, each at the low bound. */
  readonly counts: ReadonlyArray<EstateCountRow>,
  /** The same virtual assets at the grain the door reads, none of them a target. */
  readonly doorCounts: ReadonlyArray<DoorCountRow>,
  /** The kinds whose count each world draws above what the low bound completes. */
  readonly kinds: ReadonlyArray<AttackRunDeclaredKind>,
}

/**
 * The virtual assets that complete a scope's measured estate up to its declaration: per kind, the
 * declared low bound less the assets measured, never below zero. A kind declared reachable from the
 * Internet with no real asset of it exposed gets one exposed virtual asset, counted within that
 * completion when the completion has room for it and above it otherwise. Every other virtual asset
 * is `internal` rather than `unknown`, which the tenant setting could read as exposed.
 *
 * A kind whose high bound passes both its low bound and what it already holds is drawn again in
 * every world: its internal row carries `declaredKind` and is kept at a count of zero, so its family
 * stays in the estate in the worlds that draw some.
 *
 * `measured` is the door's counts, every family included, so a kind is measured whichever
 * techniques the scenario plays.
 */
export const completeDeclaredEstate = (
  declared: ReadonlyArray<DeclaredKindRow>,
  measured: ReadonlyArray<DoorCountRow>,
  unknownExposureCountsAs: UnknownExposureCountsAs,
): DeclaredEstateCompletion => {
  const measuredOf = new Map<DeclaredEstateKind, { count: number, exposed: boolean }>();
  for (const row of measured) {
    const kind = declaredEstateKindOf(row.categoryId, row.subcategoryId, row.identityEnabled);
    if (kind === null || row.count === 0) {
      continue;
    }
    const held = measuredOf.get(kind) ?? { count: 0, exposed: false };
    held.count += row.count;
    held.exposed ||= isEffectivelyExposed(row.exposure, unknownExposureCountsAs);
    measuredOf.set(kind, held);
  }

  const declaredOf = new Map(declared.map((row) => [row.kind, row]));
  const counts: Array<EstateCountRow> = [];
  const doorCounts: Array<DoorCountRow> = [];
  const kinds: Array<AttackRunDeclaredKind> = [];
  for (const kind of DECLARED_ESTATE_KIND_VALUES) {
    const row = declaredOf.get(kind);
    if (row === undefined) {
      continue;
    }
    const definition = DECLARED_ESTATE_KINDS[kind];
    const real = measuredOf.get(kind) ?? { count: 0, exposed: false };
    const exposed = row.internetFacing === true && definition.exposable && !real.exposed ? 1 : 0;
    const held = real.count + exposed;
    const internal = Math.max(0, row.low - held);
    const drawn = row.high > Math.max(row.low, held);
    if (drawn) {
      kinds.push({ kind, low: row.low, high: row.high, held });
    }
    for (const [exposure, count] of [['internet_facing', exposed], ['internal', internal]] as const) {
      const varies = drawn && exposure === 'internal';
      if (count === 0 && !varies) {
        continue;
      }
      const marker = varies ? { declaredKind: kind } : {};
      counts.push({ categoryId: definition.category, exposure, criticality: 'unknown', count, ...marker });
      doorCounts.push({
        categoryId: definition.category,
        subcategoryId: definition.virtualSubcategory,
        exposure,
        identityEnabled: true,
        target: false,
        count,
        ...marker,
      });
    }
  }
  return { counts, doorCounts, kinds };
};
