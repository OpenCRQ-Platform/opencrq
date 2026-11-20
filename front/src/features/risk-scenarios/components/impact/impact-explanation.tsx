import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { InheritedCriteria, SeverityBand, SupportToPrimaryLinkRole } from '@app/module/client';
import { CRITERION_GRADE_VALUES, IMPACT_HOP_FACTOR, inheritedCriteriaOfRoles, resolveSeverityBand, wholePercent } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import type { ChainAsset, ImpactContributionView } from './impact-explanation-utils';
import type { LinkAttackShare } from '../../../asset-dependencies/dependency-graph-utils';
import { assetNameText } from '../../../../utils/asset-name-utils';
import {
  CalcOperator,
  CalcResult,
  CalcSource,
  ExplanationCalc,
  ExplanationCaveat,
  ExplanationDialogButton,
  ExplanationHero,
  ExplanationProse,
  ExplanationSection,
  ExplanationTerms,
} from '../../../finding-score';
import {
  getCriterionInheritanceWord,
  getCriterionReachWord,
  getLinkRoleLabel,
  getLinkRoleVerb,
  getSecurityCriterionLabel,
} from '../../../asset-dependencies/link-role-labels';
import { securityCriteriaOrder } from '../../../asset-dependencies/link-roles-utils';
import { formatWholePercent } from '../../../asset-dependencies/dependency-graph-utils';
import { dependentShare, hopTargets, impactExplanationShape, primaryAssetPart } from './impact-explanation-utils';

export interface ImpactScenarioContext {
  outcomeName: string,
  criteriaReached: InheritedCriteria,
  primaryAssetCount: number,
}

const locale = (): string => i18n.locale || 'en';

const formatGrade = (value: number): string => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value);

const formatImpactPercent = (fraction: number): string => formatWholePercent(fraction, locale());

const listOf = (words: Array<string>): string => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(words);

const roleVerbs = (roles: Array<SupportToPrimaryLinkRole>): string => listOf(roles.map(getLinkRoleVerb));

const impactBand = (fraction: number): SeverityBand => resolveSeverityBand(wholePercent(fraction));

const nameOf = (asset: ChainAsset | undefined): string => assetNameText(asset ?? { name: null, derivedName: null }, t`Unnamed asset`);

export const CriteriaCrossedTable: FunctionComponent<{
  context: Pick<ImpactScenarioContext, 'outcomeName' | 'criteriaReached'>,
  roles: Array<SupportToPrimaryLinkRole>,
  criteria: InheritedCriteria,
  outcomeTotal: number,
  transmittedTotal: number,
}> = ({ context, roles, criteria, outcomeTotal, transmittedTotal }) => {
  const cellClassName = 'py-[6px] px-3 text-left align-top';
  const grade = (value: number): ReactNode => <CalcSource>{formatGrade(value)}</CalcSource>;
  return (
    <table className="w-full border-collapse font-content-compact text-content-compact">
      <thead>
        <tr className="text-default-secondary">
          <th scope="col" className={`${cellClassName} pl-0 font-normal`}>{t`Criterion`}</th>
          <th scope="col" className={`${cellClassName} font-normal`}>{context.outcomeName}</th>
          <th scope="col" className={`${cellClassName} font-normal`}>{roles.map(getLinkRoleLabel).join(', ')}</th>
          <th scope="col" className={`${cellClassName} pr-0 text-right font-normal`}>{t`Product`}</th>
        </tr>
      </thead>
      <tbody>
        {securityCriteriaOrder(locale()).map((criterion) => {
          const reached = CRITERION_GRADE_VALUES[context.criteriaReached[criterion]];
          const inherited = CRITERION_GRADE_VALUES[criteria[criterion]];
          return (
            <tr key={criterion}>
              <td className={`${cellClassName} pl-0`}>{getSecurityCriterionLabel(criterion)}</td>
              <td className={cellClassName}>{getCriterionReachWord(context.criteriaReached[criterion])} {grade(reached)}</td>
              <td className={cellClassName}>{getCriterionInheritanceWord(criteria[criterion])} {grade(inherited)}</td>
              <td className={`${cellClassName} pr-0 text-right font-medium tabular-nums`}>{formatGrade(reached * inherited)}</td>
            </tr>
          );
        })}
        <tr className="font-bold">
          <td className={`${cellClassName} pl-0 border-t border-[var(--fds-border-elevation-subtle)]`}>{t`Total`}</td>
          <td className={`${cellClassName} border-t border-[var(--fds-border-elevation-subtle)] tabular-nums`}>{formatGrade(outcomeTotal)}</td>
          <td className={`${cellClassName} border-t border-[var(--fds-border-elevation-subtle)]`} />
          <td className={`${cellClassName} pr-0 text-right border-t border-[var(--fds-border-elevation-subtle)] tabular-nums`}>{formatGrade(transmittedTotal)}</td>
        </tr>
      </tbody>
    </table>
  );
};

