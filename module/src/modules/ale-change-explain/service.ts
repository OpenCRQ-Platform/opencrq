import { includesFolded } from '@app/utils';
import type { InferRepository } from '../../registry';
import type { CategoryResolverInput, ChangeCategoryKey, ChangeEvent, ChangeGroupKind, ChangeGroupRow, ChangeGroupSort, ChangeTab, ComparedRun, WindowRun } from './types';
import type { GroupMember } from './categories/groups';
import { defineService } from '../../registry';
import { UNIQUE_SCORE_HISTORY_RETENTION_DAYS } from '../finding-score/retention';
import { resolveAssetChanges } from './categories/asset-posture';
import { resolveCveChanges } from './categories/findings';
import { magnitudeOf, susceptibilityOf, tefOf } from './categories/run-results';
import { changeKindOf, groupEvents, groupRowOf, isGrouped, recordedTime, sortedBy } from './categories/groups';
import { CHANGE_CATEGORIES } from './categories/registry';
import { roundFigure } from './change-values';
import { aleChangeExplainRepository } from './repository';

interface RunSummary {
  id: string,
  createdAt: Date,
  readAt: Date,
}

export interface RunChanges {
  before: RunSummary,
  after: RunSummary,
  /** The runs strictly between the two compared that an event hangs on, oldest first. */
  runs: Array<RunSummary>,
  categories: Array<{ key: ChangeCategoryKey, tabs: Array<ChangeTab> }>,
  events: Array<ChangeEvent>,
}

export interface RunChangeGroupPage {
  rows: Array<ChangeGroupRow>,
  /** Its items matching the search, across every page. */
  total: number,
}

interface ComparedRuns {
  riskScenarioId: string,
  firstRunId: string,
  secondRunId: string,
}

const DAY_MS = 86_400_000;

const ASSET_GROUP_KINDS: ReadonlySet<ChangeGroupKind> = new Set(['first-measured', 'posture-moved']);

const CATEGORY_ORDER = new Map(CHANGE_CATEGORIES.map((category, index) => [category.key, index]));

const MOMENT_ORDER: Record<ChangeEvent['moment']['kind'], number> = { recorded: 0, run: 1, balance: 2 };

const windowSummary = (run: WindowRun): RunSummary => ({ id: run.id, createdAt: run.createdAt, readAt: run.readAt ?? run.createdAt });

const summary = ({ run, readAt }: ComparedRun): RunSummary => ({ id: run.id, createdAt: run.createdAt, readAt });

/** `undefined` when either run is not one of the scenario's. */
const compare = async (repo: InferRepository<typeof aleChangeExplainRepository>, params: ComparedRuns): Promise<CategoryResolverInput | undefined> => {
  const runIds = [...new Set([params.firstRunId, params.secondRunId])];
  if (runIds.length !== 2) {
    return undefined;
  }
  const [runs, shares] = await Promise.all([
    repo.findScenarioRuns(params.riskScenarioId, runIds),
    repo.findGroupSharesByRunIds(runIds),
  ]);
  if (runs.length !== 2) {
    return undefined;
  }
  const [before, after] = runs
    .map((run): ComparedRun => ({
      run: { ...run, groupScores: shares.filter((share) => share.runId === run.id) },
      readAt: run.readAt ?? run.createdAt,
    }))
    .toSorted((a, b) => a.run.createdAt.getTime() - b.run.createdAt.getTime());
  const window = await repo.findScenarioRunsBetween(params.riskScenarioId, before.run.createdAt, after.run.createdAt);
  const uniqueScoreHistoryStart = new Date(Date.now() - UNIQUE_SCORE_HISTORY_RETENTION_DAYS * DAY_MS);
  return { riskScenarioId: params.riskScenarioId, before, after, window, uniqueScoreHistoryStart, repo };
};

