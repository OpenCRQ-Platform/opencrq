import { Button } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { COVERAGE_COEFFICIENTS, STRENGTH_BY_RUNG } from '@app/module/client';
import type { CapabilityFunction, PhishingStageName } from '@app/module/client';
import { roundPercentPoints } from '@app/utils/decimals';
import type { FunctionComponent, MouseEvent, ReactNode } from 'react';
import type { ExplanationTerm, ExplanationTone } from '../../../finding-score';
import type { EfficacyVerdict, EvidenceLink } from '../utils/engine-efficacy-utils';
import type { CoveredTechniqueTestReading, TechniqueDeclaration, TechniqueTestOutcome, TechniqueTestReading, UncoveredTechniqueTestReading } from '../types/validation';
import {
  CalcOperator,
  CalcResult,
  CalcSource,
  ExplanationCalc,
  ExplanationDialog,
  ExplanationDialogButton,
  ExplanationHero,
  ExplanationProse,
  ExplanationSection,
  ExplanationTerms,
} from '../../../finding-score';
import { useTechniqueLink } from '../hooks/use-technique-link';
import { coverageLabel } from '../ui/coverage-label';
import { strengthLabel } from '../ui/strength-label';
import {
  DECLARATION_CEILING,
  displayedCalculation,
  displayedDeclaration,
  efficacyReadingOf,
  efficacyVerdict,
  failedTests,
  formatEnginePercent,
  formatEnginePoints,
  isEveryTest,
  parentExternalIdOf,
} from '../utils/engine-efficacy-utils';
import { hostCountText, testCountText } from '../ui/test-result-text';

const VERDICT_TONE: Record<EfficacyVerdict, ExplanationTone> = {
  lowered: { feedback: 'warning' },
  confirmed: { feedback: 'info' },
  untested: { feedback: null },
};

const verdictLabel = (verdict: EfficacyVerdict): string => {
  switch (verdict) {
    case 'lowered': return t`Lowered by the tests`;
    case 'confirmed': return t`Confirmed by the tests`;
    case 'untested': return t`Not tested`;
  }
};

const functionLabel = (capabilityFunction: CapabilityFunction): string =>
  (capabilityFunction === 'prevent' ? t`Prevention` : t`Detection`);

interface ReadingProps {
  control: string,
  capabilityFunction: CapabilityFunction,
  declared: string,
}

const LoweredReading: FunctionComponent<ReadingProps & { tested: TechniqueTestOutcome }> = ({ control, capabilityFunction, declared, tested }) => {
  const share = formatEnginePercent(tested.share);
  const failed = failedTests(tested);
  const { tests } = tested;
  if (isEveryTest(failed, tested)) {
    return capabilityFunction === 'prevent'
      ? plural(tests, {
        one: `The declaration, ${declared}, drops because OpenAEV saw ${control} fail its only test, run on hosts that make up ${share} of the estate.`,
        other: `The declaration, ${declared}, drops because OpenAEV saw ${control} fail all # tests, run on hosts that make up ${share} of the estate.`,
      })
      : plural(tests, {
        one: `The declaration, ${declared}, drops because OpenAEV saw ${control} miss the technique in its only test, run on hosts that make up ${share} of the estate.`,
        other: `The declaration, ${declared}, drops because OpenAEV saw ${control} miss the technique in all # tests, run on hosts that make up ${share} of the estate.`,
      });
  }
  return capabilityFunction === 'prevent'
    ? <Trans>The declaration, {declared}, drops because OpenAEV saw {control} fail {failed} of the {tests} tests, run on hosts that make up {share} of the estate.</Trans>
    : <Trans>The declaration, {declared}, drops because OpenAEV saw {control} miss the technique in {failed} of the {tests} tests, run on hosts that make up {share} of the estate.</Trans>;
};

