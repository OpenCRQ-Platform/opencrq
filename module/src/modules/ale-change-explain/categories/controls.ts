import type { CoverageBucket, StrengthRung } from '../../controls/capability/constants';
import type { EffectivenessHistoryLine } from '../../controls/capability/effectiveness-history';
import type { CategoryResolverInput, ChangeCategory, ChangeEvent } from '../types';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '../../controls/capability/constants';
import { replayEffectivenessHistory } from '../../controls/capability/effectiveness-history';
import { DEFAULT_COVERAGE_BUCKET, DEFAULT_STRENGTH_RUNG } from '../../controls/capability/scope-posture';

type Repo = CategoryResolverInput['repo'];
type Lever = Awaited<ReturnType<Repo['findControlLeversByRunIds']>>[number];
type AssessmentEvent = Awaited<ReturnType<Repo['findControlAssessmentEvents']>>[number];
type Line = EffectivenessHistoryLine<AssessmentEvent>;

interface Posture {
  strength: StrengthRung,
  coverage: CoverageBucket,
}

type Axis = keyof Posture;

const AXES: ReadonlyArray<Axis> = ['strength', 'coverage'];

const UNASSESSED: Posture = { strength: DEFAULT_STRENGTH_RUNG, coverage: DEFAULT_COVERAGE_BUCKET };

const rank = (axis: Axis, posture: Posture): number => {
  switch (axis) {
    case 'strength':
      return STRENGTH_RUNGS.indexOf(posture.strength);
    case 'coverage':
      return COVERAGE_BUCKETS.indexOf(posture.coverage);
  }
};

const linePosture = (line: Line | undefined): Posture => (
  line?.posture
    ? {
      strength: line.posture.strengthRung,
      coverage: line.posture.coverageBucket,
    }
    : UNASSESSED
);

const postureAt = (lines: ReadonlyArray<Line>, at: Date): Posture =>
  linePosture(lines.findLast((line) => line.at <= at));

/**
 * The journal line between the two reading times that brought the axis to its final value, none for
 * a posture written without its event.
 */
const explainingLine = (lines: ReadonlyArray<Line>, axis: Axis, from: Date, to: Date, final: number): Line | undefined => {
  let explaining: Line | undefined;
  let previous = rank(axis, postureAt(lines, from));
  for (const line of lines) {
    if (line.at <= from || line.at > to) {
      continue;
    }
    const value = rank(axis, linePosture(line));
    if (value !== previous) {
      explaining = value === final ? line : undefined;
    }
    previous = value;
  }
  return explaining;
};

/**
 * Lists the controls either run treated as a lever, by the strength and coverage each run stored for
 * them. A lever of one run only takes its other posture from its journal, replayed inside the
 * scenario's scope at the other run's reading time, and lists nothing when that journal is empty.
 */
export const controlsCategory: ChangeCategory = {
  key: 'controls',
  tabs: ['ale', 'susceptibility'],
  resolve: async ({ riskScenarioId, before, after, repo }) => {
    const [scope, levers] = await Promise.all([
      repo.findScenarioScope(riskScenarioId),
      repo.findControlLeversByRunIds([before.run.id, after.run.id]),
    ]);
    if (scope === undefined || levers.length === 0) {
      return [];
    }
    const leverOf = (runId: string): Map<string, Lever> =>
      new Map(levers.filter((lever) => lever.runId === runId).map((lever) => [lever.controlId, lever]));
    const beforeLevers = leverOf(before.run.id);
    const afterLevers = leverOf(after.run.id);
    const controls = new Map(levers.map((lever) => [lever.controlId, lever.name]));

    const events = await repo.findControlAssessmentEvents([...controls.keys()], scope.organizationId, after.readAt);
    const storedPosture = (lever: Lever | undefined): Posture | undefined =>
      lever && { strength: lever.currentStrength, coverage: lever.currentCoverage };

    return [...controls]
      .toSorted(([, a], [, b]) => a.localeCompare(b))
      .flatMap(([controlId, name]): Array<ChangeEvent> => {
        const journal = events.filter((event) => event.controlId === controlId);
        const lines = replayEffectivenessHistory(journal, null, true, after.readAt).filter((line) => line.event !== null);
        const stored = { before: storedPosture(beforeLevers.get(controlId)), after: storedPosture(afterLevers.get(controlId)) };
        if ((stored.before === undefined || stored.after === undefined) && journal.length === 0) {
          return [];
        }
        const postures = {
          before: { ...postureAt(lines, before.readAt), ...stored.before },
          after: { ...postureAt(lines, after.readAt), ...stored.after },
        };
        return AXES.flatMap((axis): Array<ChangeEvent> => {
          const from = postures.before[axis];
          const to = postures.after[axis];
          if (rank(axis, postures.before) === rank(axis, postures.after)) {
            return [];
          }
          const line = explainingLine(lines, axis, before.readAt, after.readAt, rank(axis, postures.after));
          const onScope = line?.event?.organizationId != null;
          return [{
            category: 'controls',
            moment: line ? { kind: 'recorded', at: line.at.toISOString() } : { kind: 'run', runId: after.run.id },
            direction: rank(axis, postures.after) < rank(axis, postures.before) ? 'up' : 'down',
            item: { kind: 'control', key: `${controlId}/${axis}`, label: name, link: { kind: 'control', controlId } },
            sentence: {
              key: onScope ? `${axis}-changed-on-scope` : `${axis}-changed`,
              parts: {
                control: name,
                from,
                to,
                ...(onScope ? { scope: scope.name } : {}),
              },
            },
            values: null,
          }];
        });
      });
  },
};
