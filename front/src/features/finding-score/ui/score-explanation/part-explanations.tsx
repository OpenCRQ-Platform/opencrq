import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import { partFigure, resolveSeverityBand } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import type { FindingScoreBreakdown } from '../finding-score-section';
import { exposureLabel } from '../column-vocabulary';
import {
  CalcOperator,
  CalcResult,
  CalcSource,
  ExplanationCalc,
  ExplanationCaveat,
  ExplanationHero,
  ExplanationProse,
  ExplanationSection,
  ExplanationTerms,
} from './explanation-blocks';
import { PotentialImpactSource } from './factor-explanations';
import { formatFactor, formatWeight } from './score-explanation-utils';

interface ExplanationProps {
  finding: FindingScoreBreakdown,
}

type ControlsFactor = FindingScoreBreakdown['factors']['exploitationControls'];

const locale = (): string => i18n.locale || 'en';

const controlsSource = (factor: ControlsFactor, none: ReactNode): ReactNode => {
  if (factor.weakestPath === null) {
    return none;
  }
  return factor.aggregation === 'weakest'
    ? <Trans>What gets through on the weakest technique, detailed on the controls tile.</Trans>
    : <Trans>What gets through on average over the techniques, detailed on the controls tile.</Trans>;
};

export const ExploitabilityExplanation: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const at = locale();
  const { reachability, threat, exploitationControls } = finding.factors;
  const figure = partFigure(finding.exploitability);
  const band = resolveSeverityBand(figure);
  const zone = exposureLabel(finding.columns.reachability.exposure);

  return (
    <>
      <ExplanationHero figure={figure} band={band} unit={t`out of 100`} reading={t`can an attempt land here`} />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            Whether an attempt on this flaw is likely to land on this asset. Reachability and threat
            both answer that question, so they are averaged rather than stacked. What the controls
            let through on the exploitation techniques then narrows it: that share is a real
            fraction, so it multiplies.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <ExplanationCalc
        rows={[
          {
            label: t`exploitability`,
            expression: (
              <>
                <CalcOperator>= (</CalcOperator>{t`reachability`} <CalcOperator>+</CalcOperator> {t`threat`}<CalcOperator>) / 2 ×</CalcOperator> {t`controls let through`}
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>= (</CalcOperator><CalcSource>{formatWeight(reachability.value, at)}</CalcSource>
                <CalcOperator> + </CalcOperator><CalcSource>{formatWeight(threat.value, at)}</CalcSource>
                <CalcOperator>) / 2 × </CalcOperator><CalcSource>{formatWeight(exploitationControls.value, at)}</CalcSource>
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcSource>{formatWeight(finding.reachabilityAndThreat, at)}</CalcSource>
                <CalcOperator> × </CalcOperator><CalcSource>{formatWeight(exploitationControls.value, at)}</CalcSource>
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcResult band={band}>{formatFactor(finding.exploitability, at)}</CalcResult>
                <CalcOperator> → {figure} / 100</CalcOperator>
              </>
            ),
          },
        ]}
      />

      <ExplanationSection label={t`Where the terms come from`}>
        <ExplanationTerms
          terms={[
            {
              label: t`Reachability`,
              source: reachability.terms.cvssAccess === null
                ? <Trans>Zone {zone}. A tenant setting, under CRQ indicators; no vector was published.</Trans>
                : <Trans>Zone {zone}, narrowed by what the published CVSS vector demands.</Trans>,
              value: formatWeight(reachability.value, at),
            },
            {
              label: t`Threat`,
              source: <Trans>The highest floor the exploitation signals set.</Trans>,
              value: formatWeight(threat.value, at),
            },
            {
              label: t`Controls let through`,
              source: controlsSource(
                exploitationControls,
                <Trans>No exploitation technique stands in reach, so nothing is counted as held back, and the side still counts.</Trans>,
              ),
              value: formatWeight(exploitationControls.value, at),
            },
          ]}
        />
      </ExplanationSection>
    </>
  );
};

export const ImpactExplanation: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const at = locale();
  const { potentialImpact, impactControls } = finding.factors;
  const figure = partFigure(finding.impact);
  const band = resolveSeverityBand(figure);

  return (
    <>
      <ExplanationHero figure={figure} band={band} unit={t`out of 100`} reading={t`what it costs once it lands`} />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            What a landed attempt costs. The potential impact is what the asset is worth, narrowed by
            how much of it this flaw reaches, before any control. What the controls let through on
            the techniques that follow the breach then narrows it. Those techniques run wherever the
            attacker goes next, so their controls are measured on the whole estate, never on this
            asset's family alone.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <ExplanationCalc
        rows={[
          {
            label: t`impact`,
            expression: (
              <>
                <CalcOperator>=</CalcOperator> {t`potential impact`} <CalcOperator>×</CalcOperator> {t`controls let through`}
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>= (</CalcOperator><CalcSource>{formatWeight(potentialImpact.terms.criticalityFactor, at)}</CalcSource>
                <CalcOperator> × </CalcOperator><CalcSource>{formatWeight(potentialImpact.terms.cvssImpact ?? 1, at)}</CalcSource>
                <CalcOperator>) × </CalcOperator><CalcSource>{formatWeight(impactControls.value, at)}</CalcSource>
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcResult band={band}>{formatFactor(finding.impact, at)}</CalcResult>
                <CalcOperator> → {figure} / 100</CalcOperator>
              </>
            ),
          },
        ]}
      />

      <ExplanationSection label={t`Where the terms come from`}>
        <ExplanationTerms
          terms={[
            {
              label: t`Potential impact`,
              source: <PotentialImpactSource finding={finding} />,
              value: formatWeight(potentialImpact.value, at),
            },
            {
              label: t`Controls let through`,
              source: controlsSource(
                impactControls,
                <Trans>No technique is known to follow this breach, so nothing is counted as held back, and the side still counts.</Trans>,
              ),
              value: formatWeight(impactControls.value, at),
            },
          ]}
        />
      </ExplanationSection>

      <ExplanationCaveat>
        <Trans>
          This part states no amount: the amounts live on the risk scenarios and come out of another
          engine.
        </Trans>
      </ExplanationCaveat>
    </>
  );
};
