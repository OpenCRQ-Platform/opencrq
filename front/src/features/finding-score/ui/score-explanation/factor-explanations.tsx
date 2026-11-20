import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import type { AttackGroup } from '@app/module/client';
import { resolveSeverityBand, UNCLASSIFIED_ASSET_CATEGORY } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { FindingScoreBreakdown } from '../finding-score-section';
import { getAssetCategoryLabel, getAssetCriticalityLabel } from '../../../../utils';
import { CrqIndicatorsSettingsLink } from '../../../crq-indicator-settings';
import { coverageLabel } from '../../../controls/capability/ui/coverage-label';
import { strengthLabel } from '../../../controls/capability/ui/strength-label';
import { criticalityLabel, cvssMetricLabel, cvssValueLabel, exposureLabel } from '../column-vocabulary';
import { attackGroupLabel, confidenceLabel } from '../technique-mapping-vocabulary';
import {
  CalcOperator,
  CalcResult,
  CalcSource,
  ExplanationCalc,
  ExplanationCaveat,
  ExplanationDerivation,
  ExplanationHero,
  ExplanationProse,
  ExplanationSection,
  ExplanationTerms,
} from './explanation-blocks';
import { formatCreditShare, formatFactor, formatWeight, toDefenceFigure, toFigure } from './score-explanation-utils';

export type FactorSubject = 'reachability' | 'threat' | 'exploitationControls' | 'potentialImpact' | 'impactControls';

interface ExplanationProps {
  finding: FindingScoreBreakdown,
}

type ControlsFactor = FindingScoreBreakdown['factors']['exploitationControls'];
type TechniquePath = ControlsFactor['paths'][number];
type SideTechnique = FindingScoreBreakdown['columns']['exploitationTechniques'][number];
type ResistanceRuns = NonNullable<FindingScoreBreakdown['resistance']['impact']>;
type ResistanceRun = ResistanceRuns['declared'];

const locale = (): string => i18n.locale || 'en';

const VectorAccess: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const at = locale();
  const access = finding.cvss?.access;
  if (access === undefined) {
    return null;
  }
  return (
    <ExplanationDerivation label={t`Where the vector access comes from`}>
      <ExplanationProse>
        <Trans>
          Access measures how open this vector is, against the most open vector there is:
          reachable over the network, needing no privilege and no interaction. That one is worth
          1, every other is worth less.
        </Trans>
      </ExplanationProse>
      <ExplanationTerms
        terms={[
          {
            label: cvssMetricLabel('AV', finding.cvssVector),
            source: cvssValueLabel('AV', access.attackVector.value, finding.cvssVector),
            value: formatWeight(access.attackVector.weight, at),
          },
          {
            label: cvssMetricLabel('PR', finding.cvssVector),
            source: cvssValueLabel('PR', access.privilegesRequired.value, finding.cvssVector),
            value: formatWeight(access.privilegesRequired.weight, at),
          },
          {
            label: cvssMetricLabel('UI', finding.cvssVector),
            source: cvssValueLabel('UI', access.userInteraction.value, finding.cvssVector),
            value: formatWeight(access.userInteraction.weight, at),
          },
          { label: t`This vector`, value: formatWeight(access.product, at), step: true },
          { label: t`The most open vector`, value: formatWeight(access.maxProduct, at) },
          {
            label: t`Access, the one divided by the other`,
            value: formatWeight(access.product / access.maxProduct, at),
            total: true,
          },
        ]}
      />
    </ExplanationDerivation>
  );
};