const ConfirmedReading: FunctionComponent<ReadingProps & { tested: TechniqueTestOutcome }> = ({ control, capabilityFunction, declared, tested }) => {
  const { heldTests, tests } = tested;
  if (isEveryTest(heldTests, tested)) {
    return capabilityFunction === 'prevent'
      ? plural(tests, {
        one: `OpenAEV saw ${control} hold in its only test, at least as well as the declaration: the efficacy stays at ${declared}.`,
        other: `OpenAEV saw ${control} hold in all # tests, at least as well as the declaration: the efficacy stays at ${declared}.`,
      })
      : plural(tests, {
        one: `OpenAEV saw ${control} detect the technique in its only test, at least as well as the declaration: the efficacy stays at ${declared}.`,
        other: `OpenAEV saw ${control} detect the technique in all # tests, at least as well as the declaration: the efficacy stays at ${declared}.`,
      });
  }
  return capabilityFunction === 'prevent'
    ? <Trans>OpenAEV saw {control} hold in {heldTests} of the {tests} tests, at least as well as the declaration: the efficacy stays at {declared}.</Trans>
    : <Trans>OpenAEV saw {control} detect the technique in {heldTests} of the {tests} tests, at least as well as the declaration: the efficacy stays at {declared}.</Trans>;
};

/** The tests as they went, with no claim on how they compare with the declaration they left as it was. */
const UnmovedReading: FunctionComponent<ReadingProps & { tested: TechniqueTestOutcome }> = ({ control, capabilityFunction, declared, tested }) => {
  const share = formatEnginePercent(tested.share);
  const { heldTests, tests } = tested;
  if (heldTests === 0) {
    return capabilityFunction === 'prevent'
      ? plural(tests, {
        one: `OpenAEV saw ${control} fail its only test, on hosts making up ${share} of the estate: the efficacy stays at ${declared}.`,
        other: `OpenAEV saw ${control} fail all # tests, on hosts making up ${share} of the estate: the efficacy stays at ${declared}.`,
      })
      : plural(tests, {
        one: `OpenAEV saw ${control} miss the technique in its only test, on hosts making up ${share} of the estate: the efficacy stays at ${declared}.`,
        other: `OpenAEV saw ${control} miss the technique in all # tests, on hosts making up ${share} of the estate: the efficacy stays at ${declared}.`,
      });
  }
  return capabilityFunction === 'prevent'
    ? <Trans>OpenAEV saw {control} hold in {heldTests} of the {tests} tests, on hosts making up {share} of the estate: the efficacy stays at {declared}.</Trans>
    : <Trans>OpenAEV saw {control} detect the technique in {heldTests} of the {tests} tests, on hosts making up {share} of the estate: the efficacy stays at {declared}.</Trans>;
};

const strengthSource = (capabilityFunction: CapabilityFunction, strength: number): string => {
  if (capabilityFunction === 'detect') {
    return t`Strength of the signal it raises on the technique where the control is in place.`;
  }
  const stopped = roundPercentPoints(strength, 0);
  return plural(stopped, {
    one: 'Stops the technique # time out of 100 where the control is in place.',
    other: 'Stops the technique # times out of 100 where the control is in place.',
  });
};

const anchorSource = (stage: PhishingStageName): string => {
  switch (stage) {
    case 'delivery': return t`Applies at the email's delivery, in place of the shared strength scale.`;
    case 'credential': return t`Applies at the credential stage, in place of the shared strength scale.`;
    case 'payload': return t`Applies at the payload stage, in place of the shared strength scale.`;
  }
};

const strengthTerm = (declaration: TechniqueDeclaration, capabilityFunction: CapabilityFunction, strength: string): ExplanationTerm => {
  const strengthRung = strengthLabel(declaration.strengthRung);
  return declaration.phishingStage === null
    ? { label: <Trans>Strength {strengthRung}</Trans>, source: strengthSource(capabilityFunction, declaration.strength), value: strength }
    : { label: <Trans>Stage anchor for {strengthRung}</Trans>, source: anchorSource(declaration.phishingStage), value: strength };
};

