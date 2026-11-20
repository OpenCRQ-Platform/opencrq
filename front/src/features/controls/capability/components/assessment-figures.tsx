import { Chip } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { skipToken, useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp } from 'lucide-react';
import type { CoverageBucket, PostureSource, StrengthRung } from '@app/module/client';
import type { CapabilityAssessment, CapabilityDetail } from '../types/capability';
import { InfoTooltip } from '../../../../components/shared';
import { useTRPC } from '../../../../lib';
import { cn } from '../../../../utils';
import { useCapabilityScopePosture } from '../hooks/use-scope-posture';
import { AssessmentProvenanceLine } from '../ui/assessment-provenance-line';
import { coverageLabel } from '../ui/coverage-label';
import { strengthLabel } from '../ui/strength-label';
import {
  EffectivenessBandChip,
  effectivenessLabel,
  effectivenessTextClass,
  effectivenessWashClass,
  isScoredBand,
} from '../ui/effectiveness-badge';
import { assessmentSourceNames, assumedLevelOf, isUnfed, tenantAssessmentProvenance, writerProvenance } from '../utils/assessment-axes-utils';
import { computeSoloEffectiveness, effectivenessGrid, formatEffectivenessPercent } from '../utils/capability-effectiveness';
import { isNotDeployedOnScope, isScopeDeclared } from '../utils/scope-posture-utils';

type ShownPosture = {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
};

const EffectivenessMiniGrid: FunctionComponent<{ assessment: ShownPosture | null }> = ({ assessment }) => (
  <div aria-hidden className="grid grid-cols-[auto_auto] justify-self-start gap-1.5">
    <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
      <ArrowUp className="size-2.5" />
      <span className="txt-mini uppercase [writing-mode:vertical-rl] rotate-180"><Trans>Strength</Trans></span>
    </div>
    <div className="flex flex-col gap-0.5">
      {effectivenessGrid().map((row) => (
        <div key={row[0].strengthRung} className="flex gap-0.5">
          {row.map((cell) => (
            <div
              key={cell.coverageBucket}
              className={cn(
                'size-[22px] rounded-[3px]',
                effectivenessWashClass(cell.band),
                assessment?.strengthRung === cell.strengthRung && assessment.coverageBucket === cell.coverageBucket
                  ? 'border-2 border-primary'
                  : 'border border-border',
              )}
            />
          ))}
        </div>
      ))}
    </div>
    <div />
    <div className="flex items-center justify-center gap-1 text-muted-foreground">
      <span className="txt-mini uppercase"><Trans>Coverage</Trans></span>
      <ArrowRight className="size-2.5" />
    </div>
  </div>
);

const modeLabel = (mode: CapabilityAssessment['strengthMode']): string => (mode === 'auto' ? t`Auto` : t`Manual`);

const AssessmentSourceInfo: FunctionComponent<{ assessment: CapabilityAssessment }> = ({ assessment }) => {
  const strengthMode = modeLabel(assessment.strengthMode);
  const coverageMode = modeLabel(assessment.coverageMode);
  return (
    <InfoTooltip label={t`How this assessment is kept`}>
      <span><Trans>Strength mode: {strengthMode}</Trans></span>
      <span><Trans>Coverage mode: {coverageMode}</Trans></span>
    </InfoTooltip>
  );
};

interface AxisValueProps {
  label: ReactNode,
  value: string,
  /** Absent outside any scope, where an axis has no level to name. */
  scope?: { source: PostureSource, tenantValue: string },
  note?: ReactNode,
}

const AxisValue: FunctionComponent<AxisValueProps> = ({ label, value, scope, note }) => {
  const tenantValue = scope?.tenantValue;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="txt-container-title text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
      {note !== undefined && <span className="txt-sub-content text-muted-foreground">{note}</span>}
      {scope?.source === 'tenant' && (
        <span className="txt-sub-content text-muted-foreground"><Trans>Inherited from the tenant</Trans></span>
      )}
      {scope?.source === 'scope' && (
        <span className="txt-sub-content text-muted-foreground"><Trans>tenant: {tenantValue}</Trans></span>
      )}
    </div>
  );
};

interface AssessmentFiguresProps {
  capability: CapabilityDetail,
  provenanceAction?: ReactNode,
}

