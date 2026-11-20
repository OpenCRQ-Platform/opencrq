import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { SeverityBand } from '@app/module/client';
import { partFigure, SEVERITY_BANDS, UNCLASSIFIED_ASSET_CATEGORY } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { FindingScoreBreakdown } from '../finding-score-section';
import { getAssetCategoryLabel } from '../../../../utils';
import { severityBandLabel } from '../severity-ramp';
import {
  BandRow,
  CalcOperator,
  CalcResult,
  CalcSource,
  ExplanationCalc,
  ExplanationHero,
  ExplanationProse,
  ExplanationSection,
  ExplanationTerms,
  FactorBar,
} from './explanation-blocks';
import { formatBeforeTruncation, formatFactor, formatProduct, formatWeight } from './score-explanation-utils';

/**
 * What a band says about the two parts, and never what to do about it.
 *
 * A sentence may only state what the root forces: at 90 both parts are at least 81, at 70 both are
 * at least 49, under 40 at least one is under 40. The product carries no remediation policy either,
 * so a sentence prescribing one would be wrong the day a tenant sets its own.
 */
const bandReading = (band: SeverityBand): string => {
  switch (band) {
    case 'critical':
      return t`Both parts are high: the flaw is easy to exploit here and costly once exploited.`;
    case 'high':
      return t`Neither part is low. The weaker one says what keeps the score from critical.`;
    case 'medium':
      return t`At least one part stays well under its ceiling and pulls the score down.`;
    case 'low':
      return t`One part is low: either the flaw hardly lands here, or what it touches costs little once the controls are counted.`;
  }
};

export const CompositionExplanation: FunctionComponent<{ finding: FindingScoreBreakdown }> = ({ finding }) => {
  const at = i18n.locale || 'en';
  const { composition, band, score } = finding;
  const exploitability = partFigure(finding.exploitability);
  const impact = partFigure(finding.impact);
  const family = finding.assetCategoryId === UNCLASSIFIED_ASSET_CATEGORY
    ? t`the whole estate`
    : getAssetCategoryLabel(finding.assetCategoryId);

  return (
    <>
      <ExplanationHero
        figure={score}
        band={band}
        unit={severityBandLabel(band)}
        reading={<Trans>Exploitability, {exploitability}, and impact, {impact}, give {score}.</Trans>}
      />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            The score places a finding on a 0 to 100 scale where a higher figure is worse. It asks
            two questions in series: can this flaw be exploited here, and what does it cost if it
            is. Neither can make up for the other: a flaw nobody can exploit on a critical asset,
            and a wide-open flaw on an asset worth nothing, both stay low.
          </Trans>
        </ExplanationProse>
        <ExplanationProse>
          <Trans>
            It is neither a probability nor an amount. It is a prioritisation tool, made to decide
            what to start with.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <ExplanationCalc
        rows={[
          {
            label: t`score`,
            expression: <><CalcOperator>= ⌊ 100 × √(</CalcOperator>{t`exploitability`} <CalcOperator>×</CalcOperator> {t`impact`}<CalcOperator>) ⌋</CalcOperator></>,
          },
          {
            expression: (
              <>
                <CalcOperator>= ⌊ 100 × √(</CalcOperator><CalcSource>{formatFactor(composition.exploitability, at)}</CalcSource>
                <CalcOperator> × </CalcOperator><CalcSource>{formatFactor(composition.impact, at)}</CalcSource>
                <CalcOperator>) ⌋</CalcOperator>
              </>
            ),
          },
          { label: t`product`, expression: <>{formatProduct(composition.product, at)}</>, break: true },
          { label: t`root`, expression: <>{formatWeight(composition.raw / 100, at)}</> },
          { label: '× 100', expression: <>{formatBeforeTruncation(composition.raw, at)}</> },
          { label: t`truncated`, expression: <CalcResult band={band}>{composition.score}</CalcResult> },
        ]}
      />

      <ExplanationProse>
        <Trans>
          The score always sits between exploitability and impact, pulled toward the weaker of the
          two: when either is 0, the score is 0. The result is truncated, never rounded.
        </Trans>
      </ExplanationProse>

      <ExplanationSection label={t`Where the terms come from`}>
        <ExplanationTerms
          terms={[
            {
              label: t`Exploitability`,
              source: <Trans>The mean of reachability and threat, narrowed by what the controls measured on {family} let through.</Trans>,
              value: formatFactor(composition.exploitability, at),
            },
            {
              label: t`Impact`,
              source: <Trans>The potential impact, the criticality times the vector impact, narrowed by what the controls of the whole estate let through.</Trans>,
              value: formatFactor(composition.impact, at),
            },
          ]}
        />
      </ExplanationSection>

      <ExplanationSection label={t`What each part contributed`}>
        <div className="flex flex-col gap-3">
          <FactorBar label={t`Exploitability`} value={composition.exploitability} figure={exploitability} />
          <FactorBar label={t`Impact`} value={composition.impact} figure={impact} />
        </div>
      </ExplanationSection>

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