export const ReachabilityExplanation: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const at = locale();
  const { value, terms } = finding.factors.reachability;
  const figure = toFigure(value);
  const band = resolveSeverityBand(figure);
  const zone = exposureLabel(finding.columns.reachability.exposure);
  const countedAs = exposureLabel(terms.exposureCountedAs);

  return (
    <>
      <ExplanationHero figure={figure} band={band} unit={t`out of 100 of exposure`} reading={t`can it be got at`} />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            Where the asset stands, narrowed by what the flaw itself demands of an attacker. The two
            multiply because they are conditions in series: reaching the asset is worth nothing if the
            flaw needs a local session and administrative rights on top.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <ExplanationCalc
        rows={[
          {
            label: t`reachability`,
            expression: (
              <>
                <CalcOperator>=</CalcOperator> {t`exposure weight`} <CalcOperator>×</CalcOperator> {t`vector access`}
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcSource>{formatWeight(terms.exposureWeight, at)}</CalcSource>
                {terms.cvssAccess !== null && (
                  <> <CalcOperator>×</CalcOperator> <CalcSource>{formatWeight(terms.cvssAccess, at)}</CalcSource></>
                )}
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcResult band={band}>{formatFactor(value, at)}</CalcResult>
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
              label: t`Exposure weight`,
              source: finding.columns.reachability.exposure === 'unknown'
                ? (
                  <Trans>
                    Zone {zone}, counted as {countedAs} by the{' '}
                    <CrqIndicatorsSettingsLink>
                      CRQ indicators
                    </CrqIndicatorsSettingsLink>, which also set its weight.
                  </Trans>
                )
                : <Trans>Zone {zone}. A tenant setting, under CRQ indicators.</Trans>,
              value: formatWeight(terms.exposureWeight, at),
            },
            ...(terms.cvssAccess === null ? [] : [{
              label: t`Vector access`,
              source: <Trans>What the published CVSS vector demands. Derived below.</Trans>,
              value: formatWeight(terms.cvssAccess, at),
            }]),
          ]}
        />
      </ExplanationSection>

      <VectorAccess finding={finding} />

      <ExplanationCaveat>
        <Trans>
          With no published vector the factor is the exposure weight alone. And that weight is a
          setting: changing it rescores the whole estate, not this finding.
        </Trans>
      </ExplanationCaveat>
    </>
  );
};

export const ThreatExplanation: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const at = locale();
  const { value, terms } = finding.factors.threat;
  const figure = toFigure(value);
  const band = resolveSeverityBand(figure);
  const { familyCount } = terms;
  const signalLabel = (family: string): string => {
    switch (family) {
      case 'exploitation_probability': return t`EPSS`;
      case 'known_exploited': return t`KEV catalogue`;
      default: return t`Active threat`;
    }
  };

  return (
    <>
      <ExplanationHero figure={figure} band={band} unit={t`out of 100 of exposure`} reading={t`is anyone doing it`} />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            Whether anyone is actually exploiting this flaw. The factor is the highest floor any
            signal sets, never a sum of signals: two sources saying the same thing are not worth
            twice the thing.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <ExplanationSection label={t`The signals heard`}>
        <ExplanationTerms
          terms={[
            {
              label: t`Base floor`,
              source: <Trans>Applies at all times, including when nothing speaks.</Trans>,
              value: formatWeight(terms.baseFloor, at),
            },
            ...terms.signals.map((signal) => ({
              label: signalLabel(signal.family),
              value: formatWeight(signal.floor, at),
            })),
            ...(familyCount >= 2 ? [{
              label: <Trans>{familyCount} independent families</Trans>,
              source: <Trans>lifted a third of the way to 1</Trans>,
              value: formatWeight(terms.lifted, at),
              step: true,
            }] : []),
            ...(terms.cvssComplexity === null ? [] : [{
              label: t`attack complexity`,
              value: formatWeight(terms.cvssComplexity, at),
            }]),
            { label: t`Threat`, value: formatWeight(value, at), total: true },
          ]}
        />
      </ExplanationSection>

      <ExplanationCaveat>
        <Trans>
          Attack complexity can only damp the result, never lift it, and never below the base floor:
          a flaw that is hard to weaponise is still being weaponised once somebody has.
        </Trans>
      </ExplanationCaveat>
    </>
  );
};

