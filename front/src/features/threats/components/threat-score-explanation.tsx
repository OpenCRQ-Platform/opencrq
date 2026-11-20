import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { SeverityBand } from '@app/module/client';
import {
  ACTIVITY_HALF_LIFE_DAYS,
  ACTIVITY_SIGNAL_BASE_WEIGHT,
  MAX_TAU,
  OUTCOME_WEIGHT_THRESHOLD,
  resolveSeverityBand,
  SEVERITY_BANDS,
  TAU_COUNTRY_FACTOR,
  TAU_SECTOR_FACTOR,
} from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import type { ExplanationTerm } from '../../finding-score';
import type { LastObservedViaThreat } from './last-observed-via';
import type { ThreatScoreFactor } from './relevance-proof-utils';
import {
  BandRow,
  CalcOperator,
  CalcResult,
  CalcSource,
  ExplanationCalc,
  ExplanationCaveat,
  ExplanationDerivation,
  ExplanationDialogButton,
  ExplanationHero,
  ExplanationProse,
  ExplanationSection,
  ExplanationTerms,
  FactorBar,
  formatBeforeTruncation,
  formatFactor,
  formatWeight,
  severityBandLabel,
} from '../../finding-score';
import { formatDate } from '../../../utils/date-utils';
import { formatAtMost, formatFractionAsPercent } from '../../../utils/format-number';
import { LastObservedVia } from './last-observed-via';
import { breakRelevanceDown, composeThreatScore, resolveLimitingThreatScoreFactor } from './relevance-proof-utils';

/**
 * What a band says about the two factors, and never what to do about it.
 *
 * A sentence may only state what the band itself forces. Critical needs a product of 0.895, which
 * only a relevance matching country, sector and a near-full outcome reaches, and an activity near
 * its maximum, which many older days reach as well as recent ones. Low puts one factor under 0.63,
 * and a low activity means undated, old or few observed days, not none. The middle bands name no shape.
 */
const bandReading = (band: SeverityBand): string => {
  switch (band) {
    case 'critical':
      return t`Country, sector and attack outcome all match, and observed activity is near its maximum.`;
    case 'high':
      return t`Relevance and observed activity are both high.`;
    case 'medium':
      return t`At least one factor stays well under its ceiling and pulls the score down.`;
    case 'low':
      return t`One factor is low: the threat barely targets this scenario, or its activity is undated, old or made of few observed days.`;
  }
};

const resolveHeroReading = (limiting: ThreatScoreFactor, assumed: boolean): ReactNode => {
  if (limiting === 'relevance') {
    return assumed
      ? <Trans>Relevance and assumed activity counted. Relevance is the lower of the two, and caps the score.</Trans>
      : <Trans>Relevance and observed activity counted. Relevance is the lower of the two, and caps the score.</Trans>;
  }
  return assumed
    ? <Trans>Relevance and assumed activity counted. Assumed activity is the lower of the two, and caps the score.</Trans>
    : <Trans>Relevance and observed activity counted. Observed activity is the lower of the two, and caps the score.</Trans>;
};

interface DimensionReading {
  matched: boolean,
  matchedValue: string | null,
}

export interface ThreatScoreExplanationProps {
  combinedRelevance: number,
  activityWeight: number,
  /** The age an undated activity is counted at; null when the activity is dated. */
  assumedActivityAgeDays: number | null,
  country: DimensionReading | null,
  sector: DimensionReading | null,
  /** What the model stored for the scenario's attack outcome: null when it stored no percentage. */
  outcomeProbability: number | null,
  evidenceSufficient: boolean,
  outcomeName: string | null,
  lastObservedAt: Date | string | null,
  /** How long ago the last activity was, worded by the caller. */
  activityAge: string | null,
  /** The attributed threat that supplied `lastObservedAt`, when it is not the threat's own date. */
  lastObservedVia: LastObservedViaThreat | null,
  /** The confidence gate in force, which decides the targeting claims relevance reads. */
  gateLabel: string,
}

