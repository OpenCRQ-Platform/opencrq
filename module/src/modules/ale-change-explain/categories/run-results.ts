import type { ActorClass } from '../../threat-analyses/actor-classes';
import type { ChangeCategory, ChangeDirection, ChangeEvent, ChangeValueFormat, ComparedRun, ComparedRunRow, ScenarioTab } from '../types';
import { pricedFraction } from '../../crq-indicators/engine/priced-fraction';
import { computePertExpectedValue } from '../../scenario-loss-estimates/pert';
import { engineDifference, roundFigure } from '../change-values';

interface RunFigure {
  key: string,
  format: ChangeValueFormat,
  rise: ChangeDirection,
  tab: ScenarioTab,
  read: (run: ComparedRunRow) => number | null,
}

export const tefOf = (run: Pick<ComparedRunRow, 'tefMin' | 'tefLikely' | 'tefMax'>): number | null =>
  (run.tefMin === null || run.tefLikely === null || run.tefMax === null
    ? null
    : roundFigure(computePertExpectedValue(run.tefMin, run.tefLikely, run.tefMax)));

export const susceptibilityOf = (run: Pick<ComparedRunRow, 'outcomeEvicted' | 'outcomeImpactDetected' | 'outcomeImpactUndetected'>): number | null =>
  (run.outcomeEvicted === null || run.outcomeImpactDetected === null || run.outcomeImpactUndetected === null
    ? null
    : roundFigure(pricedFraction({ evicted: run.outcomeEvicted, impactDetected: run.outcomeImpactDetected, impactUndetected: run.outcomeImpactUndetected })));

export const magnitudeOf = (run: Pick<ComparedRunRow, 'magnitudeMean'>): number | null =>
  (run.magnitudeMean === null ? null : roundFigure(run.magnitudeMean));

/** In the order the page lists them. */
const RUN_FIGURES: ReadonlyArray<RunFigure> = [
  { key: 'tef', format: 'frequency', rise: 'up', tab: 'threat', read: tefOf },
  { key: 'susceptibility', format: 'share', rise: 'up', tab: 'crq', read: susceptibilityOf },
  { key: 'magnitude', format: 'currency', rise: 'up', tab: 'financial-impact', read: magnitudeOf },
  { key: 'lef', format: 'frequency', rise: 'up', tab: 'crq', read: (run) => run.lefMean },
  { key: 'outcome-blocked', format: 'share', rise: 'down', tab: 'crq', read: (run) => run.outcomeBlocked },
  { key: 'outcome-evicted', format: 'share', rise: 'down', tab: 'crq', read: (run) => run.outcomeEvicted },
  { key: 'outcome-impact-detected', format: 'share', rise: 'up', tab: 'crq', read: (run) => run.outcomeImpactDetected },
  { key: 'outcome-impact-undetected', format: 'share', rise: 'up', tab: 'crq', read: (run) => run.outcomeImpactUndetected },
  { key: 'technique-count', format: 'count', rise: 'up', tab: 'ttp', read: (run) => run.techniqueCount },
  { key: 'covered-technique-count', format: 'count', rise: 'down', tab: 'ttp', read: (run) => run.coveredTechniqueCount },
  { key: 'estate-asset-count', format: 'count', rise: 'up', tab: 'targets', read: (run) => run.estateAssetCount },
  { key: 'unscanned-asset-count', format: 'count', rise: 'none', tab: 'targets', read: (run) => run.unscannedAssetCount },
];

/**
 * A run's attackers by class. `group_key` is drawn afresh on every run, so the class is the only
 * name two runs share for an attacker; rows of one class are summed.
 */
const classShares = (run: ComparedRunRow): Map<ActorClass, number> => {
  const shares = new Map<ActorClass, number>();
  for (const score of run.groupScores) {
    if (score.actorClass !== null) {
      shares.set(score.actorClass, (shares.get(score.actorClass) ?? 0) + score.share);
    }
  }
  return shares;
};

const figureEvents = (before: ComparedRun, after: ComparedRun): Array<ChangeEvent> => RUN_FIGURES.flatMap((figure) => {
  const event = engineDifference({
    category: 'run-results',
    item: { kind: 'run-figure', key: figure.key, label: null, link: { kind: 'scenario-tab', tab: figure.tab } },
    format: figure.format,
    rise: figure.rise,
    before: figure.read(before.run),
    afterValue: figure.read(after.run),
  });
  return event === null ? [] : [event];
});

/** A class taking a larger share of the attacks is read as raising the loss, as a larger TEF term would. */
const classShareEvents = (before: ComparedRun, after: ComparedRun): Array<ChangeEvent> => {
  const beforeShares = classShares(before.run);
  const afterShares = classShares(after.run);
  const classes = [...new Set([...beforeShares.keys(), ...afterShares.keys()])].toSorted();
  return classes.flatMap((actorClass) => {
    const event = engineDifference({
      category: 'run-results',
      item: { kind: 'actor-class-share', key: actorClass, label: null, link: { kind: 'scenario-tab', tab: 'threat' } },
      format: 'share',
      rise: 'up',
      before: beforeShares.get(actorClass) ?? null,
      afterValue: afterShares.get(actorClass) ?? null,
    });
    return event === null ? [] : [event];
  });
};

export const runResultsCategory: ChangeCategory = {
  key: 'run-results',
  tabs: ['ale', 'tef', 'susceptibility', 'magnitude'],
  resolve: ({ before, after }) => [...figureEvents(before, after), ...classShareEvents(before, after)],
};
