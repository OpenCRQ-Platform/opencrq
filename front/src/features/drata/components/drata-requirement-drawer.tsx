import { Chip, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { Activity, FileCheck, ScrollText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import { CardField, DescriptionField, DisplayDrawer, TooltipHintProvider } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { computeControlReadiness, NOT_READY_SEVERITY, READY_SEVERITY } from '../drata-utils';
import { ReadinessBar } from './readiness-bar';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type DrataControlRow = RouterOutputs['drata']['getControlsForRequirement'][number];

export interface RequirementDrawerTarget {
  id: string,
  code: string | null,
  name: string,
  category: string | null,
  isInScope: boolean,
  isReady: boolean,
}

const SignalPip: FunctionComponent<{ active: boolean, label: string, icon: ReactNode }> = ({ active, label, icon }) => (
  <TooltipHintProvider>
    <Tooltip>
      <TooltipTrigger className="cursor-default" aria-label={label}>
        <span className={cn('inline-flex', active ? 'text-foreground' : 'text-muted-foreground/30')}>
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  </TooltipHintProvider>
);

export const ControlSignals: FunctionComponent<{ control: Pick<DrataControlRow, 'isMonitored' | 'hasEvidence' | 'hasPolicy'> }> = ({ control }) => (
  <span className="flex items-center gap-1.5">
    <SignalPip active={control.isMonitored} label={control.isMonitored ? t`Monitored` : t`Not monitored`} icon={<Activity className="size-4" />} />
    <SignalPip active={control.hasEvidence} label={control.hasEvidence ? t`Has evidence` : t`No evidence`} icon={<FileCheck className="size-4" />} />
    <SignalPip active={control.hasPolicy} label={control.hasPolicy ? t`Has policy` : t`No policy`} icon={<ScrollText className="size-4" />} />
  </span>
);

export const ControlStateBadge: FunctionComponent<{ isReady: boolean }> = ({ isReady }) => (
  isReady
    ? <Chip severity={READY_SEVERITY} label={t`Ready`} />
    : <Chip severity={NOT_READY_SEVERITY} label={t`Not ready`} />
);

const ControlRow: FunctionComponent<{ control: DrataControlRow }> = ({ control }) => {
  const isArchived = control.archivedAt != null;
  return (
    <div className={cn('flex items-center gap-3 py-2', isArchived && 'opacity-50')}>
      <span className="font-mono txt-sub-content shrink-0">{control.code}</span>
      <span className="min-w-0 flex-1 truncate">{control.name}</span>
      {isArchived && <Chip label={t`Archived`} />}
      <ControlSignals control={control} />
      <ControlStateBadge isReady={control.isReady} />
    </div>
  );
};

const DrawerBody: FunctionComponent<{ requirement: RequirementDrawerTarget }> = ({ requirement }) => {
  const trpc = useTRPC();
  const {
    data: fetchedControls,
    isPending: isControlsPending,
    isSuccess: isControlsSuccess,
    isError: isControlsError,
  } = useQuery(trpc.drata.getControlsForRequirement.queryOptions({ requirementId: requirement.id }));
  const { data: detail, isPending: isDetailPending, isError: isDetailError } = useQuery(trpc.drata.getRequirement.queryOptions({ id: requirement.id }));
  const controls = isControlsSuccess ? fetchedControls : [];
  const readiness = computeControlReadiness(controls);
  const { active: activeCount, readyActive: readyCount } = readiness;

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        {requirement.isInScope
          ? <Chip label={t`In scope`} />
          : <Chip label={t`Out of scope`} />}
        <ControlStateBadge isReady={requirement.isReady} />
      </div>
      {isDetailPending && <CardField title={t`Description`}><Skeleton className="h-5 w-2/3" /></CardField>}
      {isDetailError && (
        <CardField title={t`Description`}>
          <p className="txt-sub-content text-muted-foreground"><Trans>Could not load the description.</Trans></p>
        </CardField>
      )}
      {!isDetailPending && !isDetailError && <DescriptionField title={t`Description`} value={detail?.description ?? null} />}
      <div className="flex flex-col gap-2">
        <span className="txt-sub-content font-medium text-muted-foreground"><Trans>Drata controls</Trans></span>
        {isControlsPending && <Skeleton className="h-5 w-2/3" />}
        {isControlsError && (
          <p className="txt-sub-content text-muted-foreground"><Trans>Could not load the controls.</Trans></p>
        )}
        {isControlsSuccess && controls.length === 0 && (
          <p className="txt-sub-content text-muted-foreground">
            <Trans>Drata maps no control to this requirement.</Trans>
          </p>
        )}
        {readiness.active > 0 && (
          <>
            <span className="txt-sub-content text-muted-foreground">
              {t({
                message: plural(activeCount, {
                  one: `${readyCount} of # control ready`,
                  other: `${readyCount} of # controls ready`,
                }),
              })}
            </span>
            <ReadinessBar
              variant="mini"
              ready={readiness.readyActive}
              notReady={readiness.active - readiness.readyActive}
            />
          </>
        )}
        <div className="divide-y divide-border">
          {controls.map((control) => <ControlRow key={control.id} control={control} />)}
        </div>
      </div>
    </div>
  );
};

export const DrataRequirementDrawer: FunctionComponent<{
  requirement: RequirementDrawerTarget | null,
  onClose: () => void,
}> = ({ requirement, onClose }) => {
  if (requirement === null) {
    return null;
  }
  return (
    <DisplayDrawer
      open
      onClose={onClose}
      category={requirement.category ?? undefined}
      title={requirement.code === null ? requirement.name : `${requirement.code} - ${requirement.name}`}
    >
      <DrawerBody requirement={requirement} />
    </DisplayDrawer>
  );
};
