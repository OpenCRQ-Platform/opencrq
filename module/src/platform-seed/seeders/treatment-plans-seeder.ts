import { asc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CoverageBucket, StrengthRung } from '../../modules/controls/capability/constants';
import type { SeedContext } from '../platform-seed-registry';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '../../modules/controls/capability/constants';
import { controlCapabilityAssessments } from '../../modules/controls/capability/schema';
import { createPrng, deriveSeed } from '../../modules/crq-indicators/engine/prng';
import { crqIndicatorRuns, crqPlanWhatIfResults } from '../../modules/crq-indicators/schema';
import { riskScenarios } from '../../modules/risk-scenarios/schema';
import { treatmentPlanMoves, treatmentPlans } from '../../modules/treatment-plans/schema';
import {
  Organization_AcmeCorp,
  Organization_AcmeEurope,
  Tenant_Acme,
  TreatmentPlan_HardenIdentity,
  TreatmentPlan_WidenEndpointCoverage,
  treatmentPlanWhatIfId,
  User_Alice,
  User_Bob,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';
import { bandInside, CRQ_ANCHOR_RUN_IDS } from './crq-simulations-seeder';

/**
 * Two risk treatment plans on the demonstration tenant, one per risk scope, each already priced
 * against the anchor run of every simulated scenario of its own scope.
 *
 * The savings are fabricated rather than computed, exactly as the CRQ runs they hang off are: the
 * engine is never called here. What is read from the database is everything a surface joins on, so
 * the moves name real assessed capabilities and the priced rows name real runs.
 */

/** How many capabilities each plan moves, taken from the head of the tenant's assessed set. */
const MOVES_PER_PLAN = 3;

interface PlanSpec {
  readonly id: string,
  readonly organizationId: string,
  readonly name: string,
  readonly status: 'draft' | 'active',
  readonly ownerId: string,
  readonly rationale: string,
  readonly costOneOff: number,
  readonly costRecurringAnnual: number,
  /** Which axis the plan raises on the capabilities it takes, one rung or one bucket. */
  readonly axis: 'strength' | 'coverage',
}

const PLAN_SPECS: ReadonlyArray<PlanSpec> = [
  {
    id: TreatmentPlan_HardenIdentity,
    organizationId: Organization_AcmeCorp,
    name: 'Harden identity controls',
    status: 'active',
    ownerId: User_Alice,
    rationale: 'The identity path carries the two scenarios with the largest exposure, and the controls on it are declared one rung below the rest of the estate.',
    costOneOff: 180_000,
    costRecurringAnnual: 60_000,
    axis: 'strength',
  },
  {
    id: TreatmentPlan_WidenEndpointCoverage,
    organizationId: Organization_AcmeEurope,
    name: 'Widen endpoint coverage',
    status: 'draft',
    ownerId: User_Bob,
    rationale: 'The endpoint controls hold on the servers and cover less than half the workstation fleet, which is where the ransomware scenarios land.',
    costOneOff: 95_000,
    costRecurringAnnual: 140_000,
    axis: 'coverage',
  },
];

const nextRung = (rung: StrengthRung): StrengthRung =>
  STRENGTH_RUNGS[Math.min(STRENGTH_RUNGS.indexOf(rung) + 1, STRENGTH_RUNGS.length - 1)];

const nextBucket = (bucket: CoverageBucket): CoverageBucket =>
  COVERAGE_BUCKETS[Math.min(COVERAGE_BUCKETS.indexOf(bucket) + 1, COVERAGE_BUCKETS.length - 1)];

const between = (prng: () => number, min: number, max: number): number => min + (max - min) * prng();

registerPlatformSeed('treatment-plans', async ({ db, now }: SeedContext) => {
  const assessments = await db
    .select()
    .from(controlCapabilityAssessments)
    .where(eq(controlCapabilityAssessments.tenantId, Tenant_Acme))
    .orderBy(asc(controlCapabilityAssessments.capabilityId));
  const runs = await db
    .select({
      id: crqIndicatorRuns.id,
      aleMean: crqIndicatorRuns.aleMean,
      organizationId: riskScenarios.organizationId,
    })
    .from(crqIndicatorRuns)
    .innerJoin(riskScenarios, eq(crqIndicatorRuns.riskScenarioId, riskScenarios.id))
    .where(inArray(crqIndicatorRuns.id, [...CRQ_ANCHOR_RUN_IDS]))
    .orderBy(asc(crqIndicatorRuns.id));
  if (assessments.length === 0) {
    throw new Error('[platform-seed] the treatment plans need the demo tenant to declare a posture first');
  }

  for (const [planIndex, spec] of PLAN_SPECS.entries()) {
    const prng = createPrng(deriveSeed(spec.id, 'platform-seed-plan'));
    const moved = assessments.slice(planIndex * MOVES_PER_PLAN, (planIndex + 1) * MOVES_PER_PLAN);
    const whatIfRows = runs.filter((run) => run.organizationId === spec.organizationId).map((run, runIndex) => {
      const reduction = run.aleMean === null ? null : run.aleMean * between(prng, 0.06, 0.24);
      const low = reduction === null ? null : reduction * between(prng, 0.25, 0.75);
      const high = reduction === null ? null : reduction * between(prng, 1.3, 2.9);
      const band = reduction === null || low === null || high === null ? null : bandInside(low, reduction, high);
      return {
        id: treatmentPlanWhatIfId(planIndex, runIndex),
        runId: run.id,
        planId: spec.id,
        // The plan and its rows are written here in one pass, so the version they agree on is the
        // column default. A reader comparing the two must find them equal or the demo reads stale.
        planScopeVersion: 1,
        aleReductionMean: reduction,
        aleReductionP10: band?.p10 ?? null,
        aleReductionP90: band?.p90 ?? null,
      };
    });
    const promised = whatIfRows.reduce((total, row) => total + (row.aleReductionMean ?? 0), 0);

    await db.insert(treatmentPlans).values({
      id: spec.id,
      organizationId: spec.organizationId,
      name: spec.name,
      status: spec.status,
      ownerId: spec.ownerId,
      startDate: new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
      endDate: new Date(now.getTime() + 150 * 86_400_000).toISOString().slice(0, 10),
      rationale: spec.rationale,
      costOneOff: spec.costOneOff,
      costRecurringAnnual: spec.costRecurringAnnual,
      // The promise is frozen at activation and never re-stamped, so only the active plan carries
      // one. A plan showing a status it could not have a promise for is the state to avoid.
      promisedAleReduction: spec.status === 'active' ? promised : null,
      promisedAt: spec.status === 'active' ? new Date(now.getTime() - 30 * 86_400_000) : null,
      createdAt: new Date(now.getTime() - (60 - planIndex) * 86_400_000),
      updatedAt: new Date(now.getTime() - (60 - planIndex) * 86_400_000),
    });

    await db.insert(treatmentPlanMoves).values(moved.map((assessment) => ({
      id: uuidv7(),
      planId: spec.id,
      capabilityId: assessment.capabilityId,
      targetStrengthRung: spec.axis === 'strength' ? nextRung(assessment.strengthRung) : null,
      targetCoverageBucket: spec.axis === 'coverage' ? nextBucket(assessment.coverageBucket) : null,
    })));

    if (whatIfRows.length > 0) {
      await db.insert(crqPlanWhatIfResults).values(whatIfRows);
    }
  }
}, 'history');
