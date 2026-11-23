import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { TreatmentPlanStatus } from './constants';
import type { PlanProjectionScenario } from './plan-projection';
import type { ScenarioReadinessStatus } from '../risk-scenarios/readiness';
import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import { controlCapabilityService } from '../controls/capability/service';
import { defineService } from '../../registry';
import { riskScenariosService } from '../risk-scenarios/service';
import { usersService } from '../users/service';
import { buildPlanCandidates } from './plan-candidates';
import { buildPlanProjection, scenariosToReprice, summarisePlanTotals } from './plan-projection';
import { summarisePlanReturn } from './plan-return';
import { treatmentPlansRepository } from './repository';

export interface TreatmentPlanValues {
  name: string,
  status?: TreatmentPlanStatus,
  ownerId?: string | null,
  startDate?: string | null,
  endDate?: string | null,
  rationale?: string | null,
  costOneOff?: number | null,
  costRecurringAnnual?: number | null,
}

export interface TreatmentPlanCreateValues extends TreatmentPlanValues {
  organizationId: string,
  moves?: Array<TreatmentPlanCapabilityMove>,
}

/**
 * Every axis is required on every move: a replacement reads a null as no target and an addition
 * as keeping the one on file, so an omitted axis would be ambiguous.
 */
export interface TreatmentPlanMoveTargets {
  targetStrengthRung: StrengthRung | null,
  targetCoverageBucket: CoverageBucket | null,
}

type TreatmentPlanCapabilityMove = { capabilityId: string } & TreatmentPlanMoveTargets;

/** A plan holds one move per capability, so a second move for one capability would silently overwrite the first. */
const refuseInvalidMoves = (moves: Array<TreatmentPlanCapabilityMove>): void => {
  if (moves.some((move) => move.targetStrengthRung === null && move.targetCoverageBucket === null)) {
    throw newError('A treatment plan move must set a target strength or coverage');
  }
  if (new Set(moves.map((move) => move.capabilityId)).size < moves.length) {
    throw newError('A treatment plan takes one move per capability');
  }
};

const toProjectionScenario = (scenario: { id: string, name: string, readiness: { status: ScenarioReadinessStatus } }): PlanProjectionScenario =>
  ({ id: scenario.id, name: scenario.name, readinessStatus: scenario.readiness.status });