const SideTechniques: FunctionComponent<{
  label: string,
  paths: Array<TechniquePath>,
  techniques: Array<SideTechnique>,
  controlNames: Map<string, string>,
  groupShown: boolean,
  weakestNamed: boolean,
}> = ({ label, paths, techniques, controlNames, groupShown, weakestNamed }) => {
  const at = locale();
  const byTechnique = new Map(techniques.map((technique) => [technique.mitreTechniqueId, technique]));
  const weakestId = paths[0]?.techniqueId ?? null;
  const namesOf = (capabilityIds: Array<string>): Array<string> =>
    capabilityIds.map((capabilityId) => controlNames.get(capabilityId) ?? capabilityId);
  return (
    <ExplanationSection label={label}>
      <ExplanationTerms
        terms={paths.map((path) => {
          const technique = byTechnique.get(path.techniqueId);
          const externalId = technique?.externalId ?? path.techniqueId;
          const name = technique?.name ?? '';
          const group: AttackGroup | null = technique?.group ?? null;
          const notes: Array<string> = [
            ...(groupShown && group !== null ? [attackGroupLabel(group)] : []),
            ...(weakestNamed && path.techniqueId === weakestId ? [t`Weakest path`] : []),
            confidenceLabel(path.terms.claimConfidence),
          ];
          const preventing = namesOf(technique?.preventingCapabilityIds ?? []);
          const detecting = namesOf(technique?.detectingCapabilityIds ?? []);
          const preventedBy = preventing.join(', ');
          const detectedBy = detecting.join(', ');
          return {
            label: <><span className="font-content-code">{externalId}</span> {name}</>,
            source: (
              <>
                {notes.join(' · ')}
                {preventing.length === 0 && detecting.length === 0 && (
                  <span className="block"><Trans>No control credited on it.</Trans></span>
                )}
                {preventing.length > 0 && <span className="block"><Trans>Prevented by {preventedBy}</Trans></span>}
                {detecting.length > 0 && <span className="block"><Trans>Detected by {detectedBy}</Trans></span>}
              </>
            ),
            value: formatWeight(path.value, at),
          };
        })}
      />
    </ExplanationSection>
  );
};

const ResistanceRunTerms: FunctionComponent<{
  run: ResistanceRun,
  controlNames: Map<string, string>,
  totalLabel: string,
}> = ({ run, controlNames, totalLabel }) => {
  const at = locale();
  return (
    <ExplanationTerms
      terms={[
        ...run.contributions.map((contribution) => {
          const strength = strengthLabel(contribution.strengthRung);
          const coverage = coverageLabel(contribution.coverageBucket);
          const credit = formatCreditShare(run.gamma ** contribution.rank, at);
          const efficacy = formatWeight(contribution.efficacy, at);
          // A share below one is the estate spread, and without it the line above cannot
          // multiply out to the efficacy beside it.
          const share = contribution.familyWeight === 1
            ? null
            : formatCreditShare(contribution.familyWeight, at);
          return {
            label: controlNames.get(contribution.capabilityId) ?? contribution.capabilityId,
            source: (
              <>
                {share === null
                  ? <Trans>strength {strength}, coverage {coverage} : efficacy {efficacy}</Trans>
                  : <Trans>strength {strength}, coverage {coverage}, on {share} of the scope : efficacy {efficacy}</Trans>}
                <span className="block"><Trans>credited at {credit} of it</Trans></span>
              </>
            ),
            value: formatWeight(contribution.credited, at),
          };
        }),
        {
          label: t`What the controls let through, multiplied`,
          value: formatWeight(run.letThrough, at),
          step: true,
        },
        ...(run.cveSusceptibility === null ? [] : [{
          label: t`Lowered by the known vulnerabilities on this technique`,
          value: formatWeight(run.cveSusceptibility, at),
        }]),
        { label: totalLabel, value: formatWeight(run.resistance, at), total: true },
      ]}
    />
  );
};

