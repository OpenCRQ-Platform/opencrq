import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@filigran/ui';
import { Button, Chip, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '@app/module/client';
import type { CoverageBucket, StrengthRung } from '@app/module/client';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import { useId, useState } from 'react';
import type { AxisLevels, AxisPick } from '../defenses-utils';
import { ControlIdPill, DisplayDrawer, InfoTooltip } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { controlDomainLabel } from '../../controls/capability/ui/control-domain-label';
import { coverageLabel } from '../../controls/capability/ui/coverage-label';
import { strengthInfo } from '../../controls/capability/ui/strength-info';
import { strengthLabel } from '../../controls/capability/ui/strength-label';
import { countAssessed, groupCapabilitiesByDomain, planRowPick } from '../defenses-utils';
import { useControlCapabilities } from '../hooks/use-source-reads';
import { assessedOfLabel } from '../source-labels';

type Capabilities = NonNullable<ReturnType<typeof useControlCapabilities>>;

interface AxisChoicesProps<T extends string> {
  question: string,
  infoLabel: string,
  info: ReactNode,
  values: ReadonlyArray<T>,
  labelOf: (value: T) => string,
  value: T | null,
  /** A connector or a published framework derives this axis: a pick declares it by hand instead. */
  derived: boolean,
  onPick: (value: T) => void,
}

const AxisChoices = <T extends string>({ question, infoLabel, info, values, labelOf, value, derived, onPick }: AxisChoicesProps<T>): ReactNode => {
  const questionId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-6 items-center gap-1.5">
        <Text as="span" variant="content-compact-medium" id={questionId}>{question}</Text>
        <InfoTooltip label={infoLabel}>{info}</InfoTooltip>
        {derived && <Chip label={t`Auto`} />}
      </div>
      <div role="group" aria-labelledby={questionId} className="grid grid-cols-4 gap-2">
        {values.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            fullWidth
            priority={option === value ? 'primary' : 'secondary'}
            aria-pressed={option === value}
            onClick={() => onPick(option)}
          >
            {labelOf(option)}
          </Button>
        ))}
      </div>
    </div>
  );
};

/** The rung descriptions belong to each control, so they are read only once the tooltip opens. */
const StrengthRungInfo: FunctionComponent<{ capabilityId: string }> = ({ capabilityId }) => {
  const trpc = useTRPC();
  const { data: capability } = useQuery(trpc.controlCapabilities.getControlCapability.queryOptions({ id: capabilityId }));
  return capability ? strengthInfo(capability.rungs) : <Trans>Each level includes the ones below it.</Trans>;
};

const NO_LEVELS: AxisLevels = { strengthRung: null, coverageBucket: null };

const CapabilityRow: FunctionComponent<{ capability: Capabilities[number] }> = ({ capability }) => {
  const trpc = useTRPC();
  const [draft, setDraft] = useState<AxisLevels>(NO_LEVELS);
  // Each choice is its own save: the row and the step's count moving on is the feedback.
  const upsertAssessment = useMutation(trpc.controlCapabilities.upsertAssessment.mutationOptions({ meta: { skipSuccessToast: true } }));
  const { assessment } = capability;
  const pending = upsertAssessment.isPending ? upsertAssessment.variables : undefined;

  const strength = pending?.strengthRung ?? assessment?.strengthRung ?? draft.strengthRung;
  const coverage = pending?.coverageBucket ?? assessment?.coverageBucket ?? draft.coverageBucket;
  const waitingForOtherAxis = assessment === null && (draft.strengthRung !== null) !== (draft.coverageBucket !== null);

  const pick = (choice: AxisPick) => {
    const plan = planRowPick(assessment !== null, draft, choice);
    if (plan.kind === 'draft') {
      setDraft(plan.draft);
      return;
    }
    upsertAssessment.mutate({ capabilityId: capability.id, ...plan.declaration, reattach: [], comment: null });
  };

  return (
    <li className="flex flex-col gap-3 border-b border-[var(--fds-border-elevation-subtle)] py-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <ControlIdPill externalId={capability.externalId} size="compact" />
        <Text as="span" variant="content-base-medium" className="min-w-0">{capability.name}</Text>
        {assessment === null && !waitingForOtherAxis && <Chip label={t`Not assessed`} />}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] gap-4">
        <AxisChoices<StrengthRung>
          question={t`How is the control implemented?`}
          infoLabel={t`What each strength rung demands`}
          info={<StrengthRungInfo capabilityId={capability.id} />}
          values={STRENGTH_RUNGS}
          labelOf={strengthLabel}
          value={strength}
          derived={assessment?.strengthMode === 'auto'}
          onPick={(rung) => pick({ axis: 'strength', rung })}
        />
        <AxisChoices<CoverageBucket>
          question={t`How widely is it deployed?`}
          infoLabel={t`What coverage measures`}
          info={<Trans>Coverage says how much of the concerned perimeter the control is deployed on, not how well it works there.</Trans>}
          values={COVERAGE_BUCKETS}
          labelOf={coverageLabel}
          value={coverage}
          derived={assessment?.coverageMode === 'auto'}
          onPick={(bucket) => pick({ axis: 'coverage', bucket })}
        />
      </div>
      {waitingForOtherAxis && (
        <Text as="p" variant="content-caption" className="text-default-secondary">
          {t`Answer both questions to assess this control.`}
        </Text>
      )}
    </li>
  );
};

const SelfAssessmentBody: FunctionComponent = () => {
  const capabilities = useControlCapabilities();
  if (capabilities === undefined) {
    return null;
  }
  const groups = groupCapabilitiesByDomain(capabilities);
  const [firstGroup] = groups;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Accordion type="multiple" defaultValue={firstGroup === undefined ? [] : [firstGroup.domain]}>
        {groups.map(({ domain, capabilities: inDomain }) => (
          <AccordionItem key={domain} value={domain}>
            <AccordionTrigger className="hover:no-underline!">
              <span className="flex w-full items-center justify-between gap-4 pr-2">
                <Text as="span" variant="title-xs">{controlDomainLabel(domain)}</Text>
                <Text as="span" variant="content-compact" className="tabular-nums text-default-secondary">
                  {assessedOfLabel(countAssessed(inDomain), inDomain.length)}
                </Text>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ul>
                {inDomain.map((capability) => <CapabilityRow key={capability.id} capability={capability} />)}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
};

interface SelfAssessmentDrawerProps {
  open: boolean,
  onClose: () => void,
}

/** Writes the tenant's assessment of each control, never a risk scope's own declaration. */
export const SelfAssessmentDrawer: FunctionComponent<SelfAssessmentDrawerProps> = ({ open, onClose }) => (
  <DisplayDrawer
    open={open}
    onClose={onClose}
    // The design system's lg drawer width, capped to the viewport as its Drawer is; through the minimum width, since fds.css ships the legacy drawer's w-[30vw] unlayered.
    className="min-w-[min(var(--fds-width-overlay-lg),calc(100vw-var(--fds-spacing)*8))]"
    title={t`Assess yourself`}
  >
    <SelfAssessmentBody />
  </DisplayDrawer>
);