const shareCalcRow = (contribution: LinkAttackShare) => ({
  label: t`share of the attack transmitted`,
  expression: (
    <>
      <CalcOperator>= </CalcOperator>
      <CalcSource>{formatGrade(contribution.transmittedTotal)}</CalcSource>
      <CalcOperator> / </CalcOperator>
      <CalcSource>{formatGrade(contribution.outcomeTotal)}</CalcSource>
      <CalcOperator> = </CalcOperator>
      {formatImpactPercent(contribution.share)}
    </>
  ),
});

const primaryShareCalcRow = (primaryAssetCount: number) => ({
  label: t`share of the primary asset`,
  expression: (
    <>
      <CalcOperator>= </CalcOperator>
      <CalcSource>1</CalcSource>
      <CalcOperator> / </CalcOperator>
      <CalcSource>{primaryAssetCount}</CalcSource>
      <CalcOperator> = </CalcOperator>
      {formatImpactPercent(primaryAssetCount === 0 ? 0 : 1 / primaryAssetCount)}
    </>
  ),
});

const hopFactors = (hops: number): ReactNode => Array.from({ length: hops }, (_, index) => (
  <span key={index}>
    <CalcOperator> × </CalcOperator>
    <CalcSource>{formatGrade(IMPACT_HOP_FACTOR)}</CalcSource>
  </span>
));

const hopTerms = (assetName: string, chain: Array<ChainAsset>) =>
  hopTargets<ChainAsset>({ id: '', name: assetName, derivedName: null }, chain).map((target, index) => {
    const targetName = nameOf(target);
    const depth = index + 1;
    return {
      label: t`Hop to ${targetName}`,
      source: t`Transitive (${depth})`,
      value: `× ${formatGrade(IMPACT_HOP_FACTOR)}`,
      step: true,
    };
  });

const MeasuresDirect: FunctionComponent = () => (
  <ExplanationSection label={t`What it measures`}>
    <ExplanationProse>
      <Trans>
        The share of the scenario's loss that would pass through this asset if it were compromised.
        Each role of a link transmits some criteria of the primary asset, and the attack outcome says
        which ones count for this scenario.
      </Trans>
    </ExplanationProse>
  </ExplanationSection>
);

const MeasuresTransitive: FunctionComponent = () => (
  <ExplanationSection label={t`What it measures`}>
    <ExplanationProse>
      <Trans>
        The share of the scenario's loss that would pass through this asset if it were compromised.
        An asset that touches no primary asset takes the share of the one it runs, halved at every hop.
      </Trans>
    </ExplanationProse>
  </ExplanationSection>
);

const ExposureCaveat: FunctionComponent = () => (
  <ExplanationCaveat>
    <Trans>
      The percentage does not say whether the asset is exposed: a well protected asset at 100% can
      come after an asset at 35% open to the Internet.
    </Trans>
  </ExplanationCaveat>
);

