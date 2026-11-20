import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { PostureBand, SeverityBand } from '@app/module/client';
import { POSTURE_BANDS, POSTURE_POINTS_PER_FINDING, postureBandForScore, postureBandRange, postureSeverityBand, resolveSeverityBand, SEVERITY_BANDS } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import type { CrqPosture } from './crq-posture-tile';
import {
  CalcOperator,
  CalcResult,
  CalcSource,
  ExplanationCalc,
  ExplanationHero,
  ExplanationProse,
  ExplanationSection,
  severityBandFigureColor,
  severityBandFillColor,
} from '../../finding-score';
import { formatPosturePoints } from './crq-posture-utils';
import { postureBandLabel } from './posture-band-word';
import { PostureReading } from './posture-reading';

/** What a posture band says about the worst finding, which is what places an asset in it. */
const postureBandReading = (band: PostureBand): string => {
  switch (band) {
    case 'strong': return t`The worst finding is at most 25.`;
    case 'moderate': return t`The worst finding is between 26 and 50.`;
    case 'weak': return t`The worst finding is between 51 and 75.`;
    case 'critical': return t`A finding reaches 76, or the asset carries a very large number of them.`;
  }
};

const Dot: FunctionComponent<{ band: SeverityBand }> = ({ band }) => (
  <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ backgroundColor: severityBandFillColor(band) }} />
);

/** Why the worst finding's score and the exploitability the posture reads differ: the impact alone. */
const WhyExploitability: FunctionComponent<{ worst: CrqPosture['worstFinding'] }> = ({ worst }) => {
  const { exploitability, impact } = worst;
  return (
    <ExplanationProse>
      <Trans>
        The posture reads the exploitability, {exploitability}: whether an attempt on the flaw lands
        here. The finding score sets it against the impact, {impact}, to decide what to fix first.
      </Trans>
    </ExplanationProse>
  );
};

const bandCountLabel = (band: SeverityBand, count: number): string => {
  switch (band) {
    case 'critical': return plural(count, { one: '# critical', other: '# critical' });
    case 'high': return plural(count, { one: '# high', other: '# high' });
    case 'medium': return plural(count, { one: '# medium', other: '# medium' });
    case 'low': return plural(count, { one: '# low', other: '# low' });
  }
};

const BandChip: FunctionComponent<{ band: SeverityBand, count: number, holdsWorst: boolean }> = ({ band, count, holdsWorst }) => (
  <span
    className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-[var(--fds-bg-elevation-default-layer-2)] px-2 py-0.5 font-content-compact text-content-compact"
    style={holdsWorst ? { borderColor: severityBandFillColor(band) } : undefined}
  >
    <Dot band={band} />
    {bandCountLabel(band, count)}
  </span>
);

/**
 * The worst finding on one line, why its score is not the figure the posture reads, and every
 * applicable finding counted by band, the band holding the worst one ringed.
 */
const FindingsSection: FunctionComponent<{ tenantId: string, posture: CrqPosture }> = ({ tenantId, posture }) => {
  const { worstFinding, countsByBand } = posture;
  const worstBand = resolveSeverityBand(worstFinding.exploitability);
  const total = SEVERITY_BANDS.reduce((sum, band) => sum + countsByBand[band], 0);
  const { exploitability } = worstFinding;
  const findingScore = worstFinding.score;
  return (
    <ExplanationSection label={t`Findings`}>
      <div className="flex items-center justify-between gap-3 rounded-sm border border-[var(--fds-border-elevation-subtle)] px-3 py-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
            <Trans>The worst</Trans>
          </span>
          <Link
            to="/$tenantId/{-$organizationId}/findings/$evidenceId"
            params={{ tenantId, evidenceId: worstFinding.evidenceId }}
            className="truncate font-content-base-bold text-content-base-bold text-primary underline-offset-4 hover:underline"
          >
            {worstFinding.name}
          </Link>
        </span>
        <span className="flex shrink-0 items-baseline gap-3.5 font-content-compact text-content-compact text-default-secondary">
          <span>
            <Trans>
              Exploitability <span className="font-title-md text-title-md tabular-nums" style={{ color: severityBandFigureColor(worstBand) }}>{exploitability}</span>
            </Trans>
          </span>
          <span>
            <Trans>Finding score <span className="font-semibold tabular-nums text-default-primary">{findingScore}</span></Trans>
          </span>
        </span>
      </div>
      <WhyExploitability worst={worstFinding} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 font-content-compact text-content-compact text-default-secondary">
          {plural(total, { one: '# applicable', other: '# applicable' })}
        </span>
        {SEVERITY_BANDS.map((band) => (
          <BandChip key={band} band={band} count={countsByBand[band]} holdsWorst={band === worstBand} />
        ))}
      </div>
    </ExplanationSection>
  );
};

