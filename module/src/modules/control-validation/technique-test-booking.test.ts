import { describe, expect, it } from 'vitest';
import type { ResolvedPosture } from '../controls/capability/scope-posture';
import type { EngineReaders } from './engine-reading';
import type { controlTechniqueTestResults } from './schema';
import type { ScopeDeclaration } from './technique-test-booking';
import type { TechniqueTestResult } from './technique-test-results';
import { planTechniqueTestBooking, TENANT_LEVEL } from './technique-test-booking';

const EDR = 'edr';
const T1055 = 't1055';
const T1055_012 = 't1055-012';
const SCOPE = 'scope';

const L2_L2: ResolvedPosture = { strengthRung: 'L2', coverageBucket: 'L2', strengthSource: 'tenant', coverageSource: 'tenant' };

/** The engine reads the EDR's T1055 prevention cell, and nothing else. */
const READERS: EngineReaders = {
  byCapability: new Map([[EDR, {
    reads: (cell) => cell.function === 'prevent' && cell.techniqueExternalId === 'T1055',
    anchor: null,
    stageTechniqueExternalIds: [],
  }]]),
  externalIdOf: new Map([[T1055, 'T1055']]),
};

const result = (rate: number, over: Partial<TechniqueTestResult> = {}): TechniqueTestResult => ({
  capabilityId: EDR,
  function: 'prevent',
  mitreTechniqueId: T1055,
  grain: 'technique',
  rate,
  tests: 10,
  heldTests: Math.round(rate * 10),
  hostsTested: 10,
  scopeHosts: 20,
  ...over,
});

const heldRow = (
  stored: TechniqueTestResult,
  booked: TechniqueTestResult | null,
  organizationId: string | null = SCOPE,
): typeof controlTechniqueTestResults.$inferSelect => ({
  ...stored,
  id: `${organizationId}-${stored.mitreTechniqueId}`,
  tenantId: 'tenant',
  organizationId,
  bookedRate: booked?.rate ?? null,
  bookedHostsTested: booked?.hostsTested ?? null,
  bookedScopeHosts: booked?.scopeHosts ?? null,
});

const declared = (over: Partial<ScopeDeclaration> = {}): ReadonlyMap<string, ScopeDeclaration> =>
  new Map([[SCOPE, { postures: new Map([[EDR, L2_L2]]), repriced: new Set<string>(), ...over }]]);

const plan = (
  wanted: ReadonlyArray<[string, ReadonlyArray<TechniqueTestResult>]>,
  held: ReadonlyArray<typeof controlTechniqueTestResults.$inferSelect> = [],
  declarationByScope: ReadonlyMap<string, ScopeDeclaration> = declared(),
) => planTechniqueTestBooking({ wantedByScope: new Map(wanted), declarationByScope, held, readers: READERS });

describe('planTechniqueTestBooking', () => {
  it('books a scope\'s control again when its first result moves the efficacy past the step, and books that result', () => {
    // 1 held of 10 on half the hosts: 50% declared reads 30%.
    const { wanted, rebooked } = plan([[SCOPE, [result(0.1)]]]);

    expect(rebooked).toEqual(new Map([[SCOPE, new Set([EDR])]]));
    expect(wanted).toEqual([expect.objectContaining({ organizationId: SCOPE, bookedRate: 0.1, bookedHostsTested: 10, bookedScopeHosts: 20 })]);
  });

  it('never books the tenant level, where no lever is priced', () => {
    const { wanted, rebooked } = plan([[TENANT_LEVEL, [result(0.1)]]]);

    expect(rebooked.size).toBe(0);
    expect(wanted).toEqual([expect.objectContaining({ organizationId: null, rate: 0.1, bookedRate: null, bookedHostsTested: null, bookedScopeHosts: null })]);
  });

  it('keeps the booked result while today\'s stays within the step of it', () => {
    const booked = result(0.1);
    const { wanted, rebooked } = plan([[SCOPE, [result(0.15)]]], [heldRow(booked, booked)]);

    expect(rebooked.size).toBe(0);
    expect(wanted).toEqual([expect.objectContaining({ rate: 0.15, bookedRate: 0.1 })]);
  });

  it('books again when a booked result disappears, the declaration then reading alone', () => {
    const booked = result(0.1);
    const { wanted, rebooked } = plan([[SCOPE, []]], [heldRow(booked, booked)]);

    expect(rebooked).toEqual(new Map([[SCOPE, new Set([EDR])]]));
    expect(wanted).toEqual([]);
  });

  it('prices a control a posture crossing reprices on today\'s result, without booking it again', () => {
    const booked = result(0.1);
    const { wanted, rebooked } = plan([[SCOPE, [result(0.15)]]], [heldRow(booked, booked)], declared({ repriced: new Set([EDR]) }));

    expect(rebooked.size).toBe(0);
    expect(wanted).toEqual([expect.objectContaining({ rate: 0.15, bookedRate: 0.15 })]);
  });

  it('stores a row the engine does not read unbooked, and never books its control again for it', () => {
    const subTechnique = result(0, { mitreTechniqueId: T1055_012, grain: 'sub_technique' });
    const { wanted, rebooked } = plan([[SCOPE, [subTechnique]]]);

    expect(rebooked.size).toBe(0);
    expect(wanted).toEqual([expect.objectContaining({ mitreTechniqueId: T1055_012, bookedRate: null })]);
  });
});
