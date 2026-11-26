import { Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { inferRouterOutputs } from '@trpc/server';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { FunctionComponent, ReactNode } from 'react';
import { formatDateTime, formatDollar, formatFixed, formatFractionAsPercent } from '../../../utils';
import { MetricInfo, SectionCard } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { actorClassLabel, ThreatTypeBadge } from '../../threats';
import { splitUnplayableObstacles } from '../attack-paths-utils';
import { attackPathNames } from './attack-path-names';
import { ScenarioBand } from './list';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
export type CrqRun = NonNullable<RouterOutputs['crqIndicators']['getLatestRun']>;
export type CrqRunDetail = NonNullable<RouterOutputs['crqIndicators']['getRunWithScores']>;

const Row: FunctionComponent<{ label: ReactNode, value: ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="txt-sub-content text-muted-foreground">{label}</span>
    <span className="txt-body2 font-medium text-right">{value}</span>
  </div>
);

const MeanWithBand: FunctionComponent<{ p10: number | null, mean: number, p90: number | null, format: (value: number) => string }> = ({ p10, mean, p90, format }) => (p10 === null || p90 === null ? (
  <div className="flex flex-col items-center gap-0.5 text-center">
    <p className="text-muted-foreground txt-sub-content">{t`Mean`}</p>
    <p className="font-bold">{format(mean)}</p>
    <ScenarioBand p10={null} p90={null} format={format} />
  </div>
) : (
  <div className="grid grid-cols-3 gap-2 text-center">
    {[
      { key: 'p10', label: t`p10`, value: p10, strong: false },
      { key: 'mean', label: t`Mean`, value: mean, strong: true },
      { key: 'p90', label: t`p90`, value: p90, strong: false },
    ].map(({ key, label, value, strong }) => (
      <div key={key}>
        <p className="text-muted-foreground txt-sub-content">{label}</p>
        <p className={strong ? 'font-bold' : 'font-medium'}>{format(value)}</p>
      </div>
    ))}
  </div>
));

/** The four outcomes of an attack run. The unnoticed share is a lower bound, and the card says so. */
export const CrqOutcomeCard: FunctionComponent<{ run: CrqRun }> = ({ run }) => (
  <SectionCard title={t`Attack run outcomes`}>
    <div className="flex flex-col gap-1">
      <Row label={<Trans>Blocked before the objective</Trans>} value={run.outcomeBlocked !== null ? formatFractionAsPercent(run.outcomeBlocked, 1) : <EmptyValue />} />
      <Row label={<Trans>Evicted in time</Trans>} value={run.outcomeEvicted !== null ? formatFractionAsPercent(run.outcomeEvicted, 1) : <EmptyValue />} />
      <Row label={<Trans>Impact, noticed</Trans>} value={run.outcomeImpactDetected !== null ? formatFractionAsPercent(run.outcomeImpactDetected, 1) : <EmptyValue />} />
      <Row
        label={(
          <span className="flex items-center gap-1">
            <Trans>Impact, unnoticed (lower bound)</Trans>
            <MetricInfo
              title={t`Impact, unnoticed`}
              what={<Trans>The share of attack runs that reach their objective and are never discovered afterwards.</Trans>}
              how={<Trans>One minus the post-objective discovery hazard, applied to the attack runs that reached the objective unseen.</Trans>}
              caveat={<Trans>A lower bound, knowingly: the discovery rate is fitted on breaches that were eventually discovered, and never-discovered breaches are absent from that data by construction. The real unnoticed share is at least this figure.</Trans>}
            />
          </span>
        )}
        value={run.outcomeImpactUndetected !== null ? formatFractionAsPercent(run.outcomeImpactUndetected, 1) : <EmptyValue />}
      />
    </div>
    <p className="txt-mini text-muted-foreground">
      <Trans>Share of attacks, weighted over the scenario's actors. The four outcomes sum to one.</Trans>
    </p>
  </SectionCard>
);

const formatFrequency = (value: number): string => formatFixed(value, 3);

/** LEF with the reach facts that belong beside it: what the run could not score and could not see. */
export const CrqFrequencyCard: FunctionComponent<{ run: CrqRun }> = ({ run }) => {
  const hasTef = run.tefMin !== null && run.tefLikely !== null && run.tefMax !== null;
  const tefMin = formatFrequency(run.tefMin ?? 0);
  const tefLikely = formatFrequency(run.tefLikely ?? 0);
  const tefMax = formatFrequency(run.tefMax ?? 0);
  const hasUnscanned = run.unscannedAssetCount !== null && run.estateAssetCount !== null && run.unscannedAssetShare !== null;
  const unscannedCount = run.unscannedAssetCount ?? 0;
  const estateCount = run.estateAssetCount ?? 0;
  const unscannedShare = formatFractionAsPercent(run.unscannedAssetShare ?? 0, 1);
  return (
    <SectionCard title={t`Loss Event Frequency (LEF)`}>
      {run.lefMean !== null ? (
        <>
          <MeanWithBand p10={run.lefP10} mean={run.lefMean} p90={run.lefP90} format={formatFrequency} />
          <p className="txt-sub-content text-muted-foreground text-center"><Trans>loss events per year</Trans></p>
        </>
      ) : (
        <p className="txt-sub-content text-muted-foreground"><Trans>No frequency: the scenario declares no threat event frequency.</Trans></p>
      )}
      {hasTef && (
        <p className="txt-sub-content text-muted-foreground text-center">
          <Trans>TEF input: {tefMin} - {tefLikely} - {tefMax} events/year</Trans>
        </p>
      )}
      <div className="flex flex-col gap-1 border-t pt-2">
        <Row
          label={<Trans>Pairs your controls do not contest</Trans>}
          value={run.uncontestedPairCount ?? <EmptyValue />}
        />
        <Row
          label={<Trans>Pairs no catalogue capability can contest</Trans>}
          value={run.uncontestablePairCount ?? <EmptyValue />}
        />
        <Row
          label={(
            <span className="flex items-center gap-1">
              <Trans>Assets with no vulnerability data</Trans>
              <MetricInfo
                title={t`Assets with no vulnerability data`}
                what={<Trans>The share of the scenario's estate carrying no vulnerability finding at all.</Trans>}
                how={<Trans>Assets of the scenario's families with no evidence on file, over every asset of those families.</Trans>}
                caveat={<Trans>An unscanned asset reads exactly like a fully patched one on the exploitation route. A high share here means the frequency is computed on an estate the platform cannot see, not on a clean one.</Trans>}
              />
            </span>
          )}
          value={hasUnscanned ? <Trans>{unscannedCount} of {estateCount} ({unscannedShare})</Trans> : <EmptyValue />}
        />
      </div>
    </SectionCard>
  );
};

/** ALE with the two things obligation 10 owes beside it: the accumulator's sensitivity and the corners. */
export const CrqLossCard: FunctionComponent<{ run: CrqRun }> = ({ run }) => (
  <SectionCard title={t`Annualized Loss Expectancy (ALE)`}>
    {run.aleMean !== null ? (
      <>
        <MeanWithBand p10={run.aleP10} mean={run.aleMean} p90={run.aleP90} format={formatDollar} />
        <p className="txt-sub-content text-muted-foreground flex items-center justify-center gap-1">
          <Trans>per year</Trans>
          <MetricInfo
            title={t`Annualized Loss Expectancy`}
            what={<Trans>The mean annual loss over the simulated worlds, priced from the four outcomes, with the p10 to p90 band: the range the expected annual loss takes in eight worlds in ten as the uncertain inputs vary. It is not the range of a single year's loss.</Trans>}
            how={<Trans>Frequency times the outcome split times the loss magnitude, per world: an eviction costs the response, a noticed impact a fraction of the magnitude, an unnoticed one all of it.</Trans>}
            caveat={<Trans>The p90 is a lower bound: it rests on the unnoticed share, which is itself a lower bound. The mean is the figure that adds up across scenarios, the band is not.</Trans>}
          />
        </p>
      </>
    ) : (
      <p className="txt-sub-content text-muted-foreground"><Trans>No price: the scenario declares no frequency or no loss estimate.</Trans></p>
    )}
    <div className="flex flex-col gap-1 border-t pt-2">
      <Row
        label={(
          <span className="flex items-center gap-1">
            <Trans>With the detection accumulator off</Trans>
            <MetricInfo
              title={t`Detection accumulator sensitivity`}
              what={<Trans>What this run would have answered with the detection accumulator switched off, on the same worlds.</Trans>}
              how={<Trans>The accumulator's gain is a chosen constant, not a fitted one, and zero gain is its exact road back. The run re-evaluates the scenario at zero gain so the choice is measured against something.</Trans>}
              caveat={<Trans>The distance between the two figures is what the chosen gain is worth. A large distance means the answer rests on a judgment call.</Trans>}
            />
          </span>
        )}
        value={run.aleAtMemorylessDetection !== null ? formatDollar(run.aleAtMemorylessDetection) : <EmptyValue />}
      />
    </div>
  </SectionCard>
);

const familyLabel = (family: string): string => family.replaceAll('_', ' ');

const PairList: FunctionComponent<{ pairs: CrqRunDetail['reachGaps'] }> = ({ pairs }) => (
  pairs.length === 0
    ? <p className="txt-sub-content text-muted-foreground"><Trans>None.</Trans></p>
    : (
      <ul className="max-h-48 overflow-y-auto txt-sub-content">
        {pairs.map((pair) => (
          <li key={pair.id} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="font-medium">{pair.externalId}</span> {pair.name}
            </span>
            <span className="shrink-0 text-muted-foreground">{familyLabel(pair.family)}</span>
          </li>
        ))}
      </ul>
    )
);

/**
 * The two reach gaps in their two distinct columns. Only the first is a fact about the tenant:
 * a pair the catalogue cannot contest says nothing about the posture, and conflating the two
 * would blame a tenant for a modelling gap.
 */
export const CrqReachCard: FunctionComponent<{ detail: CrqRunDetail }> = ({ detail }) => {
  const estateGaps = detail.reachGaps.filter((gap) => gap.gap === 'estate');
  const catalogueGaps = detail.reachGaps.filter((gap) => gap.gap === 'catalogue');
  const estateCount = estateGaps.length;
  const catalogueCount = catalogueGaps.length;
  return (
    <SectionCard title={t`Attacks the run could not score`}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className="txt-body2 font-medium flex items-center gap-1">
            <Trans>Not contested by your controls ({estateCount})</Trans>
            <MetricInfo
              title={t`Not contested by your controls`}
              what={<Trans>Technique and asset family pairs that the attackers play on your estate and that no control you declared contests.</Trans>}
              how={<Trans>Every pair some capability of the catalogue could contest, minus the pairs at least one of your deployed controls covers on that family.</Trans>}
              caveat={<Trans>This is your gap, and the one you can close: a control from the catalogue exists for each of these pairs.</Trans>}
            />
          </p>
          <PairList pairs={estateGaps} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="txt-body2 font-medium flex items-center gap-1">
            <Trans>Not contestable by the catalogue ({catalogueCount})</Trans>
            <MetricInfo
              title={t`Not contestable by the catalogue`}
              what={<Trans>Technique and asset family pairs that no capability of the control catalogue reaches at all.</Trans>}
              how={<Trans>Pairs the attackers play on your estate for which the catalogue holds no control edge on that family. They leave the run entirely rather than scoring zero.</Trans>}
              caveat={<Trans>A modelling gap, not yours: it says nothing about your posture. These attacks are absent from every figure above.</Trans>}
            />
          </p>
          <PairList pairs={catalogueGaps} />
        </div>
      </div>
    </SectionCard>
  );
};

/** Per actor: its share, what it achieves, what it cannot play, and the reaction-time cliff. */
export const CrqActorsCard: FunctionComponent<{ detail: CrqRunDetail }> = ({ detail }) => {
  const obstaclesByActor = new Map<string | null, Array<string>>();
  for (const obstacle of detail.unplayableObstacles) {
    const held = obstaclesByActor.get(obstacle.groupKey) ?? [];
    held.push(obstacle.obstacleKey);
    obstaclesByActor.set(obstacle.groupKey, held);
  }
  // Whether a path around the door plays depends on the estate alone, so every actor names the same ones.
  const unplayablePaths = [...new Set(splitUnplayableObstacles(detail.unplayableObstacles.map((obstacle) => obstacle.obstacleKey)).paths)];
  const names = attackPathNames();
  const pathNames = unplayablePaths.map((key) => names[key]).join(', ');
  return (
    <SectionCard title={t`Actors`}>
      <div className="flex flex-col gap-3">
        {unplayablePaths.length > 0 && (
          <p className="txt-sub-content text-amber-700">
            {unplayablePaths.includes('outside_perimeter')
              ? <Trans>Attack path not played ({pathNames}): no asset of this scope can be attacked without initial access. A denial of service needs an internet-facing asset, and an asset of unknown exposure counts as the tenant setting says.</Trans>
              : <Trans>Attack path not played ({pathNames}): no asset of this scope can be attacked without initial access.</Trans>}
          </p>
        )}
        {detail.groupScores.map((actor) => {
          const { walk: obstacles } = splitUnplayableObstacles(obstaclesByActor.get(actor.groupKey) ?? []);
          const obstacleList = obstacles.join(', ');
          const exceeded = actor.reactionTimeExceededShare ?? 0;
          const exceededPct = formatFractionAsPercent(exceeded, 1);
          const attackRunDays = actor.attackRunDays ?? 0;
          return (
            <div key={actor.id} className="flex flex-col gap-1 border-b pb-2 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="txt-body2 font-medium min-w-0 truncate">{actor.groupName ?? actorClassLabel(actor.actorClass)}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {actor.groupEntityType && <ThreatTypeBadge entityType={actor.groupEntityType} />}
                  {actor.groupName !== null && <Chip label={actorClassLabel(actor.actorClass)} />}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 txt-sub-content">
                <span className="text-muted-foreground"><Trans>Share</Trans> <span className="font-medium text-foreground">{formatFractionAsPercent(actor.share, 1)}</span></span>
                <span className="text-muted-foreground"><Trans>Lands an impact</Trans> <span className="font-medium text-foreground">{formatFractionAsPercent(actor.vulnerabilityMean, 1)}</span></span>
                <span className="text-muted-foreground"><Trans>ALE</Trans> <span className="font-medium text-foreground">{actor.aleMean !== null ? formatDollar(actor.aleMean) : <EmptyValue />}</span></span>
              </div>
              {obstacles.length > 0 && (
                <p className="txt-sub-content text-amber-700">
                  <Trans>Cannot play: {obstacleList}. Its repertoire holds no technique for these steps, so its attack runs stop there.</Trans>
                </p>
              )}
              {exceeded > 0 && (
                <p className="txt-sub-content text-amber-700">
                  {exceeded >= 1
                    ? <Trans>Your declared reaction time matches or exceeds every response window left after a detection in this actor's attack run ({attackRunDays} days): no detection control can evict it, whatever it detects.</Trans>
                    : <Trans>Your declared reaction time matches or exceeds every response window left after a detection in this actor's attack run ({attackRunDays} days) in {exceededPct} of its attack runs: in those no detection control can evict it, whatever it detects.</Trans>}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
};

/** What the run rests on: which calibration, which catalogue, which threat settings, which corners. */
export const CrqProvenanceCard: FunctionComponent<{ run: CrqRun }> = ({ run }) => {
  const runDate = formatDateTime(run.createdAt);
  const assetsWalked = run.estateAssetCount ?? 0;
  const estateWalked = run.estateMode === null
    ? null
    : run.estateMode === 'closed'
      ? plural(assetsWalked, { one: 'Mapped assets only (# asset)', other: 'Mapped assets only (# assets)' })
      : plural(assetsWalked, { one: 'Whole estate (# asset)', other: 'Whole estate (# assets)' });
  return (
    <SectionCard title={t`What this run rests on`}>
      <div className="flex flex-col gap-1">
        <Row label={<Trans>Run date</Trans>} value={runDate} />
        <Row label={<Trans>Worlds drawn</Trans>} value={run.iterations} />
        <Row
          label={(
            <span className="flex items-center gap-1">
              <Trans>Calibration</Trans>
              <MetricInfo
                title={t`Calibration`}
                what={<Trans>The calibration pass the engine's constants come from.</Trans>}
                how={<Trans>Recorded on the run itself, so two runs that differ here differ by the engine's constants and not only by your posture.</Trans>}
              />
            </span>
          )}
          value={run.calibrationVintage ?? <EmptyValue />}
        />
        <Row
          label={(
            <span className="flex items-center gap-1">
              <Trans>Control catalogue</Trans>
              <MetricInfo
                title={t`Control catalogue`}
                what={<Trans>The ATT&CK release and the shape of the control catalogue the reach was computed against.</Trans>}
                how={<Trans>An ALE move between two runs with different catalogues is a catalogue release, not a posture change.</Trans>}
              />
            </span>
          )}
          value={run.catalogueVintage ?? <EmptyValue />}
        />
        <Row label={<Trans>Threat relevance</Trans>} value={run.threatEvidenceMode ?? <EmptyValue />} />
        <Row label={<Trans>Admitted actors</Trans>} value={run.admittedActorCount ?? <EmptyValue />} />
        <Row
          label={(
            <span className="flex items-center gap-1">
              <Trans>Estate walked</Trans>
              <MetricInfo
                title={t`Estate walked`}
                what={<Trans>Which estate the risk scope declared, and how many of its assets this run priced.</Trans>}
                how={<Trans>A scope measured over its mapped assets walks those alone; one measured over the whole estate walks every asset of the tenant. Either way the count is narrowed to the asset families the scenario's attacks can touch.</Trans>}
                caveat={<Trans>Two runs of the same scenario over different estates answer two different questions, and the figures are not comparable.</Trans>}
              />
            </span>
          )}
          value={estateWalked ?? <EmptyValue />}
        />
        <Row
          label={(
            <span className="flex items-center gap-1">
              <Trans>Target boost</Trans>
              <MetricInfo
                title={t`Target boost`}
                what={<Trans>The extra weight the assets behind the scenario's primary assets carried when an attack reached for what the scenario destroys.</Trans>}
                how={<Trans>The constant the run recorded. What it is worth to a given draw depends on the mix of assets the obstacle can be reached on, since the weight is normalised there.</Trans>}
                caveat={<Trans>It reads as none whenever the boost separated nothing: no primary asset, every asset walked already behind one, or none of the target's supporting assets inside the estate walked.</Trans>}
              />
            </span>
          )}
          value={run.boostApplied === null ? <EmptyValue /> : run.boostApplied > 1 ? `x${run.boostApplied}` : t`None`}
        />
      </div>
      {run.cornerConstants !== null && run.cornerConstants.length > 0 && (
        <div className="border-t pt-2">
          <p className="txt-sub-content font-medium flex items-center gap-1">
            <Trans>Constants at a corner, not at a calibrated point</Trans>
            <MetricInfo
              title={t`Constants at a corner`}
              what={<Trans>Constants the calibration could not anchor and that the law holds at one end of their range.</Trans>}
              how={<Trans>Named here because a reader who cannot tell a default from a decision has no way to ask the right question about the figure.</Trans>}
              caveat={<Trans>The figure above is a corner reading, not a calibrated point, along each of these axes.</Trans>}
            />
          </p>
          <ul className="txt-sub-content text-muted-foreground list-disc pl-4">
            {run.cornerConstants.map((corner) => <li key={corner}>{corner}</li>)}
          </ul>
        </div>
      )}
    </SectionCard>
  );
};