const PostureCalc: FunctionComponent<{ posture: CrqPosture }> = ({ posture }) => {
  const at = i18n.locale || 'en';
  const points = (value: number): string => formatPosturePoints(value, at);
  const { composition, worstFinding, score } = posture;
  const band = postureSeverityBand(postureBandForScore(score));
  const kept = Math.min(100, composition.removedPoints);

  const rows: Array<{ label: ReactNode, expression: ReactNode, break?: boolean }> = [
    {
      label: t`count`,
      expression: (
        <>
          <CalcOperator>= </CalcOperator>
          {composition.tail.map((term, index) => (
            <span key={term.band}>
              {index > 0 && <CalcOperator> + </CalcOperator>}
              <CalcOperator>{points(term.pointsPerFinding)} × </CalcOperator>
              <CalcSource>{term.count}</CalcSource>
            </span>
          ))}
          <CalcOperator> = </CalcOperator>
          {points(composition.tailPoints)}
        </>
      ),
    },
    {
      label: t`removed`,
      expression: (
        <>
          <CalcOperator>= </CalcOperator>
          <CalcSource>{points(worstFinding.exploitability)}</CalcSource>
          <CalcOperator> + {points(composition.tailPoints)} = </CalcOperator>
          {points(composition.removedPoints)}
        </>
      ),
      break: true,
    },
    ...(composition.capped ? [{ label: t`capped`, expression: <><CalcOperator>= </CalcOperator>100</> }] : []),
    {
      label: t`posture`,
      expression: (
        <>
          <CalcOperator>= 100 − {points(kept)} = </CalcOperator>
          {points(composition.unrounded)}
        </>
      ),
    },
    { label: t`rounded`, expression: <CalcResult band={band}>{score}</CalcResult> },
  ];
  return <ExplanationCalc rows={rows} />;
};

const PostureBandRow: FunctionComponent<{ band: PostureBand, current: boolean }> = ({ band, current }) => {
  const severity = postureSeverityBand(band);
  return (
    <div
      className="flex items-start gap-3 rounded-sm border border-transparent p-2 font-content-compact text-content-compact"
      style={current ? { borderColor: severityBandFillColor(severity) } : undefined}
    >
      <span className="mt-[6px] flex"><Dot band={severity} /></span>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-baseline gap-3">
          <span className="min-w-[4.5rem] tabular-nums text-default-secondary">{postureBandRange(band)}</span>
          <span className="font-semibold">{postureBandLabel(band)}</span>
          {current && (
            <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
              <Trans>current</Trans>
            </span>
          )}
        </span>
        <span className="font-content-caption text-content-caption text-default-secondary">{postureBandReading(band)}</span>
      </span>
    </div>
  );
};

/**
 * What the OpenCRQ Posture tile's "i" opens: the posture, the worst finding it was drawn from, the
 * arithmetic, and the bands, in the order the finding score's own explanation uses.
 */
export const CrqPostureExplanation: FunctionComponent<{ tenantId: string, posture: CrqPosture }> = ({ tenantId, posture }) => {
  const at = i18n.locale || 'en';
  const { score } = posture;
  const postureBand = postureBandForScore(score);
  const perCritical = formatPosturePoints(POSTURE_POINTS_PER_FINDING.critical, at);
  const perHigh = formatPosturePoints(POSTURE_POINTS_PER_FINDING.high, at);
  const perMedium = formatPosturePoints(POSTURE_POINTS_PER_FINDING.medium, at);

  return (
    <>
      <ExplanationHero
        figure={score}
        band={postureSeverityBand(postureBand)}
        unit={postureBandLabel(postureBand)}
        reading={(
          <PostureReading
            name={posture.worstFinding.name}
            exploitability={posture.worstFinding.exploitability}
            countsByBand={posture.countsByBand}
            tailPoints={posture.composition.tailPoints}
          />
        )}
      />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            The posture places the asset on a 0 to 100 scale where a higher figure is better. It is read
            from the asset's applicable findings: the worst one sets most of it, and every finding takes
            a little more off by its band.
          </Trans>
        </ExplanationProse>
        <ExplanationProse>
          <Trans>
            It says how far the asset can be compromised, not what it is worth: neither the asset
            criticality nor the flaws' impact plays a part.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <FindingsSection tenantId={tenantId} posture={posture} />

      <PostureCalc posture={posture} />

      <ExplanationProse>
        <Trans>
          The worst finding takes its exploitability off. Every finding takes {perCritical} point more if it
          is critical, {perHigh} if it is high, {perMedium} if it is medium or low. The posture never
          goes below 0.
        </Trans>
      </ExplanationProse>

      <ExplanationSection label={t`The bands`}>
        <div className="flex flex-col gap-1">
          {POSTURE_BANDS.map((band) => (
            <PostureBandRow key={band} band={band} current={band === postureBand} />
          ))}
        </div>
      </ExplanationSection>
    </>
  );
};
