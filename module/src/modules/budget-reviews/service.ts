import { StructuredError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { BudgetLineNature, BudgetReviewStatus } from './constants';
import type { BudgetReviewFigure, BudgetReviewFigures, ReviewLineSpend } from './review-figures';
import type { PostureValue, PricedReview, ReviewPricing } from './review-baskets';
import type { ResolvedPosture } from '../controls/capability/scope-posture';
import type { ScenarioReadinessStatus } from '../risk-scenarios/readiness';
import type { InferRepository } from '../../registry';
import type { PostureMove } from './review-build-history';
import { defineService } from '../../registry';
import { controlCapabilityService } from '../controls/capability/service';
import { dashboardService } from '../dashboard/service';
import { samePosture } from '../controls/capability/posture-at-date';
import { riskScenariosService } from '../risk-scenarios/service';
import { budgetReviewsRepository } from './repository';
import { composeReviewPricing } from './review-baskets';
import { buildHistoryOf, buildMoveDays, endOfDay } from './review-build-history';
import { lineCsfFunctions } from './review-csf';
import { buildReviewFigures, figureKey, figureSpendOf, reviewFigureSlots } from './review-figures';
import { isReviewPeriodStart, reviewPeriodBounds, reviewPeriodEnd } from './review-period';
import { approximationPricedAt, reviewWindowDays, scopeRiskSeries } from './review-risk-series';
import { buildReviewTolerance, closedReviewToleranceOf, closedToleranceColumnsOf, toleranceReferenceOf } from './review-tolerance';

export class BudgetReviewNotFoundError extends StructuredError {
  override readonly name: string = 'BudgetReviewNotFoundError';

  constructor() {
    super('This budget review does not exist', { data: {} });
  }
}

export class BudgetReviewClosedError extends StructuredError {
  override readonly name: string = 'BudgetReviewClosedError';

  constructor() {
    super('This budget review is closed and can no longer change', { data: {} });
  }
}

export class BudgetReviewNotClosedError extends StructuredError {
  override readonly name: string = 'BudgetReviewNotClosedError';

  constructor() {
    super('Only a closed budget review can be reopened', { data: {} });
  }
}

export class BudgetReviewNotPricedError extends StructuredError {
  override readonly name: string = 'BudgetReviewNotPricedError';

  constructor() {
    super('A budget review can be closed only once every figure is priced', { data: {} });
  }
}

export class BudgetReviewOutdatedError extends StructuredError {
  override readonly name: string = 'BudgetReviewOutdatedError';

  constructor() {
    super('A budget review can be closed only once no scenario changed since its figures were priced', { data: {} });
  }
}

export class BudgetReviewInvalidInputError extends StructuredError {
  override readonly name: string = 'BudgetReviewInvalidInputError';

  constructor(reason: string) {
    super(reason, { data: {} });
  }
}

export interface BudgetReviewValues {
  name: string,
  ownerId?: string | null,
  context?: string | null,
}

export interface BudgetReviewCreateValues extends BudgetReviewValues {
  organizationId: string,
  /** The first day of a month, as `YYYY-MM-DD`. */
  periodStart: string,
}

export type BudgetReviewUpdateValues = Partial<Omit<BudgetReviewCreateValues, 'organizationId'>>;

export interface BudgetReviewLineValues {
  name: string,
  nature: BudgetLineNature,
  amountSpent: number,
  /** Kept on a build line alone: a run line stores null whatever it is given. */
  amortizationYears?: number | null,
  capabilityIds: Array<string>,
}

type Repo = InferRepository<typeof budgetReviewsRepository>;

const PERIOD_START_RULE = 'A budget review covers the twelve months from the first day of a month between January 2000 and the current month';

const withPeriodEnd = <R extends { periodStart: string }>(review: R) => ({ ...review, periodEnd: reviewPeriodEnd(review.periodStart) });

const postureValueOf = (posture: ResolvedPosture | undefined): PostureValue => ({
  strengthRung: posture?.strengthRung ?? 'L0',
  coverageBucket: posture?.coverageBucket ?? 'L0',
});

const refuseClosed = (review: { status: BudgetReviewStatus } | undefined): void => {
  if (!review) {
    throw new BudgetReviewNotFoundError();
  }
  if (review.status === 'closed') {
    throw new BudgetReviewClosedError();
  }
};

const refuseOwnerOutsideTenant = async (repo: Repo, ownerId: string | null | undefined): Promise<void> => {
  if (ownerId != null && !await repo.findTenantMemberById(ownerId)) {
    throw new BudgetReviewInvalidInputError('The owner is not a member of this tenant');
  }
};

/**
 * One control's move belongs to one build line at most: two lines claiming the same upgrade would
 * both be paid for it. Read under the review's lock, so two concurrent saves cannot both pass.
 */
const refuseSharedMoves = async (repo: Repo, reviewId: string, line: { id: string, nature: BudgetLineNature, capabilityIds: Array<string> }): Promise<void> => {
  if (new Set(line.capabilityIds).size < line.capabilityIds.length) {
    throw new BudgetReviewInvalidInputError('A budget line names each control once');
  }
  const known = await repo.findCapabilities(line.capabilityIds);
  if (known.length < line.capabilityIds.length) {
    throw new BudgetReviewInvalidInputError('A budget line names a control that does not exist');
  }
  if (line.nature !== 'build') {
    return;
  }
  const lines = await repo.findLinesByReviewIds([reviewId]);
  const controls = await repo.findLineControlsByReviewIds([reviewId]);
  const otherBuildLines = new Set(lines.filter((other) => other.nature === 'build' && other.id !== line.id).map((other) => other.id));
  const claimed = new Set(controls.filter((control) => otherBuildLines.has(control.lineId)).map((control) => control.capabilityId));
  if (line.capabilityIds.some((capabilityId) => claimed.has(capabilityId))) {
    throw new BudgetReviewInvalidInputError('A control moves in one build line at most');
  }
};

const linesWithControls = <L extends { id: string }>(lines: ReadonlyArray<L>, controls: ReadonlyArray<{ lineId: string, capabilityId: string }>) =>
  lines.map((line) => ({ ...line, capabilityIds: controls.filter((control) => control.lineId === line.id).map((control) => control.capabilityId) }));

interface ScenarioReadinessRow {
  id: string,
  name: string,
  organizationId: string,
  readiness: { status: ScenarioReadinessStatus },
}

const reviewScenariosOf = (scenarios: ReadonlyArray<ScenarioReadinessRow>, organizationId: string) => scenarios
  .filter((scenario) => scenario.organizationId === organizationId)
  .map((scenario) => ({ id: scenario.id, name: scenario.name, readinessStatus: scenario.readiness.status }));

/** A closed review answers what was stored at its closing, and nothing it could be repriced to. */
const closedFiguresOf = (
  rows: ReadonlyArray<Awaited<ReturnType<Repo['findClosedFigures']>>[number]>,
  lines: ReadonlyArray<ReviewLineSpend>,
): BudgetReviewFigures => {
  const rowByKey = new Map(rows.map((row) => [figureKey(row.basket, row.lineId), row]));
  return {
    figures: reviewFigureSlots(lines).map((slot) => {
      const { basket, lineId } = slot;
      const row = rowByKey.get(figureKey(basket, lineId));
      const aleReductionMean = row?.aleReductionMean ?? null;
      return {
        basket,
        lineId,
        state: row?.state ?? 'not-priced',
        aleReductionMean,
        aleReductionP10: row?.aleReductionP10 ?? null,
        aleReductionP90: row?.aleReductionP90 ?? null,
        ...figureSpendOf(slot, aleReductionMean),
        pricedScenarioCount: row?.pricedScenarioCount ?? 0,
        pricedAt: row?.pricedAt ?? null,
      };
    }),
    scopeScenarioCount: rows.at(0)?.scopeScenarioCount ?? 0,
    olderThanHeadline: [],
    toReprice: [],
  };
};

const runIdsOf = (rows: ReadonlyArray<{ runId: string }>) => [...new Set(rows.map((row) => row.runId))];

type ReviewRow = NonNullable<Awaited<ReturnType<Repo['findBudgetReviewById']>>>;

/**
 * Each scenario's build gap over the period, on the latest run that priced the review's current
 * version: a line edit expires the earlier ones, which priced other lines. A closed review keeps
 * the ones stored before its closing, and its controls move no later than it closed. `moves` are
 * the days the gap steps on, each with the build work done then.
 */
const buildHistoryOfReview = async (
  repo: Repo,
  controls: { getScopePostureMoves: (organizationId: string, from: Date, to: Date) => Promise<Array<PostureMove>> },
  review: ReviewRow,
) => {
  const { start, end } = reviewPeriodBounds(review.periodStart);
  const movesEnd = review.closedAt !== null && review.closedAt < end ? review.closedAt : end;
  const [lines, lineControls, rows, references, moves] = await Promise.all([
    repo.findLinesByReviewIds([review.id]),
    repo.findLineControlsByReviewIds([review.id]),
    repo.findReviewBuildHistoryRows(review.id, review.version),
    repo.findReviewReferenceMeans(review.id, review.version),
    controls.getScopePostureMoves(review.organizationId, start, movesEnd),
  ]);
  const days = buildMoveDays(lines, lineControls, moves);
  return { scenarios: buildHistoryOf(rows, references, days), moves: days };
};

const buildFigureOf = (figures: BudgetReviewFigures): BudgetReviewFigure => figures.figures.find((figure) => figure.basket === 'build')!;

const headlineOf = (figure: BudgetReviewFigure) => ({
  spent: figure.spent,
  aleReductionMean: figure.aleReductionMean,
  aleReductionP10: figure.aleReductionP10,
  aleReductionP90: figure.aleReductionP90,
  returnPercent: figure.returnPercent,
  state: figure.state,
});

export const budgetReviewsService = defineService('budgetReviews', budgetReviewsRepository)
  .dependsOn(() => [riskScenariosService, controlCapabilityService, dashboardService])
  .implement({
    createBudgetReview: async ({ repo }, values: BudgetReviewCreateValues) => {
      if (!isReviewPeriodStart(values.periodStart)) {
        throw new BudgetReviewInvalidInputError(PERIOD_START_RULE);
      }
      if (!await repo.findOrganizationById(values.organizationId)) {
        throw new BudgetReviewInvalidInputError('This risk scope does not exist');
      }
      await refuseOwnerOutsideTenant(repo, values.ownerId);
      const id = uuidv7();
      await repo.insertBudgetReview({ ...values, id });
      return id;
    },

    /**
     * Each review with its headline: the ensemble figure at the top level (with its `pricedAt`) and the
     * build basket's under `build`, both as `getBudgetReviewFigures` reports them, live while the review
     * is open and as stored at its closing once closed. A review without build lines still carries a
     * `build` figure, never null: it spent nothing and its other fields read as an unpriced basket does.
     * The readiness is the one the review's own page reads, so the list and the page give one answer.
     */
    getBudgetReviews: async ({ repo, deps }, organizationId?: string) => {
      const reviews = await repo.findBudgetReviews(organizationId);
      if (reviews.length === 0) {
        return [];
      }
      const reviewIds = reviews.map((review) => review.id);
      const openIds = reviews.filter((review) => review.status === 'open').map((review) => review.id);
      const closedIds = reviews.filter((review) => review.status === 'closed').map((review) => review.id);
      const [lines, resultRows, closedRows, scenarios] = await Promise.all([
        repo.findLinesByReviewIds(reviewIds),
        openIds.length === 0 ? Promise.resolve([]) : repo.findReviewResultRows(openIds, organizationId),
        closedIds.length === 0 ? Promise.resolve([]) : repo.findClosedFigures(closedIds),
        deps.riskScenarios.getRiskScenariosReadiness(organizationId),
      ]);
      return reviews.map((review) => {
        const reviewLines = lines.filter((line) => line.reviewId === review.id);
        const figures = review.status === 'closed'
          ? closedFiguresOf(closedRows.filter((row) => row.reviewId === review.id), reviewLines)
          : buildReviewFigures(
            reviewScenariosOf(scenarios, review.organizationId),
            resultRows.filter((row) => row.reviewId === review.id),
            review.version,
            reviewLines,
          );
        const ensemble = figures.figures.find((figure) => figure.basket === 'ensemble')!;
        const build = buildFigureOf(figures);
        return {
          ...withPeriodEnd(review),
          lineCount: reviewLines.length,
          ...headlineOf(ensemble),
          pricedAt: ensemble.pricedAt,
          build: headlineOf(build),
        };
      });
    },

    getBudgetReview: async ({ repo }, id: string) => {
      const review = await repo.findBudgetReviewById(id);
      if (!review) {
        return undefined;
      }
      const [lines, controls] = await Promise.all([repo.findLinesByReviewIds([id]), repo.findLineControlsByReviewIds([id])]);
      const crosswalk = await repo.findCsfCrosswalk([...new Set(controls.map((control) => control.capabilityId))]);
      return {
        ...withPeriodEnd(review),
        lines: linesWithControls(lines, controls).map((line) => ({ ...line, csfFunctions: lineCsfFunctions(line.capabilityIds, crosswalk) })),
      };
    },

    /**
     * Refused for a review the caller cannot read: a policy-filtered update is a zero-row statement
     * that returns normally, so an unknown id would otherwise answer "updated successfully".
     */
    updateBudgetReview: async ({ atomic }, id: string, values: BudgetReviewUpdateValues) => {
      if (values.periodStart !== undefined && !isReviewPeriodStart(values.periodStart)) {
        throw new BudgetReviewInvalidInputError(PERIOD_START_RULE);
      }
      await atomic(async ({ repo }) => {
        const [locked] = await repo.lockBudgetReviewsForUpdate([id]);
        refuseClosed(locked);
        await refuseOwnerOutsideTenant(repo, values.ownerId);
        const periodMoved = values.periodStart !== undefined && values.periodStart !== locked.periodStart;
        await repo.updateBudgetReview(id, values);
        if (periodMoved) {
          await repo.bumpBudgetReviewVersion([id]);
        }
      });
    },

    deleteBudgetReviews: async ({ repo }, ids: Array<string>) => await repo.deleteBudgetReviews(ids),

    createBudgetReviewLine: async ({ atomic }, reviewId: string, values: BudgetReviewLineValues) => {
      const id = uuidv7();
      await atomic(async ({ repo }) => {
        const [locked] = await repo.lockBudgetReviewsForUpdate([reviewId]);
        refuseClosed(locked);
        await refuseSharedMoves(repo, reviewId, { id, nature: values.nature, capabilityIds: values.capabilityIds });
        await repo.insertLine({
          id,
          reviewId,
          name: values.name,
          nature: values.nature,
          amountSpent: values.amountSpent,
          amortizationYears: values.nature === 'build' ? values.amortizationYears ?? null : null,
        });
        await repo.insertLineControls(values.capabilityIds.map((capabilityId) => ({ id: uuidv7(), lineId: id, reviewId, capabilityId })));
        await repo.bumpBudgetReviewVersion([reviewId]);
      });
      return id;
    },

    /**
     * The version moves only when what a run prices moves, the nature or the controls, as a plan's
     * scope version does: a renamed line, a corrected spend or its amortization leaves every figure
     * where it was.
     */
    updateBudgetReviewLine: async ({ atomic, repo: readRepo }, lineId: string, values: Partial<BudgetReviewLineValues>) => {
      const [unlocked] = await readRepo.findLinesByIds([lineId]);
      if (!unlocked) {
        throw new BudgetReviewNotFoundError();
      }
      await atomic(async ({ repo }) => {
        const [locked] = await repo.lockBudgetReviewsForUpdate([unlocked.reviewId]);
        refuseClosed(locked);
        // Only the review id, which never changes, is safe to take from before the lock.
        const [line] = await repo.findLinesByIds([lineId]);
        if (!line) {
          throw new BudgetReviewNotFoundError();
        }
        const controls = (await repo.findLineControlsByReviewIds([line.reviewId])).filter((control) => control.lineId === lineId);
        const nature = values.nature ?? line.nature;
        const capabilityIds = values.capabilityIds ?? controls.map((control) => control.capabilityId);
        await refuseSharedMoves(repo, line.reviewId, { id: lineId, nature, capabilityIds });
        const { capabilityIds: _replaced, ...lineValues } = values;
        if (nature === 'run') {
          lineValues.amortizationYears = null;
        }
        if (Object.keys(lineValues).length > 0) {
          await repo.updateLine(lineId, lineValues);
        }
        const held = new Set(controls.map((control) => control.capabilityId));
        const controlsMoved = values.capabilityIds !== undefined
          && (values.capabilityIds.length !== held.size || values.capabilityIds.some((capabilityId) => !held.has(capabilityId)));
        if (controlsMoved) {
          await repo.deleteLineControls(lineId);
          await repo.insertLineControls(capabilityIds.map((capabilityId) => ({ id: uuidv7(), lineId, reviewId: line.reviewId, capabilityId })));
        }
        if (controlsMoved || nature !== line.nature) {
          await repo.bumpBudgetReviewVersion([line.reviewId]);
        }
      });
    },

    deleteBudgetReviewLines: async ({ atomic, repo: readRepo }, lineIds: Array<string>) => {
      const lines = await readRepo.findLinesByIds(lineIds);
      if (lines.length === 0) {
        return;
      }
      const reviewIds = [...new Set(lines.map((line) => line.reviewId))];
      await atomic(async ({ repo }) => {
        const locked = await repo.lockBudgetReviewsForUpdate(reviewIds);
        if (locked.some((review) => review.status === 'closed')) {
          throw new BudgetReviewClosedError();
        }
        await repo.deleteLines(lines.map((line) => line.id));
        await repo.bumpBudgetReviewVersion(reviewIds);
      });
    },

    /**
     * Each control's posture at the start and at the end of the review's period (today's while the
     * period runs), for every control that moved during the period, that a line funds or that
     * `including` names. A closed review answers the postures stored at its closing. `periodEnd` is
     * the last day covered.
     *
     * `logStartsAt` is when the posture history begins, read live even once the review is closed.
     * When it begins after the period's start the start posture of a control is the one it held
     * before its first logged change, which is all the history can say.
     */
    getBudgetReviewControlPostures: async ({ repo, deps }, reviewId: string, including: ReadonlyArray<string> = []) => {
      const review = await repo.findBudgetReviewById(reviewId);
      if (!review) {
        return undefined;
      }
      const [lines, controls, capabilities] = await Promise.all([
        repo.findLinesByReviewIds([reviewId]),
        repo.findLineControlsByReviewIds([reviewId]),
        repo.findCapabilities(),
      ]);
      const { start, end } = reviewPeriodBounds(review.periodStart);
      let postures: Map<string, { start: PostureValue, end: PostureValue }>;
      let logStartsAt: Date | null;
      if (review.status === 'closed') {
        const [stored, logStart] = await Promise.all([
          repo.findClosedPostures(reviewId),
          deps.controlCapabilities.getScopePostureLogStart(review.organizationId),
        ]);
        logStartsAt = logStart;
        postures = new Map(stored.map((row) => [row.capabilityId, {
          start: { strengthRung: row.startStrengthRung, coverageBucket: row.startCoverageBucket },
          end: { strengthRung: row.endStrengthRung, coverageBucket: row.endCoverageBucket },
        }]));
      } else {
        const history = await deps.controlCapabilities.getScopePostureAt(review.organizationId, [start, end]);
        const [atStart, atEnd] = history.postures;
        logStartsAt = history.logStartsAt;
        postures = new Map(capabilities.map((capability) => [capability.id, {
          start: postureValueOf(atStart.get(capability.id)),
          end: postureValueOf(atEnd.get(capability.id)),
        }]));
      }
      const lineById = new Map(lines.map((line) => [line.id, line]));
      const listed = new Set([...controls.map((control) => control.capabilityId), ...including]);
      return {
        periodStart: review.periodStart,
        periodEnd: reviewPeriodEnd(review.periodStart),
        logStartsAt,
        logCoversPeriodStart: logStartsAt !== null && logStartsAt <= start,
        controls: capabilities.flatMap((capability) => {
          const posture = postures.get(capability.id);
          if (posture === undefined) {
            return [];
          }
          const moved = !samePosture(posture.start, posture.end);
          if (!moved && !listed.has(capability.id)) {
            return [];
          }
          const fundingLines = controls
            .filter((control) => control.capabilityId === capability.id)
            .flatMap((control) => lineById.get(control.lineId) ?? []);
          const buildLine = fundingLines.find((line) => line.nature === 'build');
          return [{
            capabilityId: capability.id,
            externalId: capability.externalId,
            name: capability.name,
            start: posture.start,
            end: posture.end,
            moved,
            buildLine: buildLine === undefined ? null : { id: buildLine.id, name: buildLine.name },
            runLines: fundingLines.filter((line) => line.nature === 'run').map((line) => ({ id: line.id, name: line.name })),
          }];
        }),
      };
    },

    /** The review's figures over its scope: live while it is open, as stored at its closing once closed. */
    getBudgetReviewFigures: async ({ repo, deps }, reviewId: string) => {
      const review = await repo.findBudgetReviewById(reviewId);
      if (!review) {
        return undefined;
      }
      const lines = await repo.findLinesByReviewIds([reviewId]);
      if (review.status === 'closed') {
        return {
          status: review.status,
          closedAt: review.closedAt,
          ...closedFiguresOf(await repo.findClosedFigures([reviewId]), lines),
          olderThanHeadlineNames: [],
        };
      }
      const [readiness, rows] = await Promise.all([
        deps.riskScenarios.getRiskScenariosReadiness(review.organizationId),
        repo.findReviewResultRows([reviewId], review.organizationId),
      ]);
      const scenarios = reviewScenariosOf(readiness, review.organizationId);
      const figures = buildReviewFigures(scenarios, rows, review.version, lines);
      const older = new Set(figures.olderThanHeadline);
      return {
        status: review.status,
        closedAt: review.closedAt,
        ...figures,
        olderThanHeadlineNames: scenarios.filter((scenario) => older.has(scenario.id)).map((scenario) => scenario.name),
      };
    },

    /**
     * Each scenario of the scope at the review's reference posture and without the period's build
     * work, against the tolerance it applies: today's while the review is open, so editing a
     * tolerance needs no simulation, and the one applied at the closing once it is closed. `state` is
     * the `build` figure's, whose run the curves come from.
     */
    getBudgetReviewTolerance: async ({ repo, deps }, reviewId: string) => {
      const review = await repo.findBudgetReviewById(reviewId);
      if (!review) {
        return undefined;
      }
      if (review.status === 'closed') {
        const [lines, closedFigures, closedTolerances] = await Promise.all([
          repo.findLinesByReviewIds([reviewId]),
          repo.findClosedFigures([reviewId]),
          repo.findClosedTolerances(reviewId),
        ]);
        return {
          reference: toleranceReferenceOf(review.periodStart, review.closedAt, new Date()),
          state: buildFigureOf(closedFiguresOf(closedFigures, lines)).state,
          scenarios: closedReviewToleranceOf(closedTolerances),
        };
      }
      const [lines, readiness, rows, tolerances] = await Promise.all([
        repo.findLinesByReviewIds([reviewId]),
        deps.riskScenarios.getRiskScenariosReadiness(review.organizationId),
        repo.findReviewResultRows([reviewId], review.organizationId),
        repo.findScenarioRiskTolerances(review.organizationId),
      ]);
      const annualLossRows = await repo.findReviewAnnualLossRows(reviewId, runIdsOf(rows));
      const scenarios = reviewScenariosOf(readiness, review.organizationId);
      const figures = buildReviewFigures(scenarios, rows, review.version, lines);
      return {
        reference: toleranceReferenceOf(review.periodStart, null, new Date()),
        state: buildFigureOf(figures).state,
        scenarios: buildReviewTolerance(scenarios, tolerances, annualLossRows, review.version, new Set(figures.olderThanHeadline)),
      };
    },

    /**
     * The scope's ALE day by day over the period as far as it has run, and the scope without the
     * period's build work: summed here from each scenario's last run of the day, so the response
     * holds a point per day rather than a series per scenario. It carries the build moves and the run
     * the build steps are priced on, which the chart draws on the same curve.
     */
    getBudgetReviewRiskSeries: async ({ repo, deps }, reviewId: string) => {
      const review = await repo.findBudgetReviewById(reviewId);
      if (!review) {
        return undefined;
      }
      const [scenarios, history] = await Promise.all([
        deps.dashboard.getScenarioAleSeries({
          organizationId: review.organizationId,
          windowDays: reviewWindowDays(review.periodStart, new Date()),
        }),
        buildHistoryOfReview(repo, deps.controlCapabilities, review),
      ]);
      return {
        points: scopeRiskSeries(scenarios, history.scenarios, review.periodStart, reviewPeriodEnd(review.periodStart)),
        moves: history.moves,
        pricedAt: approximationPricedAt(history.scenarios),
      };
    },

    /** Read on the figures the review's page shows, so the page and its re-simulation agree on what is stale. */
    getBudgetReviewSimulationScope: async ({ repo, deps }, reviewId: string) => {
      const review = await repo.findBudgetReviewById(reviewId);
      if (!review) {
        return undefined;
      }
      const scenarios = reviewScenariosOf(await deps.riskScenarios.getRiskScenariosReadiness(review.organizationId), review.organizationId);
      if (review.status === 'closed') {
        return { riskScenarioIds: [], toReprice: [] };
      }
      const [lines, rows] = await Promise.all([
        repo.findLinesByReviewIds([reviewId]),
        repo.findReviewResultRows([reviewId], review.organizationId),
      ]);
      return {
        riskScenarioIds: scenarios.map((scenario) => scenario.id),
        toReprice: buildReviewFigures(scenarios, rows, review.version, lines).toReprice,
      };
    },

    /**
     * Stores the figures, each scenario's tolerance reading and each control's start and end posture,
     * then stops pricing the review. A closed review is never priced again, so a figure expired, not
     * priced, or whose scenario ran again since refuses the closing rather than be
     * frozen. The version is read under the review's lock, so a line edit racing the closing either
     * lands before it, and expires what the closing reads, or is refused after it.
     */
    closeBudgetReview: async ({ atomic }, reviewId: string) => {
      await atomic(async ({ repo, deps }) => {
        const [locked] = await repo.lockBudgetReviewsForUpdate([reviewId]);
        refuseClosed(locked);
        const review = (await repo.findBudgetReviewById(reviewId))!;
        const { start, end } = reviewPeriodBounds(review.periodStart);
        // One transaction runs one statement at a time, so its reads are awaited in turn.
        const lines = await repo.findLinesByReviewIds([reviewId]);
        if (lines.length === 0) {
          throw new BudgetReviewInvalidInputError('A budget review without any budget line cannot be closed');
        }
        const controls = await repo.findLineControlsByReviewIds([reviewId]);
        const rows = await repo.findReviewResultRows([reviewId], review.organizationId);
        const scenarios = await deps.riskScenarios.getRiskScenariosReadiness(review.organizationId);
        const history = await deps.controlCapabilities.getScopePostureAt(review.organizationId, [start, end]);
        const reviewScenarios = reviewScenariosOf(scenarios, review.organizationId);
        const { figures, olderThanHeadline } = buildReviewFigures(reviewScenarios, rows, review.version, lines);
        if (figures.some((figure) => figure.state !== 'priced')) {
          throw new BudgetReviewNotPricedError();
        }
        if (olderThanHeadline.length > 0) {
          throw new BudgetReviewOutdatedError();
        }
        const annualLossRows = await repo.findReviewAnnualLossRows(reviewId, runIdsOf(rows));
        const tolerances = await repo.findScenarioRiskTolerances(review.organizationId);
        await repo.insertClosedFigures(figures.map((figure) => ({
          id: uuidv7(),
          reviewId,
          basket: figure.basket,
          lineId: figure.lineId,
          state: figure.state,
          aleReductionMean: figure.aleReductionMean,
          aleReductionP10: figure.aleReductionP10,
          aleReductionP90: figure.aleReductionP90,
          pricedScenarioCount: figure.pricedScenarioCount,
          scopeScenarioCount: reviewScenarios.length,
          pricedAt: figure.pricedAt,
        })));
        await repo.insertClosedTolerances(buildReviewTolerance(reviewScenarios, tolerances, annualLossRows, review.version, new Set(olderThanHeadline))
          .map((scenario) => ({ id: uuidv7(), reviewId, ...closedToleranceColumnsOf(scenario) })));
        const [atStart, atEnd] = history.postures;
        const funded = new Set(controls.map((control) => control.capabilityId));
        await repo.insertClosedPostures([...atEnd.keys()].flatMap((capabilityId) => {
          const startPosture = postureValueOf(atStart.get(capabilityId));
          const endPosture = postureValueOf(atEnd.get(capabilityId));
          return funded.has(capabilityId) || !samePosture(startPosture, endPosture)
            ? [{
              id: uuidv7(),
              reviewId,
              capabilityId,
              startStrengthRung: startPosture.strengthRung,
              startCoverageBucket: startPosture.coverageBucket,
              endStrengthRung: endPosture.strengthRung,
              endCoverageBucket: endPosture.coverageBucket,
            }]
            : [];
        }));
        await repo.closeBudgetReview(reviewId);
      });
    },

    /**
     * Drops what the closing stored and prices the review again. The version moves so that figures a
     * run stored before the closing read expired: the postures they were priced on may have moved
     * since.
     */
    reopenBudgetReview: async ({ atomic }, reviewId: string) => {
      await atomic(async ({ repo }) => {
        const [locked] = await repo.lockBudgetReviewsForUpdate([reviewId]);
        if (!locked) {
          throw new BudgetReviewNotFoundError();
        }
        if (locked.status !== 'closed') {
          throw new BudgetReviewNotClosedError();
        }
        await repo.deleteClosedFigures(reviewId);
        await repo.deleteClosedPostures(reviewId);
        await repo.deleteClosedTolerances(reviewId);
        await repo.reopenBudgetReview(reviewId);
        await repo.bumpBudgetReviewVersion([reviewId]);
      });
    },

    /**
     * What a run of one of the scope's scenarios prices for its open reviews: the baskets, the
     * differences between them, and the figure each difference is stored as. A closed review is
     * never priced again, its figures having been stored when it closed.
     */
    getBudgetReviewPricing: async ({ repo, deps }, organizationId: string): Promise<ReviewPricing> => {
      const reviews = await repo.findOpenBudgetReviews(organizationId);
      if (reviews.length === 0) {
        return { baskets: [], differences: [], figures: [], exceedances: [] };
      }
      const reviewIds = reviews.map((review) => review.id);
      const periodStarts = [...new Set(reviews.map((review) => review.periodStart))];
      const [lines, controls, moves] = await Promise.all([
        repo.findLinesByReviewIds(reviewIds),
        repo.findLineControlsByReviewIds(reviewIds),
        Promise.all(periodStarts.map((periodStart) => {
          const { start, end } = reviewPeriodBounds(periodStart);
          return deps.controlCapabilities.getScopePostureMoves(organizationId, start, end);
        })),
      ]);
      const movesByPeriod = new Map(periodStarts.map((periodStart, index) => [periodStart, moves[index]]));
      const stepDaysByReview = new Map(reviews.map((review) => [review.id, buildMoveDays(
        lines.filter((line) => line.reviewId === review.id),
        controls,
        movesByPeriod.get(review.periodStart)!,
      ).slice(0, -1)]));
      const stepDates = [...new Set([...stepDaysByReview.values()].flatMap((days) => days.map((day) => day.date)))];
      const history = await deps.controlCapabilities.getScopePostureAt(organizationId, [
        ...periodStarts.flatMap((periodStart) => {
          const { start, end } = reviewPeriodBounds(periodStart);
          return [start, end];
        }),
        ...stepDates.map(endOfDay),
      ]);
      const valuesOf = (postures: Map<string, ResolvedPosture>) =>
        new Map([...postures].map(([capabilityId, posture]) => [capabilityId, postureValueOf(posture)]));
      const postureByPeriod = new Map(periodStarts.map((periodStart, index) => [periodStart, {
        start: valuesOf(history.postures[2 * index]),
        end: valuesOf(history.postures[2 * index + 1]),
      }]));
      const postureByStepDate = new Map(stepDates.map((date, index) => [date, valuesOf(history.postures[2 * periodStarts.length + index])]));
      const priced: Array<PricedReview> = reviews.map((review) => ({
        reviewId: review.id,
        version: review.version,
        lines: linesWithControls(lines.filter((line) => line.reviewId === review.id), controls)
          .map((line) => ({ lineId: line.id, nature: line.nature, capabilityIds: line.capabilityIds })),
        ...postureByPeriod.get(review.periodStart)!,
        steps: stepDaysByReview.get(review.id)!.map((day) => ({ date: day.date, posture: postureByStepDate.get(day.date)! })),
      }));
      return composeReviewPricing(priced, valuesOf(history.current));
    },
  });