const declarationTerms = (declaration: TechniqueDeclaration, capabilityFunction: CapabilityFunction, declaredShare: number): Array<ExplanationTerm> => {
  const coverageBucket = coverageLabel(declaration.coverageBucket);
  const shown = displayedDeclaration(declaration, declaredShare);
  const strength = formatEnginePoints(shown.strength);
  const coverage = formatEnginePoints(shown.coverage);
  const declared = formatEnginePoints(shown.declared);
  return [
    strengthTerm(declaration, capabilityFunction, strength),
    { label: <Trans>Coverage {coverageBucket}</Trans>, source: t`Share of the estate equipped.`, value: coverage },
    {
      label: t({ message: 'Declared', context: 'engine efficacy' }),
      value: <>{strength} × {coverage} {shown.exact ? '=' : '≈'} {declared}</>,
      total: true,
    },
  ];
};

const testedTerms = (tested: TechniqueTestOutcome, capabilityFunction: CapabilityFunction): Array<ExplanationTerm> => [
  { label: t`Result`, source: testCountText(capabilityFunction, tested), value: formatEnginePercent(tested.rate) },
  { label: t`Tested share`, source: hostCountText(tested), value: formatEnginePercent(tested.share) },
];

/** A technique's result counts its sub-techniques' tests with its own, which its figures alone do not say. */
const TestedSection: FunctionComponent<{ tested: TechniqueTestOutcome, capabilityFunction: CapabilityFunction, techniqueExternalId: string }> = ({
  tested,
  capabilityFunction,
  techniqueExternalId,
}) => (
  <ExplanationSection label={t`What was tested · OpenAEV`}>
    <ExplanationTerms terms={testedTerms(tested, capabilityFunction)} />
    {parentExternalIdOf(techniqueExternalId) === null && (
      <ExplanationProse>
        <Trans>These tests add up those run on {techniqueExternalId} and on each of its sub-techniques.</Trans>
      </ExplanationProse>
    )}
  </ExplanationSection>
);

const calculationRows = (reading: CoveredTechniqueTestReading, verdict: EfficacyVerdict): Array<{ label?: ReactNode, expression: ReactNode, break?: boolean }> => {
  const shown = displayedCalculation(reading);
  const declared = formatEnginePoints(shown.declared);
  const efficacy = <CalcResult {...VERDICT_TONE[verdict]}>{formatEnginePoints(shown.efficacy)}</CalcResult>;
  if (shown.rate === null || shown.share === null) {
    return [{ label: t`efficacy`, expression: <><CalcOperator>=</CalcOperator> {efficacy}<CalcOperator>{t`, the declaration`}</CalcOperator></> }];
  }
  const rate = formatEnginePoints(shown.rate);
  if (shown.gap === 0 && shown.removal === 0) {
    return [
      {
        label: t`gap`,
        expression: (
          <>
            <CalcOperator>=</CalcOperator> <CalcSource>{declared}</CalcSource> <CalcOperator>−</CalcOperator> <CalcSource>{rate}</CalcSource>
            {shown.rate > shown.declared
              ? <CalcOperator>{t`: the tests do better, no gap`}</CalcOperator>
              : <>{' '}<CalcOperator>=</CalcOperator> {formatEnginePoints(0)}</>}
          </>
        ),
      },
      { label: t`removal`, expression: <><CalcOperator>=</CalcOperator> {formatEnginePoints(0)}</> },
      { label: t`efficacy`, expression: <><CalcOperator>=</CalcOperator> {efficacy}<CalcOperator>{t`, the declaration`}</CalcOperator></> },
    ];
  }
  const share = formatEnginePoints(shown.share);
  const gap = formatEnginePoints(shown.gap);
  const removal = formatEnginePoints(shown.removal);
  return [
    {
      label: t`gap`,
      expression: (
        <>
          <CalcOperator>=</CalcOperator> <CalcSource>{declared}</CalcSource> <CalcOperator>−</CalcOperator> <CalcSource>{rate}</CalcSource>{' '}
          <CalcOperator>=</CalcOperator> {gap}
        </>
      ),
    },
    {
      label: t`weight`,
      expression: <><CalcOperator>=</CalcOperator> <CalcSource>{share}</CalcSource><CalcOperator>{t` of the estate tested`}</CalcOperator></>,
    },
    {
      label: t`removal`,
      expression: <><CalcOperator>= {gap} × {share} {shown.removalRounded ? '≈' : '='}</CalcOperator> {removal}</>,
      break: true,
    },
    {
      label: t`efficacy`,
      expression: <><CalcOperator>= {declared} − {removal} =</CalcOperator> {efficacy}</>,
      break: true,
    },
  ];
};