const ThreatScoreExplanation: FunctionComponent<ThreatScoreExplanationProps> = ({
  combinedRelevance,
  activityWeight,
  assumedActivityAgeDays,
  country,
  sector,
  outcomeProbability,
  evidenceSufficient,
  outcomeName,
  lastObservedAt,
  activityAge,
  lastObservedVia,
  gateLabel,
}) => {
  const at = i18n.locale || 'en';
  const score = composeThreatScore(combinedRelevance, activityWeight);
  const band = resolveSeverityBand(score);
  const limiting = resolveLimitingThreatScoreFactor(combinedRelevance, activityWeight);
  const relevance = formatFactor(combinedRelevance, at);
  const activity = formatFactor(activityWeight, at);
  const { modelWeight, countryFactor, sectorFactor, targetingFactor } = breakRelevanceDown({
    probability: outcomeProbability,
    evidenceSufficient,
    countryMatch: country?.matched ?? false,
    sectorMatch: sector?.matched ?? false,
  });
  const matchedCountry = country?.matchedValue ?? t`no match`;
  const matchedSector = sector?.matchedValue ?? t`no match`;
  const baseWeight = formatWeight(ACTIVITY_SIGNAL_BASE_WEIGHT, at);
  const halfLife = ACTIVITY_HALF_LIFE_DAYS;
  const assumed = assumedActivityAgeDays !== null;
  const activityLabel = assumed ? t`Assumed activity` : t`Observed activity`;
  const thresholdLabel = formatFractionAsPercent(OUTCOME_WEIGHT_THRESHOLD, 0);
  const countryFactorLabel = formatAtMost(TAU_COUNTRY_FACTOR, 1);
  const sectorFactorLabel = formatAtMost(TAU_SECTOR_FACTOR, 1);
  const maxFactorLabel = formatAtMost(MAX_TAU, 1);
  const outcomeRange = 1 - OUTCOME_WEIGHT_THRESHOLD;

  const relevanceTerms: Array<ExplanationTerm> = [
    {
      label: outcomeName === null ? <Trans>Model weight on the attack outcome</Trans> : <Trans>Model weight on {outcomeName}</Trans>,
      source: !evidenceSufficient || outcomeProbability === null
        ? t`not enough data`
        : `((${formatFactor(outcomeProbability, at)} − ${formatFactor(OUTCOME_WEIGHT_THRESHOLD, at)}) / ${formatFactor(outcomeRange, at)})²`,
      value: formatWeight(modelWeight, at),
    },
    {
      label: <Trans>Country: {matchedCountry}</Trans>,
      value: `× ${formatAtMost(countryFactor, 1)}`,
    },
    {
      label: <Trans>Sector: {matchedSector}</Trans>,
      value: `× ${formatAtMost(sectorFactor, 1)}`,
    },
    {
      label: t`Relevance`,
      source: `${formatWeight(modelWeight, at)} × ${formatAtMost(targetingFactor, 1)} / ${maxFactorLabel}`,
      value: relevance,
      total: true,
    },
  ];
  const activityTerms: Array<ExplanationTerm> = [
    ...(lastObservedAt === null ? [] : [{
      label: t`Last activity`,
      source: lastObservedVia === null
        ? activityAge ?? undefined
        : (
          <>
            {activityAge}
            <span className="block"><LastObservedVia via={lastObservedVia} /></span>
          </>
        ),
      value: formatDate(lastObservedAt),
    }]),
    {
      label: activityLabel,
      source: assumedActivityAgeDays === null ? undefined : `${baseWeight} × 2^(−${assumedActivityAgeDays} / ${halfLife})`,
      value: activity,
      total: true,
    },
  ];

  const heroReading = resolveHeroReading(limiting, assumed);

  return (
    <>
      <ExplanationHero
        figure={score}
        band={band}
        unit={severityBandLabel(band)}
        reading={heroReading}
      />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            The score places a threat on a 0 to 100 scale for this risk scenario, where a higher
            figure is worse. It asks one question in two pieces: is this threat likely to lead to
            the scenario's attack outcome and does it target this organization, and is it acting
            now? The two weigh the same.
          </Trans>
        </ExplanationProse>
        <ExplanationProse>
          <Trans>
            It is neither a probability nor a frequency. It is a prioritisation tool, made to decide
            which threat to start with.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <ExplanationCalc
        rows={[
          {
            label: t`score`,
            expression: (
              <>
                <CalcOperator>= 100 × </CalcOperator>
                <CalcSource>{relevance}</CalcSource>
                <CalcOperator> × </CalcOperator>
                <CalcSource>{activity}</CalcSource>
              </>
            ),
          },
          { label: t`product`, expression: <>{formatFactor(combinedRelevance * activityWeight, at)}</>, break: true },
          { label: '× 100', expression: <>{formatBeforeTruncation(combinedRelevance * activityWeight * 100, at)}</> },
          { label: t`rounded`, expression: <CalcResult band={band}>{score}</CalcResult> },
        ]}
      />

      <ExplanationSection label={t`What each factor contributed`}>
        <div className="flex flex-col gap-3">
          <FactorBar
            label={t`Relevance`}
            value={combinedRelevance}
            note={limiting === 'relevance' ? <Trans>The lower of the two factors: this is what caps the score.</Trans> : undefined}
          />
          <FactorBar
            label={activityLabel}
            value={activityWeight}
            note={limiting === 'activity' ? <Trans>The lower of the two factors: this is what caps the score.</Trans> : undefined}
          />
        </div>
      </ExplanationSection>

      <ExplanationDerivation label={t`Relevance`}>
        <ExplanationProse>
          <Trans>
            The model weight comes from the percentage OpenCRQ's internal model gives this threat on
            the scenario's attack outcome: nothing at {thresholdLabel} or below, growing to 1 at
            100%. A threat the model has too little data on weighs nothing.
          </Trans>
        </ExplanationProse>
        <ExplanationProse>
          <Trans>
            Targeting multiplies it by {countryFactorLabel} for a country match and by {sectorFactorLabel} for
            a sector match, so {maxFactorLabel} for both, and the product is divided by {maxFactorLabel}.
            Only targeting claims at confidence {gateLabel} or above are read.
          </Trans>
        </ExplanationProse>
        <ExplanationTerms terms={relevanceTerms} />
      </ExplanationDerivation>

      <ExplanationDerivation label={activityLabel}>
        {assumedActivityAgeDays !== null && (
          <ExplanationProse>
            <Trans>
              No dated activity is known for this threat, so it is counted as an activity {assumedActivityAgeDays} days old.
            </Trans>
          </ExplanationProse>
        )}
        <ExplanationProse>
          <Trans>
            Each day of activity counts {baseWeight}, halved every {halfLife} days of age. The days
            combine so that the total approaches 1 without ever reaching it.
          </Trans>
        </ExplanationProse>
        <ExplanationTerms terms={activityTerms} />
      </ExplanationDerivation>

      <ExplanationProse>
        <Trans>
          The two factors multiply, they never add, so neither can make up for the other. The result
          is rounded to the nearest whole number.
        </Trans>
      </ExplanationProse>

      <ExplanationCaveat>
        {assumedActivityAgeDays === null
          ? (
            <Trans>
              A threat aimed squarely at this scenario still scores low once its activity is old or made
              of few observed days: each day of activity loses half its weight every {halfLife} days.
            </Trans>
          )
          : (
            <Trans>
              A threat aimed squarely at this scenario still scores low once its activity is undated, old
              or made of few observed days: each day of activity loses half its weight every {halfLife} days, and an
              undated activity weighs as one {assumedActivityAgeDays} days old.
            </Trans>
          )}
      </ExplanationCaveat>

      <ExplanationSection label={t`The bands`}>
        <div className="flex flex-col gap-1">
          {SEVERITY_BANDS.map((entry) => (
            <BandRow key={entry} band={entry} current={entry === band} reading={bandReading(entry)} />
          ))}
        </div>
      </ExplanationSection>
    </>
  );
};

export const ThreatScoreInfoButton: FunctionComponent<ThreatScoreExplanationProps> = (props) => (
  <ExplanationDialogButton triggerLabel={t`How the threat score is computed`} title={t`Threat score`}>
    <ThreatScoreExplanation {...props} />
  </ExplanationDialogButton>
);