export const AssessmentFigures: FunctionComponent<AssessmentFiguresProps> = ({ capability, provenanceAction }) => {
  const trpc = useTRPC();
  const { organizationId, posture, isAwaitingScope } = useCapabilityScopePosture(capability.id);
  const { data: scopedEvents } = useQuery(trpc.controlCapabilities.getCapabilityEvents.queryOptions(
    organizationId === undefined ? skipToken : { capabilityId: capability.id, organizationId },
  ));

  const declaredOnScope = posture !== undefined && isScopeDeclared(posture);
  const shown: ShownPosture | null = posture !== undefined && (declaredOnScope || capability.assessment !== null)
    ? {
      strengthRung: posture.strengthRung,
      coverageBucket: posture.coverageBucket,
    }
    : capability.assessment;
  const declaredAbsent = shown !== null && isNotDeployedOnScope(shown);
  const { data: validation } = useQuery(trpc.controlValidation.getControlValidation.queryOptions(
    declaredAbsent && !isAwaitingScope ? { capabilityId: capability.id, organizationId: organizationId ?? null } : skipToken,
  ));
  const testedWhileAbsent = declaredAbsent && (validation?.summary.testedTechniques ?? 0) > 0;
  const effectiveness = shown === null ? null : computeSoloEffectiveness(shown);

  const tenantStrength = posture?.tenantStrengthRung ?? null;
  const tenantCoverage = posture?.tenantCoverageBucket ?? null;
  const strengthScope = posture === undefined
    ? undefined
    : { source: posture.strengthSource, tenantValue: tenantStrength === null ? t`Not assessed` : strengthLabel(tenantStrength) };
  const coverageScope = posture === undefined
    ? undefined
    : { source: posture.coverageSource, tenantValue: tenantCoverage === null ? t`Not assessed` : coverageLabel(tenantCoverage) };

  // Inside a scope the latest line of that scope's chronology, whichever level wrote it.
  const latestScopedEvent = scopedEvents?.at(0);
  const provenance = organizationId === undefined
    ? tenantAssessmentProvenance(capability)
    : {
      at: latestScopedEvent?.createdAt ?? null,
      by: latestScopedEvent?.userId == null ? null : { userId: latestScopedEvent.userId, name: latestScopedEvent.userName },
      derivedFrom: writerProvenance(latestScopedEvent?.connector ?? null, assessmentSourceNames(capability.assessmentSources)),
    };

  const tenantAssessment = capability.assessment;
  const unfedStrength = tenantAssessment !== null && isUnfed(tenantAssessment, capability.assessmentSources, 'strength')
    && posture?.strengthSource !== 'scope';
  const unfedCoverage = tenantAssessment !== null && isUnfed(tenantAssessment, capability.assessmentSources, 'coverage')
    && posture?.coverageSource !== 'scope';
  const assumed = !unfedCoverage && tenantAssessment?.coverageBasis === 'assumed' && posture?.coverageSource !== 'scope';
  const { data: pooled } = useQuery(trpc.controlCapabilities.getPooledAssessment.queryOptions(
    assumed ? { capabilityId: capability.id } : skipToken,
  ));
  const assumedFromLevel = tenantAssessment === null ? null : assumedLevelOf(pooled, tenantAssessment.coverageBucket);
  const unfedNote = <Trans>No source feeds it any more</Trans>;
  const assumedNote = assumedFromLevel === null ? <Trans>Assumed</Trans> : <Trans>Assumed · L{assumedFromLevel}</Trans>;
  const coverageNote = unfedCoverage ? unfedNote : assumed ? assumedNote : undefined;

  if (isAwaitingScope) {
    return <p className="text-muted-foreground"><Trans>Loading...</Trans></p>;
  }
  return (
    <div className="@container flex flex-col gap-5">
      {/* Below 27rem the matrix moves under the figures rather than squeeze them. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @[27rem]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-4">
          {effectiveness === null && (
            <span className="txt-title font-bold text-muted-foreground"><Trans>Not assessed</Trans></span>
          )}
          {effectiveness !== null && isScoredBand(effectiveness.band) && (
            <div className="flex items-baseline gap-3">
              <span className={cn('txt-title font-bold tabular-nums', effectivenessTextClass(effectiveness.band))}>
                {formatEffectivenessPercent(effectiveness.score)}
              </span>
              <EffectivenessBandChip band={effectiveness.band} />
            </div>
          )}
          {effectiveness !== null && !isScoredBand(effectiveness.band) && (
            <span className="txt-title font-bold text-muted-foreground">{effectivenessLabel(effectiveness.band)}</span>
          )}
          {shown !== null && (
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <AxisValue label={<Trans>Strength</Trans>} value={strengthLabel(shown.strengthRung)} scope={strengthScope} note={unfedStrength ? unfedNote : undefined} />
              <AxisValue label={<Trans>Coverage</Trans>} value={coverageLabel(shown.coverageBucket)} scope={coverageScope} note={coverageNote} />
            </div>
          )}
          {testedWhileAbsent && (
            <p className="txt-sub-content text-muted-foreground">
              <Trans>OpenAEV tests exercise this control although it is declared not deployed: they are not taken into account.</Trans>
            </p>
          )}
        </div>
        <EffectivenessMiniGrid assessment={shown} />
      </div>
      {(provenance.at !== null || provenanceAction !== undefined) && (
        <div className="flex items-center gap-1.5 border-t border-border pt-3">
          {provenance.at !== null && (
            <>
              <AssessmentProvenanceLine at={provenance.at} by={provenance.by} derivedFrom={provenance.derivedFrom} />
              {declaredOnScope
                ? <Chip label={t`Manual`} />
                : capability.assessment !== null && <AssessmentSourceInfo assessment={capability.assessment} />}
            </>
          )}
          {provenanceAction !== undefined && <div className="ml-auto shrink-0">{provenanceAction}</div>}
        </div>
      )}
    </div>
  );
};