interface EngineEfficacyExplanationProps {
  reading: TechniqueTestReading,
  /** The control's short name, its catalogue id. */
  control: string,
  techniqueExternalId: string,
  techniqueName: string,
  /** Beside Close, where the evidence behind the result can be read. */
  footerAction?: ReactNode,
}

const WhatItMeasures: FunctionComponent<{ capabilityFunction: CapabilityFunction }> = ({ capabilityFunction }) => (
  <ExplanationSection label={t`What it measures`}>
    <ExplanationProse>
      {capabilityFunction === 'prevent'
        ? (
          <Trans>
            The chance this control stops the technique when an attacker uses it. The engine uses it in every simulated
            attack: the lower it is, the further the attack goes, and the higher the annualized loss expectancy (ALE).
          </Trans>
        )
        : (
          <Trans>
            How strongly this control signals the technique when an attacker uses it. The engine combines that signal with
            how noisy the technique is, how stealthy the attacker is and what it already noticed earlier in the attack, to
            decide whether the attack is caught in time: the lower it is, the more often the attack goes unnoticed, and the
            higher the annualized loss expectancy (ALE).
          </Trans>
        )}
    </ExplanationProse>
  </ExplanationSection>
);

/** A result on a technique the control does not cover: what was tested, and why the engine leaves it out. */
const UncoveredDeclaration: FunctionComponent<{ reading: UncoveredTechniqueTestReading, control: string, techniqueExternalId: string }> = ({
  reading,
  control,
  techniqueExternalId,
}) => {
  const parentExternalId = parentExternalIdOf(techniqueExternalId);
  if (parentExternalId !== null) {
    return reading.tested === null
      ? <Trans>The engine prices {parentExternalId}, which {control} does not cover, so it reads no declaration of it here.</Trans>
      : <Trans>The engine prices {parentExternalId}, which {control} does not cover, so it does not count these tests.</Trans>;
  }
  return reading.tested === null
    ? <Trans>{control} does not cover this technique, so the engine reads no declaration of it here.</Trans>
    : <Trans>{control} does not cover this technique, so the engine does not count these tests.</Trans>;
};

const UncoveredBody: FunctionComponent<{ reading: UncoveredTechniqueTestReading, control: string, techniqueExternalId: string }> = ({
  reading,
  control,
  techniqueExternalId,
}) => (
  <>
    {/* A sub-technique is priced on its parent, so linking it alone would not count its tests. */}
    {reading.tested === null || parentExternalIdOf(techniqueExternalId) !== null
      ? (
        <ExplanationHero
          feedback={null}
          figure="—"
          unit={t({ message: 'Not covered', context: 'engine efficacy' })}
          reading={<Trans>The engine prices {control} only on the techniques it covers.</Trans>}
        />
      )
      : (
        <ExplanationHero
          feedback="warning"
          figure="—"
          unit={t`Tested, not declared`}
          reading={(
            <Trans>
              OpenAEV tests {control} on this technique, which {control} does not declare, so the engine leaves these tests out.
              If {control} does act on it, declare the technique on {control}.
            </Trans>
          )}
        />
      )}

    <WhatItMeasures capabilityFunction={reading.function} />

    <ExplanationSection label={t`What was declared`}>
      <ExplanationProse>
        <UncoveredDeclaration reading={reading} control={control} techniqueExternalId={techniqueExternalId} />
      </ExplanationProse>
    </ExplanationSection>

    {reading.tested !== null && <TestedSection tested={reading.tested} capabilityFunction={reading.function} techniqueExternalId={techniqueExternalId} />}
  </>
);