export const aleChangeExplainService = defineService('aleChangeExplain', aleChangeExplainRepository).implement({
  /**
   * One point per run of the scenario, newest first: what each tab of the page plots, so the page
   * draws its curve without the rest of each run's columns. `susceptibility` is a fraction of the loss event's price.
   */
  getRunCurve: async ({ repo }, riskScenarioId: string) =>
    (await repo.findScenarioRunCurve(riskScenarioId)).map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      ale: run.aleMean === null ? null : roundFigure(run.aleMean),
      tef: tefOf(run),
      susceptibility: susceptibilityOf(run),
      magnitude: magnitudeOf(run),
    })),

  /**
   * Everything that differs between two runs of one scenario, the earlier one being "before"
   * whichever order they are given in. `undefined` when either is not a run of that scenario.
   * Findings and assets come as groups placed on the calendar days of `timeZone`, the reader's.
   * `techniqueCoverage` is the backend's `technique-coverage-changes` flag, which the module cannot read.
   */
  getRunChanges: async ({ repo }, params: ComparedRuns & { timeZone: string }, options: { techniqueCoverage: boolean }): Promise<RunChanges | undefined> => {
    const input = await compare(repo, params);
    if (input === undefined) {
      return undefined;
    }
    const { before, after, window } = input;

    const categories = CHANGE_CATEGORIES.filter((category) => options.techniqueCoverage || category.key !== 'technique-coverage');
    // Categories sharing a resolver are read once, each of its events naming its own category.
    const resolvers = new Set(categories.map((category) => category.resolve));
    const resolved = (await Promise.all([...resolvers].map((resolve) => resolve(input)))).flat();
    const listed = resolved.filter((event) => !isGrouped(event.category));

    const readAtOf = new Map(window.map((run) => [run.id, windowSummary(run).readAt.getTime()]));
    const hung = new Set(listed.flatMap(({ moment }) => (moment.kind === 'run' ? [moment.runId] : [])));
    const drawnRuns = window.filter((run) => hung.has(run.id) && run.id !== before.run.id && run.id !== after.run.id).map(windowSummary);
    const grouped = groupEvents(
      resolved.filter((event) => isGrouped(event.category)),
      drawnRuns.map((run) => run.readAt.getTime()),
      params.timeZone,
    );

    const momentTime = ({ moment }: ChangeEvent): number => {
      switch (moment.kind) {
        case 'recorded':
          return Date.parse(moment.at);
        case 'run':
          return readAtOf.get(moment.runId) ?? after.readAt.getTime();
        case 'balance':
          return Number.POSITIVE_INFINITY;
        default:
          return moment satisfies never;
      }
    };
    // A change recorded at a run's reading time was read by that run, so it precedes the run's node.
    const byChronology = (a: ChangeEvent, b: ChangeEvent): number =>
      momentTime(a) - momentTime(b)
      || MOMENT_ORDER[a.moment.kind] - MOMENT_ORDER[b.moment.kind]
      || (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0);

    return {
      before: summary(before),
      after: summary(after),
      runs: drawnRuns,
      categories: categories.map((category) => ({ key: category.key, tabs: [...category.tabs] })),
      events: [...listed, ...grouped].toSorted(byChronology),
    };
  },

  /**
   * One page of a group of findings or assets: its items of that category and change kind recorded
   * from `from` to `to`, both included, whose name holds `search`, in the order of `sort`. Without
   * one, CVEs come the most assets first, assets by posture descending.
   */
  getRunChangeGroup: async ({ repo }, params: ComparedRuns & { category: ChangeCategoryKey, kind: ChangeGroupKind, from: Date, to: Date, search: string, sort: ChangeGroupSort | null, offset: number, limit: number }): Promise<RunChangeGroupPage | undefined> => {
    const input = await compare(repo, params);
    if (input === undefined) {
      return undefined;
    }
    const from = params.from.getTime();
    const to = params.to.getTime();
    const touched = { from: params.from, to: params.to };
    const ofAssets = ASSET_GROUP_KINDS.has(params.kind);
    const candidates: Array<GroupMember> = ofAssets
      ? (await resolveAssetChanges(input, touched)).map((event) => ({ event, assets: null }))
      : await resolveCveChanges(input, touched);
    const members = candidates
      .filter(({ event }) => {
        const at = recordedTime(event);
        return event.category === params.category && changeKindOf(event) === params.kind && at >= from && at <= to
          && includesFolded(event.item.label, params.search);
      })
      .toSorted(sortedBy(params.kind, params.sort ?? { by: ofAssets ? 'band' : 'assets', desc: true }));
    return {
      rows: members.slice(params.offset, params.offset + params.limit).map((member) => groupRowOf(member, params.kind)),
      total: members.length,
    };
  },
});