const PathDerivation: FunctionComponent<{
  label: string,
  path: TechniquePath,
  runs: ResistanceRuns | null,
  controlNames: Map<string, string>,
}> = ({ label, path, runs, controlNames }) => {
  const at = locale();
  const { terms, value } = path;
  const prevention = runs?.declared ?? null;
  const detection = runs?.detection ?? null;
  const hasPrevention = prevention !== null && prevention.contributions.length > 0;
  const hasDetection = detection !== null && detection.contributions.length > 0;
  return (
    <ExplanationDerivation label={label}>
      <ExplanationCalc
        rows={[
          {
            label: t`prevention lets through`,
            expression: <><CalcOperator>= 1 −</CalcOperator> {t`resistance`}</>,
          },
          {
            expression: <><CalcOperator>= 1 − </CalcOperator><CalcSource>{formatWeight(terms.declaredMu, at)}</CalcSource></>,
          },
          { expression: <><CalcOperator>=</CalcOperator> {formatFactor(terms.preventionLetThrough, at)}</> },
          {
            label: t`gets through`,
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcSource>{formatWeight(terms.preventionLetThrough, at)}</CalcSource>
                <CalcOperator> × (1 − </CalcOperator><CalcSource>{formatWeight(terms.detectionCredit, at)}</CalcSource>
                <CalcOperator> × </CalcOperator><CalcSource>{formatWeight(terms.detectMu, at)}</CalcSource><CalcOperator>)</CalcOperator>
              </>
            ),
          },
          { expression: <><CalcOperator>=</CalcOperator> {formatFactor(value, at)}</> },
        ]}
      />
      <ExplanationTerms
        terms={[
          {
            label: t`Declared resistance`,
            source: hasPrevention
              ? <Trans>Not a typed figure: computed from the declared controls. Derived below.</Trans>
              : <Trans>No declared control prevents this technique, so prevention holds nothing back here.</Trans>,
            value: formatWeight(terms.declaredMu, at),
          },
          {
            label: t`Declared detection`,
            source: hasDetection
              ? <Trans>Computed from the declared controls that detect this technique. Derived below.</Trans>
              : <Trans>No declared control detects this technique.</Trans>,
            value: formatWeight(terms.detectMu, at),
          },
          {
            label: t`Most a detection takes off`,
            source: <Trans>A detected attack costs three quarters of an undetected one, the rate the risk scenarios price it at.</Trans>,
            value: formatWeight(terms.detectionCredit, at),
          },
        ]}
      />
      {hasPrevention && (
        <>
          <ExplanationProse>
            <Trans>
              Each control is worth an efficacy: a catalogue base, times its declared strength, its
              coverage, and the share of the scope it applies on.
            </Trans>
          </ExplanationProse>
          <ExplanationProse>
            <Trans>
              The controls are then ranked strongest first, and each is credited less than the one
              before it. Two controls defending the same technique catch largely the same attacks:
              the second only adds what the first was already letting through. Without that discount,
              stacking products would be enough to read a resistance close to 1 with nothing tested.
            </Trans>
          </ExplanationProse>
          <ResistanceRunTerms run={prevention} controlNames={controlNames} totalLabel={t`Resistance, what is left`} />
        </>
      )}
      {hasDetection && (
        <>
          <ExplanationProse>
            <Trans>The controls that detect it are ranked and credited the same way.</Trans>
          </ExplanationProse>
          <ResistanceRunTerms run={detection} controlNames={controlNames} totalLabel={t`Detection, what is seen`} />
        </>
      )}
    </ExplanationDerivation>
  );
};

const ControlsExplanation: FunctionComponent<{
  factor: ControlsFactor,
  measures: string,
  none: string,
  techniquesLabel: string,
  techniques: Array<SideTechnique>,
  controlNames: Map<string, string>,
  runs: ResistanceRuns | null,
  groupShown: boolean,
}> = ({ factor, measures, none, techniquesLabel, techniques, controlNames, runs, groupShown }) => {
  const at = locale();
  const { value, weakestPath, aggregation } = factor;
  const figure = toFigure(value);
  const band = resolveSeverityBand(figure);
  const weakest = weakestPath === null
    ? null
    : techniques.find((technique) => technique.mitreTechniqueId === weakestPath.techniqueId)?.externalId ?? weakestPath.techniqueId;
  const count = factor.paths.length;

  return (
    <>
      <ExplanationHero
        figure={toDefenceFigure(value)}
        band={band}
        unit={t`out of 100 of defence left standing`}
        reading={<Trans>what they hold back, so {figure} out of 100 get through</Trans>}
      />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>{measures}</ExplanationProse>
        <ExplanationProse>
          <Trans>
            A control that detects a technique takes up to a quarter off what that technique lets
            through: seeing an attack does not stop it from landing, it lowers what the landing costs.
          </Trans>
        </ExplanationProse>
        {aggregation === 'weakest' && (
          <ExplanationProse>
            <Trans>
              Every technique counts in full, whatever the confidence of the claim behind it. The
              confidence only decides which path is named when several let as much through.
            </Trans>
          </ExplanationProse>
        )}
      </ExplanationSection>

      {weakestPath === null || weakest === null
        ? <ExplanationProse>{none}</ExplanationProse>
        : (
          <>
            <ExplanationCalc
              rows={[
                aggregation === 'weakest'
                  ? { label: t`weakest path`, expression: <CalcSource>{weakest}</CalcSource> }
                  : { label: t`mean over`, expression: <CalcSource><Trans>{count} techniques</Trans></CalcSource> },
                {
                  label: t`controls let through`,
                  expression: (
                    <>
                      <CalcOperator>=</CalcOperator> <CalcResult band={band}>{formatFactor(value, at)}</CalcResult>
                      <CalcOperator> → {figure} / 100</CalcOperator>
                    </>
                  ),
                },
              ]}
            />
            <SideTechniques
              label={techniquesLabel}
              paths={factor.paths}
              techniques={techniques}
              controlNames={controlNames}
              groupShown={groupShown}
              weakestNamed={aggregation === 'weakest'}
            />
            <PathDerivation
              label={aggregation === 'weakest'
                ? t`Where the weakest path's figure comes from`
                : t`Where the figure of the technique letting the most through comes from`}
              path={weakestPath}
              runs={runs}
              controlNames={controlNames}
            />
          </>
        )}

      <ExplanationCaveat>
        <Trans>
          Even the best control is never perfect: a declared resistance is capped, so something
          always gets through. And a side no technique stands on is never dropped: it counts as
          nothing held back.
        </Trans>
      </ExplanationCaveat>
    </>
  );
};