const EngineEfficacyBody: FunctionComponent<Pick<EngineEfficacyExplanationProps, 'reading' | 'control' | 'techniqueExternalId'>> = ({
  reading,
  control,
  techniqueExternalId,
}) => (reading.covered
  ? <CoveredBody reading={reading} control={control} techniqueExternalId={techniqueExternalId} />
  : <UncoveredBody reading={reading} control={control} techniqueExternalId={techniqueExternalId} />);

const CoveredBody: FunctionComponent<{ reading: CoveredTechniqueTestReading, control: string, techniqueExternalId: string }> = ({
  reading,
  control,
  techniqueExternalId,
}) => {
  const verdict = efficacyVerdict(reading);
  const opening = efficacyReadingOf(reading);
  const parentExternalId = parentExternalIdOf(techniqueExternalId);
  const parentEfficacy = reading.parentEfficacy === null ? null : formatEnginePercent(reading.parentEfficacy);
  const declared = formatEnginePercent(reading.declared);
  const capabilityFunction = reading.function;
  const ceiling = formatEnginePercent(DECLARATION_CEILING);
  const topStrength = strengthLabel('L3');
  const topStrengthShare = formatEnginePercent(STRENGTH_BY_RUNG.L3);
  const fullCoverage = coverageLabel('L3');
  const fullCoverageShare = formatEnginePercent(COVERAGE_COEFFICIENTS.L3);
  const whole = formatEnginePercent(1);
  return (
    <>
      <ExplanationHero
        {...VERDICT_TONE[verdict]}
        figure={formatEnginePercent(reading.efficacy)}
        unit={verdictLabel(verdict)}
        reading={reading.tested === null
          ? <Trans>OpenAEV has not tested {control} on this technique, so the efficacy is the declaration, {declared}.</Trans>
          : {
            lowered: <LoweredReading control={control} capabilityFunction={capabilityFunction} declared={declared} tested={reading.tested} />,
            confirmed: <ConfirmedReading control={control} capabilityFunction={capabilityFunction} declared={declared} tested={reading.tested} />,
            unmoved: <UnmovedReading control={control} capabilityFunction={capabilityFunction} declared={declared} tested={reading.tested} />,
            untested: null,
          }[opening]}
      />

      {parentExternalId !== null && parentEfficacy !== null && (
        <ExplanationProse>
          <Trans>The engine prices {parentExternalId}, where this control reads {parentEfficacy}.</Trans>
        </ExplanationProse>
      )}

      <WhatItMeasures capabilityFunction={capabilityFunction} />

      {reading.declaration !== null && (
        <ExplanationSection label={t`What was declared · ${declared}`}>
          <ExplanationTerms terms={declarationTerms(reading.declaration, capabilityFunction, reading.declared)} />
          <ExplanationProse>
            {reading.declaration.phishingStage === null
              ? (
                <Trans>
                  A single control is declared at {ceiling} at most: strength {topStrength} ({topStrengthShare}) on {fullCoverage} coverage
                  ({fullCoverageShare}). It cannot be declared at {whole}.
                </Trans>
              )
              : (
                <Trans>
                  At its phishing stage the engine reads {control} at a value set per strength rung for that stage, not on the shared scale,
                  which holds a single control at {ceiling} at most.
                </Trans>
              )}
          </ExplanationProse>
        </ExplanationSection>
      )}

      {reading.tested !== null && <TestedSection tested={reading.tested} capabilityFunction={capabilityFunction} techniqueExternalId={techniqueExternalId} />}

      <ExplanationSection label={t`The calculation`}>
        <ExplanationCalc rows={calculationRows(reading, verdict)} />
      </ExplanationSection>

      <ExplanationProse>
        <Trans>
          When the tests succeed less often than declared, the efficacy loses the gap in proportion to the share of the estate
          tested: all of it if every host was tested, half of it if half were. When they do as well or better, or when the technique
          was not tested, the efficacy stays at the declaration: the tests never raise it.
        </Trans>
      </ExplanationProse>
    </>
  );
};

