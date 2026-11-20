import type { ResolvedPosture } from '../controls/capability/scope-posture';
import type { TestedResult } from '../controls/capability/tested-efficacy';
import type { EngineReaders } from './engine-reading';
import type { controlTechniqueTestResults } from './schema';
import type { TechniqueTestResult } from './technique-test-results';
import { testedRebooks } from '../controls/capability/tested-efficacy';
import { declaredReadings, engineReads } from './engine-reading';
import { techniqueTestKey } from './technique-test-results';

/** Keys the tenant level, which no risk scope id can collide with. */
export const TENANT_LEVEL = '';

type HeldRow = typeof controlTechniqueTestResults.$inferSelect;
export type StoredTestResult = Omit<typeof controlTechniqueTestResults.$inferInsert, 'id' | 'tenantId'>;

export interface ScopeDeclaration {
  postures: ReadonlyMap<string, ResolvedPosture>,
  /** The controls the posture crossings of this run reprice in the scope, on today's results. */
  repriced: ReadonlySet<string>,
}

export interface TechniqueTestBooking {
  /** Every row the levels should hold, booked where a risk scope's levers are priced on it. */
  wanted: Array<StoredTestResult>,
  /** By risk scope, the controls whose levers it must book again. */
  rebooked: Map<string, Set<string>>,
}

/** A stored row's booked result, absent when its levers were priced on the declaration alone. */
const bookedOf = (row: HeldRow): TestedResult | undefined =>
  (row.bookedRate === null || row.bookedHostsTested === null || row.bookedScopeHosts === null
    ? undefined
    : { rate: row.bookedRate, hostsTested: row.bookedHostsTested, scopeHosts: row.bookedScopeHosts });

/**
 * The controls of a risk scope whose levers move: a technique the engine reads of one, read at the
 * scope's declaration, moved by `TESTED_REBOOK_STEP` from the result its levers were last priced on.
 */
const movedControls = (
  wantedResults: ReadonlyArray<TechniqueTestResult>,
  heldResults: ReadonlyMap<string, HeldRow>,
  declaration: ScopeDeclaration | undefined,
  readers: EngineReaders,
): Set<string> => {
  const wantedOf = new Map(wantedResults.filter((result) => engineReads(readers, result)).map((result) => [techniqueTestKey(result), result]));
  const heldOf = [...heldResults].filter(([, row]) => engineReads(readers, row)).map(([key]) => key);
  const moved = new Set<string>();
  for (const key of new Set([...heldOf, ...wantedOf.keys()])) {
    const result = wantedOf.get(key) ?? heldResults.get(key)!;
    const stored = heldResults.get(key);
    const booked = stored === undefined ? undefined : bookedOf(stored);
    const readings = declaredReadings(declaration?.postures.get(result.capabilityId), result, readers);
    if (readings.some((declared) => testedRebooks(declared, booked, wantedOf.get(key)))) {
      moved.add(result.capabilityId);
    }
  }
  return moved;
};

/**
 * What a measurement stores, and whose levers it books again. Only a risk scope prices levers: its
 * rows the engine reads keep the result they were last priced on, or take today's where the control
 * moved or a posture crossing reprices it there. The tenant level and every row the engine does not
 * read are stored unbooked.
 */
export const planTechniqueTestBooking = ({ wantedByScope, declarationByScope, held, readers }: {
  wantedByScope: ReadonlyMap<string, ReadonlyArray<TechniqueTestResult>>,
  declarationByScope: ReadonlyMap<string, ScopeDeclaration>,
  held: ReadonlyArray<HeldRow>,
  readers: EngineReaders,
}): TechniqueTestBooking => {
  const heldByScope = Map.groupBy(held, (row) => row.organizationId ?? TENANT_LEVEL);
  const rebooked = new Map<string, Set<string>>();
  const wanted: Array<StoredTestResult> = [];
  for (const scopeKey of new Set([...wantedByScope.keys(), ...heldByScope.keys()])) {
    const heldResults = new Map((heldByScope.get(scopeKey) ?? []).map((row) => [techniqueTestKey(row), row]));
    const wantedResults = wantedByScope.get(scopeKey) ?? [];
    const isScope = scopeKey !== TENANT_LEVEL;
    const declaration = declarationByScope.get(scopeKey);
    const moved = isScope ? movedControls(wantedResults, heldResults, declaration, readers) : new Set<string>();
    if (moved.size > 0) {
      rebooked.set(scopeKey, moved);
    }
    for (const result of wantedResults) {
      let booked: TestedResult | undefined;
      if (isScope && engineReads(readers, result)) {
        const priced = moved.has(result.capabilityId) || declaration?.repriced.has(result.capabilityId) === true;
        const stored = heldResults.get(techniqueTestKey(result));
        const storedBooking = stored === undefined ? undefined : bookedOf(stored);
        booked = priced ? result : storedBooking;
      }
      wanted.push({
        ...result,
        organizationId: isScope ? scopeKey : null,
        bookedRate: booked?.rate ?? null,
        bookedHostsTested: booked?.hostsTested ?? null,
        bookedScopeHosts: booked?.scopeHosts ?? null,
      });
    }
  }
  return { wanted, rebooked };
};