export const ExploitationControlsExplanation: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const family = finding.assetCategoryId === UNCLASSIFIED_ASSET_CATEGORY
    ? t`the whole estate`
    : getAssetCategoryLabel(finding.assetCategoryId);
  return (
    <ControlsExplanation
      factor={finding.factors.exploitationControls}
      measures={t`What the controls let through on the weakest of the exploitation techniques, measured on ${family}. The weakest technique decides, never an average: a defence is only as good as the way round it.`}
      none={t`No exploitation technique stands in reach, so nothing is counted as held back, and the side still counts.`}
      techniquesLabel={t`Exploitation techniques · controls measured on ${family}`}
      techniques={finding.columns.exploitationTechniques}
      controlNames={new Map((finding.columns.mitigations ?? []).map((control) => [control.capabilityId, control.name]))}
      runs={finding.resistance.exploitation}
      groupShown={false}
    />
  );
};

export const ImpactControlsExplanation: FunctionComponent<ExplanationProps> = ({ finding }) => (
  <ControlsExplanation
    factor={finding.factors.impactControls}
    measures={t`What the controls let through on average over the techniques that follow the breach. Those run wherever the attacker goes next, so their controls are measured on the whole estate. The impact is priced once for the whole side, so a technique that costs nothing on its own must not decide it: the side takes the mean, over the claims of the highest confidence present.`}
    none={t`No technique is known to follow this breach, so nothing is counted as held back, and the side still counts.`}
    techniquesLabel={t`Impact techniques · controls measured on the whole estate`}
    techniques={finding.columns.impactControls.techniques}
    controlNames={new Map((finding.columns.impactControls.mitigations ?? []).map((control) => [control.capabilityId, control.name]))}
    runs={finding.resistance.impact}
    groupShown
  />
);

export const PotentialImpactSource: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const { terms } = finding.factors.potentialImpact;
  const criticality = criticalityLabel(finding.columns.potentialImpact.criticality);
  const countedAs = getAssetCriticalityLabel(terms.criticalityCountedAs);
  if (finding.columns.potentialImpact.criticality === 'unknown') {
    return terms.cvssImpact === null ? (
      <Trans>
        Criticality unknown on the asset, counted as {countedAs} by the{' '}
        <CrqIndicatorsSettingsLink>
          CRQ indicators
        </CrqIndicatorsSettingsLink>; no vector was published.
      </Trans>
    ) : (
      <Trans>
        Criticality unknown on the asset, counted as {countedAs} by the{' '}
        <CrqIndicatorsSettingsLink>
          CRQ indicators
        </CrqIndicatorsSettingsLink>, times the vector impact.
      </Trans>
    );
  }
  return terms.cvssImpact === null
    ? <Trans>Criticality {criticality}, as declared on the asset; no vector was published.</Trans>
    : <Trans>Criticality {criticality}, as declared on the asset, times the vector impact.</Trans>;
};

const CriticalitySource: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const criticality = criticalityLabel(finding.columns.potentialImpact.criticality);
  const countedAs = getAssetCriticalityLabel(finding.factors.potentialImpact.terms.criticalityCountedAs);
  return finding.columns.potentialImpact.criticality === 'unknown'
    ? (
      <Trans>
        Criticality unknown on the asset, counted as {countedAs} by the{' '}
        <CrqIndicatorsSettingsLink>
          CRQ indicators
        </CrqIndicatorsSettingsLink>.
      </Trans>
    )
    : <Trans>Criticality {criticality}, as declared on the asset.</Trans>;
};