const DirectExplanation: FunctionComponent<{
  assetName: string,
  impact: number,
  contribution: ImpactContributionView,
  context: ImpactScenarioContext,
}> = ({ assetName, impact, contribution, context }) => {
  const band = impactBand(impact);
  const roles = roleVerbs(contribution.roles);
  const { primaryAssetName } = contribution;
  const n = context.primaryAssetCount;
  return (
    <>
      <ExplanationHero
        figure={wholePercent(impact)}
        band={band}
        unit={t`% of the scenario's loss`}
        reading={<Trans>{assetName} {roles} {primaryAssetName}, one of the scenario's {n} primary assets.</Trans>}
      />
      <MeasuresDirect />
      <ExplanationSection label={t`Criteria crossed`}>
        <CriteriaCrossedTable context={context} {...contribution} />
      </ExplanationSection>
      <ExplanationCalc
        rows={[
          shareCalcRow(contribution),
          primaryShareCalcRow(n),
          {
            label: t`impact if compromised`,
            break: true,
            expression: (
              <>
                <CalcOperator>= </CalcOperator>
                {formatImpactPercent(contribution.share)}
                <CalcOperator> × </CalcOperator>
                {formatImpactPercent(n === 0 ? 0 : 1 / n)}
                <CalcOperator> = </CalcOperator>
                <CalcResult band={band}>{formatImpactPercent(impact)}</CalcResult>
              </>
            ),
          },
        ]}
      />
      <ExposureCaveat />
    </>
  );
};

const TransitiveExplanation: FunctionComponent<{
  assetName: string,
  impact: number,
  chain: Array<ChainAsset>,
  hops: number,
  contributions: Array<ImpactContributionView>,
  context: ImpactScenarioContext,
}> = ({ assetName, impact, chain, hops, contributions, context }) => {
  const band = impactBand(impact);
  const dependent = nameOf(chain[0]);
  const pct = wholePercent(dependentShare(impact));
  const directAssetName = nameOf(chain.at(-1));
  const n = context.primaryAssetCount;
  const reached = contributions.length;
  const parts = contributions.map((contribution) => primaryAssetPart(contribution, n));
  const beforeHops = parts.reduce((sum, part) => sum + part, 0);
  return (
    <>
      <ExplanationHero
        figure={wholePercent(impact)}
        band={band}
        unit={t`% of the scenario's loss`}
        reading={<Trans>{assetName} runs {dependent}, which carries {pct}% of the loss. One hop further, its share is halved.</Trans>}
      />
      <MeasuresTransitive />
      <ExplanationSection label={t`Path`}>
        <ExplanationTerms
          terms={[
            ...contributions.map((contribution, index) => {
              const roles = roleVerbs(contribution.roles);
              const share = wholePercent(contribution.share);
              return {
                label: contribution.primaryAssetName,
                source: t`${directAssetName} ${roles}, share of the attack transmitted ${share}%, 1 primary asset out of ${n}`,
                value: formatImpactPercent(parts[index] ?? 0),
              };
            }),
            {
              label: directAssetName,
              source: plural(reached, { one: 'Its only primary asset', other: 'Sum of its # primary assets' }),
              value: formatImpactPercent(beforeHops),
              step: true,
            },
            ...hopTerms(assetName, chain),
            { label: t`Impact if compromised`, value: formatImpactPercent(impact), total: true },
          ]}
        />
      </ExplanationSection>
      <ExplanationCalc
        rows={[
          {
            label: directAssetName,
            expression: (
              <>
                <CalcOperator>= </CalcOperator>
                {parts.map((part, index) => (
                  <span key={index}>
                    {index > 0 && <CalcOperator> + </CalcOperator>}
                    <CalcSource>{formatImpactPercent(part)}</CalcSource>
                  </span>
                ))}
                <CalcOperator> = </CalcOperator>
                {formatImpactPercent(beforeHops)}
              </>
            ),
          },
          {
            label: t`impact if compromised`,
            break: true,
            expression: (
              <>
                <CalcOperator>= </CalcOperator>
                {formatImpactPercent(beforeHops)}
                {hopFactors(hops)}
                <CalcOperator> = </CalcOperator>
                <CalcResult band={band}>{formatImpactPercent(impact)}</CalcResult>
              </>
            ),
          },
        ]}
      />
      <ExplanationCaveat>
        <Trans>A link between two supporting assets carries no role: {assetName} takes on everything {dependent} inherits.</Trans>
      </ExplanationCaveat>
    </>
  );
};

const MixedExplanation: FunctionComponent<{
  assetName: string,
  impact: number,
  contributions: Array<ImpactContributionView>,
  context: ImpactScenarioContext,
}> = ({ assetName, impact, contributions, context }) => {
  const band = impactBand(impact);
  const n = context.primaryAssetCount;
  const reached = contributions.length;
  return (
    <>
      <ExplanationHero
        figure={wholePercent(impact)}
        band={band}
        unit={t`% of the scenario's loss`}
        reading={<Trans>{assetName} reaches {reached} of the scenario's {n} primary assets. Its impact adds up its best path to each.</Trans>}
      />
      {contributions.every((contribution) => contribution.hops > 0) ? <MeasuresTransitive /> : <MeasuresDirect />}
      {contributions.map((contribution) => {
        const directAssetName = contribution.hops === 0 ? assetName : nameOf(contribution.chain.at(-1));
        const roles = roleVerbs(contribution.roles);
        const share = wholePercent(contribution.share);
        return (
          <ExplanationSection key={contribution.primaryAssetId} label={contribution.primaryAssetName}>
            {contribution.hops === 0
              ? (
                <>
                  <CriteriaCrossedTable context={context} {...contribution} />
                  <ExplanationCalc
                    rows={[
                      shareCalcRow(contribution),
                      {
                        label: t`impact if compromised`,
                        expression: (
                          <>
                            <CalcOperator>= </CalcOperator>
                            {formatImpactPercent(contribution.share)}
                            <CalcOperator> / </CalcOperator>
                            <CalcSource>{n}</CalcSource>
                            <CalcOperator> = </CalcOperator>
                            {formatImpactPercent(contribution.contribution)}
                          </>
                        ),
                      },
                    ]}
                  />
                </>
              )
              : (
                <ExplanationTerms
                  terms={[
                    {
                      label: directAssetName,
                      source: t`${directAssetName} ${roles}, share of the attack transmitted ${share}%, 1 primary asset out of ${n}`,
                      value: formatImpactPercent(primaryAssetPart(contribution, n)),
                    },
                    ...hopTerms(assetName, contribution.chain),
                    { label: t`impact if compromised`, value: formatImpactPercent(contribution.contribution), total: true },
                  ]}
                />
              )}
          </ExplanationSection>
        );
      })}
      <ExplanationCalc
        rows={[{
          label: t`impact if compromised`,
          expression: (
            <>
              <CalcOperator>= </CalcOperator>
              {contributions.map((contribution, index) => (
                <span key={contribution.primaryAssetId}>
                  {index > 0 && <CalcOperator> + </CalcOperator>}
                  <CalcSource>{formatImpactPercent(contribution.contribution)}</CalcSource>
                </span>
              ))}
              <CalcOperator> = </CalcOperator>
              <CalcResult band={band}>{formatImpactPercent(impact)}</CalcResult>
            </>
          ),
        }]}
      />
      <ExposureCaveat />
    </>
  );
};

/** Rebuilds the figure from the payload alone, never recomputing it. */
export const ImpactExplanationButton: FunctionComponent<{
  assetName: string,
  impact: number,
  contributions: Array<ImpactContributionView>,
  context: ImpactScenarioContext,
}> = ({ assetName, impact, contributions, context }) => {
  const shape = impactExplanationShape(contributions);
  return (
    <ExplanationDialogButton
      triggerLabel={t`How the impact if compromised of ${assetName} is computed`}
      title={t`Impact if compromised`}
    >
      {shape.kind === 'direct' && (
        <DirectExplanation assetName={assetName} impact={impact} contribution={shape.contribution} context={context} />
      )}
      {shape.kind === 'transitive' && (
        <TransitiveExplanation
          assetName={assetName}
          impact={impact}
          chain={shape.chain}
          hops={shape.hops}
          contributions={shape.contributions}
          context={context}
        />
      )}
      {shape.kind === 'mixed' && (
        <MixedExplanation assetName={assetName} impact={impact} contributions={shape.contributions} context={context} />
      )}
    </ExplanationDialogButton>
  );
};

/** The criteria table of one link alone, without any primary asset's share. */
export const LinkShareExplanationButton: FunctionComponent<{
  context: Pick<ImpactScenarioContext, 'outcomeName' | 'criteriaReached'>,
  roles: Array<SupportToPrimaryLinkRole>,
  attackShare: LinkAttackShare,
}> = ({ context, roles, attackShare }) => (
  <ExplanationDialogButton
    triggerLabel={t`How the share of the attack transmitted is computed`}
    title={t`Share of the attack transmitted`}
  >
    <ExplanationSection label={t`Criteria crossed`}>
      <CriteriaCrossedTable context={context} roles={roles} criteria={inheritedCriteriaOfRoles(roles)} {...attackShare} />
    </ExplanationSection>
    <ExplanationCalc rows={[shareCalcRow(attackShare)]} />
  </ExplanationDialogButton>
);