const dialogTitles = ({ reading, control, techniqueExternalId, techniqueName }: EngineEfficacyExplanationProps) => {
  const functionName = functionLabel(reading.function);
  return {
    title: t`Engine efficacy`,
    description: t`${control} · ${techniqueExternalId} ${techniqueName} · ${functionName}`,
  };
};

/** The "i" beside a control's engine efficacy on a technique and function, and the dialog it opens. */
export const EngineEfficacyExplanation: FunctionComponent<EngineEfficacyExplanationProps> = (props) => {
  const { reading, control, techniqueExternalId, footerAction } = props;
  return (
    <ExplanationDialogButton
      triggerLabel={t`How the engine efficacy of ${control} on ${techniqueExternalId} is computed`}
      footerAction={footerAction}
      {...dialogTitles(props)}
    >
      <EngineEfficacyBody reading={reading} control={control} techniqueExternalId={techniqueExternalId} />
    </ExplanationDialogButton>
  );
};

/** The same dialog opened from elsewhere than its "i", a matrix cell. */
export const EngineEfficacyDialog: FunctionComponent<EngineEfficacyExplanationProps & {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}> = ({ open, onOpenChange, ...props }) => {
  const { reading, control, techniqueExternalId, footerAction } = props;
  return (
    <ExplanationDialog open={open} onOpenChange={onOpenChange} footerAction={footerAction} {...dialogTitles(props)}>
      <EngineEfficacyBody reading={reading} control={control} techniqueExternalId={techniqueExternalId} />
    </ExplanationDialog>
  );
};

/** Links a technique a control was tested on without declaring it to that control, where the reader is. */
export const DeclareOnControlButton: FunctionComponent<{
  capabilityId: string,
  /** The control's catalogue id. */
  control: string,
  techniqueId: string,
  capabilityFunction: CapabilityFunction,
  /** The technique was unlinked from the control, which restores it rather than adding it again. */
  isRemoved: boolean,
  /** A table row's button rather than a dialog's. */
  inRow?: boolean,
  onDeclared?: () => void,
}> = ({ capabilityId, control, techniqueId, capabilityFunction, isRemoved, inRow, onDeclared }) => {
  const { link, isPending } = useTechniqueLink(onDeclared);
  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    link({ capabilityId, techniqueId, function: capabilityFunction }, isRemoved);
  };
  return (
    <Button
      priority={inRow === true ? 'tertiary' : 'secondary'}
      size={inRow === true ? 'sm' : undefined}
      disabled={isPending}
      onClick={onClick}
    >
      <Trans>Declare on {control}</Trans>
    </Button>
  );
};

/** The dialog's way to the evidence behind the result: the control's validation lines on the technique and its sub-techniques. */
export const EvidenceLinkButton: FunctionComponent<{
  controlId: string,
  /** The control's catalogue id, which the label names so the page it leads to is not read as the technique's. */
  control: string,
  link: EvidenceLink,
}> = ({ controlId, control, link }) => {
  const navigate = useNavigate();
  const { externalId } = link;
  return (
    <Button
      priority="secondary"
      onClick={() => void navigate({
        from: '/$tenantId/{-$organizationId}',
        to: 'controls/$controlId/validation',
        params: { controlId },
        search: { technique: externalId },
      })}
    >
      <Trans>See the tests in {control} › Validation</Trans>
    </Button>
  );
};