const VectorImpact: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const at = locale();
  const impact = finding.cvss?.impact;
  if (impact === undefined) {
    return null;
  }
  return (
    <ExplanationDerivation label={t`Where the vector impact comes from`}>
      <ExplanationProse>
        <Trans>
          Impact measures this vector's damage against the vector that destroys everything:
          confidentiality, integrity and availability all fully hit. That one is worth 1.
        </Trans>
      </ExplanationProse>
      <ExplanationProse>
        <Trans>
          The three do not add up, they stack as independent hits: what is left intact is
          computed first, and the damage is the rest.
        </Trans>
      </ExplanationProse>
      <ExplanationTerms
        terms={[
          {
            label: cvssMetricLabel('C', finding.cvssVector),
            source: cvssValueLabel('C', impact.confidentiality.value, finding.cvssVector),
            value: formatWeight(impact.confidentiality.weight, at),
          },
          {
            label: cvssMetricLabel('I', finding.cvssVector),
            source: cvssValueLabel('I', impact.integrity.value, finding.cvssVector),
            value: formatWeight(impact.integrity.weight, at),
          },
          {
            label: cvssMetricLabel('A', finding.cvssVector),
            source: cvssValueLabel('A', impact.availability.value, finding.cvssVector),
            value: formatWeight(impact.availability.weight, at),
          },
          { label: t`What stays intact`, value: formatWeight(impact.intact, at), step: true },
          { label: t`This vector`, value: formatWeight(impact.damage, at) },
          { label: t`The vector that destroys everything`, value: formatWeight(impact.maxDamage, at) },
          {
            label: t`Impact, the one divided by the other`,
            value: formatWeight(impact.damage / impact.maxDamage, at),
            total: true,
          },
        ]}
      />
    </ExplanationDerivation>
  );
};

export const PotentialImpactExplanation: FunctionComponent<ExplanationProps> = ({ finding }) => {
  const at = locale();
  const { value, terms } = finding.factors.potentialImpact;
  const figure = toFigure(value);
  const band = resolveSeverityBand(figure);

  return (
    <>
      <ExplanationHero figure={figure} band={band} unit={t`out of 100 of exposure`} reading={t`what breaks if it works`} />

      <ExplanationSection label={t`What it measures`}>
        <ExplanationProse>
          <Trans>
            What the asset is worth, narrowed by how much of it this flaw actually reaches. The
            criticality answers what a total loss of this asset costs, the vector answers how much of
            that total this flaw takes: an availability-only flaw costs less than the payroll
            database going away.
          </Trans>
        </ExplanationProse>
      </ExplanationSection>

      <ExplanationCalc
        rows={[
          {
            label: t`potential impact`,
            expression: (
              <>
                <CalcOperator>=</CalcOperator> {t`criticality factor`} <CalcOperator>×</CalcOperator> {t`vector impact`}
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcSource>{formatWeight(terms.criticalityFactor, at)}</CalcSource>
                {terms.cvssImpact !== null && (
                  <> <CalcOperator>×</CalcOperator> <CalcSource>{formatWeight(terms.cvssImpact, at)}</CalcSource></>
                )}
              </>
            ),
          },
          {
            expression: (
              <>
                <CalcOperator>=</CalcOperator> <CalcResult band={band}>{formatFactor(value, at)}</CalcResult>
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
              label: t`Criticality factor`,
              source: <CriticalitySource finding={finding} />,
              value: formatWeight(terms.criticalityFactor, at),
            },
            ...(terms.cvssImpact === null ? [] : [{
              label: t`Vector impact`,
              source: <Trans>What the published CVSS vector says of the damage. Derived below.</Trans>,
              value: formatWeight(terms.cvssImpact, at),
            }]),
          ]}
        />
      </ExplanationSection>

      <VectorImpact finding={finding} />

      <ExplanationCaveat>
        <Trans>
          This factor states no amount: the amounts live on the risk scenarios and come out of another
          engine.
        </Trans>
      </ExplanationCaveat>
    </>
  );
};