export const treatmentPlansService = defineService('treatmentPlans', treatmentPlansRepository)
  .dependsOn(() => [riskScenariosService, controlCapabilityService, usersService])
  .implement({
    /** The moves land in the plan's own transaction, so a failed save leaves no plan behind to be created twice. */
    createTreatmentPlan: async ({ atomic }, { moves, ...values }: TreatmentPlanCreateValues) => {
      refuseInvalidMoves(moves ?? []);
      const id = uuidv7();
      await atomic(async ({ repo, deps }) => {
        await deps.users.refuseOwnerOutsideTenant(values.ownerId);
        await repo.insertTreatmentPlan({ ...values, id });
        for (const move of moves ?? []) {
          await repo.upsertTreatmentPlanMove({ ...move, id: uuidv7(), planId: id });
        }
      });
      return id;
    },

    /**
     * The readiness is the same one the plan's own page reads, for the same span of scopes the list
     * was asked for: a total summed on a rule of its own is a second answer to the question the
     * page already answers.
     */
    getTreatmentPlans: async ({ repo, deps }, organizationId?: string) => {
      const plans = await repo.findTreatmentPlans(organizationId);
      if (plans.length === 0) {
        return [];
      }
      const planIds = plans.map((plan) => plan.id);
      const [moves, totalRows, scenarios] = await Promise.all([
        repo.findMovesByPlanIds(planIds),
        repo.findPlanTotalRows(planIds),
        deps.riskScenarios.getRiskScenariosReadiness(organizationId),
      ]);
      const totals = summarisePlanTotals(
        totalRows,
        new Map(plans.map((plan) => [plan.id, plan.scopeVersion])),
        new Set(scenarios.filter((scenario) => scenario.readiness.status === 'ready').map((scenario) => scenario.id)),
      );
      return plans.map((plan) => {
        const total = totals.get(plan.id) ?? { totalAleReduction: null, expired: false, pricedAt: null };
        return {
          ...plan,
          moves: moves.filter((move) => move.planId === plan.id),
          ...total,
          ...summarisePlanReturn(total.totalAleReduction, plan),
        };
      });
    },

    getTreatmentPlan: async ({ repo }, id: string) => {
      const plan = await repo.findTreatmentPlanById(id);
      if (!plan) {
        return undefined;
      }
      return { ...plan, moves: await repo.findMovesByPlanIds([id]) };
    },

    /**
     * The moves alone, for a plan id the caller names. It does not read the plan first: the moves
     * are policed through their own derived policy, so a plan of another tenant yields nothing here
     * without the read ever depending on the plan's own filter.
     */
    getTreatmentPlanMoves: async ({ repo }, planId: string) => await repo.findMovesByPlanIds([planId]),

    /**
     * The plan's before/after over its scope, and what the total leaves out.
     *
     * The scenarios carry the readiness the risk scenarios list shows: a scenario whose inputs moved
     * after its last run has a figure that no longer describes it, and the page has to say so rather
     * than show it.
     */
    getTreatmentPlanProjection: async ({ repo, deps }, planId: string) => {
      const plan = await repo.findTreatmentPlanById(planId);
      if (!plan) {
        return undefined;
      }
      const [scenarios, rows] = await Promise.all([
        deps.riskScenarios.getRiskScenariosReadiness(plan.organizationId),
        repo.findPlanProjectionRows(planId, plan.organizationId),
      ]);
      const projection = buildPlanProjection(scenarios.map(toProjectionScenario), rows, plan.scopeVersion);
      return { ...projection, ...summarisePlanReturn(projection.totalAleReduction, plan) };
    },

    /** Read on the projection the plan's page shows, so the page and its re-simulation agree on what is stale. */
    getTreatmentPlanSimulationScope: async ({ repo, deps }, planId: string) => {
      const plan = await repo.findTreatmentPlanById(planId);
      if (!plan) {
        return undefined;
      }
      const [scenarios, rows, moves] = await Promise.all([
        deps.riskScenarios.getRiskScenariosReadiness(plan.organizationId),
        repo.findPlanProjectionRows(planId, plan.organizationId),
        repo.findMovesByPlanIds([planId]),
      ]);
      const projection = buildPlanProjection(scenarios.map(toProjectionScenario), rows, plan.scopeVersion);
      const hasMoves = moves.length > 0;
      return {
        // No run prices a plan without a move, so a run in flight on its scope is not one it waits on.
        riskScenarioIds: hasMoves ? projection.scenarios.map((scenario) => scenario.riskScenarioId) : [],
        toReprice: scenariosToReprice(projection, hasMoves),
      };
    },

    /**
     * The posture comes from the scope overlay and never from the capability's own assessment,
     * which is the tenant's. The run prices a move against the scope's rung, and a target is a
     * commitment rather than a floor, so a menu built on the tenant's rung can offer as a gain what
     * the engine then books as a downgrade.
     */
    getTreatmentPlanCandidates: async ({ repo, deps }, planId: string) => {
      const plan = await repo.findTreatmentPlanById(planId);
      if (!plan) {
        return undefined;
      }
      const [capabilities, postures, moves, leverRows] = await Promise.all([
        deps.controlCapabilities.getControlCapabilities(),
        deps.controlCapabilities.getResolvedPosture(plan.organizationId),
        repo.findMovesByPlanIds([planId]),
        repo.findScopeSingleLeverRows(plan.organizationId),
      ]);
      return buildPlanCandidates(
        capabilities,
        moves,
        leverRows,
        new Map(postures.map((posture) => [posture.capabilityId, posture])),
      );
    },

    /**
     * The candidates of a scope no plan names yet, as `getTreatmentPlanCandidates` reads them for
     * a plan with no move. Undefined for a scope the caller cannot read.
     */
    getScopeTreatmentPlanCandidates: async ({ repo, deps }, organizationId: string) => {
      if (!await repo.findOrganizationById(organizationId)) {
        return undefined;
      }
      const [capabilities, postures, leverRows] = await Promise.all([
        deps.controlCapabilities.getControlCapabilities(),
        deps.controlCapabilities.getResolvedPosture(organizationId),
        repo.findScopeSingleLeverRows(organizationId),
      ]);
      return buildPlanCandidates(
        capabilities,
        [],
        leverRows,
        new Map(postures.map((posture) => [posture.capabilityId, posture])),
      );
    },

    /**
     * A policy-filtered update is a zero-row statement that returns normally, so without this read
     * an unknown id and another tenant's plan would both answer "updated successfully".
     */
    updateTreatmentPlan: async ({ atomic, repo }, id: string, values: Partial<TreatmentPlanValues>) => {
      if (!await repo.findTreatmentPlanById(id)) {
        throw newError('Treatment plan not found');
      }
      await atomic(async ({ repo: atomicRepo, deps }) => {
        await deps.users.refuseOwnerOutsideTenant(values.ownerId);
        await atomicRepo.updateTreatmentPlan(id, values);
      });
    },

    deleteTreatmentPlans: async ({ repo }, ids: Array<string>) => await repo.deleteTreatmentPlans(ids),

    /**
     * One save of the drawer: the checked controls take their targets and the ones dropped since it
     * opened leave the plan. It runs as one transaction so a half-applied set never reaches a run,
     * which would price a posture nobody asked for, and it takes the plan's lock before reading:
     * two saves that both read the set before either commits each drop only what they saw, so a
     * control one of them adds survives the other's replacement and the plan lands on neither
     * submitted set.
     */
    setTreatmentPlanScope: async (
      { atomic },
      planId: string,
      targetsByCapability: Array<TreatmentPlanCapabilityMove>,
    ) => {
      refuseInvalidMoves(targetsByCapability);
      await atomic(async ({ repo }) => {
        await repo.lockTreatmentPlansForUpdate([planId]);
        const kept = new Set(targetsByCapability.map((move) => move.capabilityId));
        const existing = await repo.findMovesByPlanIds([planId]);
        const dropped = existing.filter((move) => !kept.has(move.capabilityId)).map((move) => move.id);
        if (dropped.length > 0) {
          await repo.deleteTreatmentPlanMoves(dropped);
        }
        for (const move of targetsByCapability) {
          await repo.upsertTreatmentPlanMove({
            id: uuidv7(),
            planId,
            capabilityId: move.capabilityId,
            targetStrengthRung: move.targetStrengthRung,
            targetCoverageBucket: move.targetCoverageBucket,
          });
        }
        await repo.bumpTreatmentPlanScopeVersion([planId]);
      });
    },

    /**
     * A control already in the plan keeps its one move, and each axis a new move leaves null keeps
     * the target on file. Refused for a plan the caller cannot read, for the reason
     * `updateTreatmentPlan` gives.
     */
    addTreatmentPlanMoves: async ({ atomic, repo }, planId: string, moves: Array<TreatmentPlanCapabilityMove>) => {
      refuseInvalidMoves(moves);
      if (!await repo.findTreatmentPlanById(planId)) {
        throw newError('Treatment plan not found');
      }
      await atomic(async ({ repo: atomicRepo }) => {
        await atomicRepo.lockTreatmentPlansForUpdate([planId]);
        const held = new Map((await atomicRepo.findMovesByPlanIds([planId])).map((move) => [move.capabilityId, move]));
        for (const move of moves) {
          const existing = held.get(move.capabilityId);
          await atomicRepo.upsertTreatmentPlanMove({
            id: uuidv7(),
            planId,
            capabilityId: move.capabilityId,
            targetStrengthRung: move.targetStrengthRung ?? existing?.targetStrengthRung ?? null,
            targetCoverageBucket: move.targetCoverageBucket ?? existing?.targetCoverageBucket ?? null,
          });
        }
        await atomicRepo.bumpTreatmentPlanScopeVersion([planId]);
      });
    },
  });
