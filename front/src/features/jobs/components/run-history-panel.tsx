import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { RunUnit } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import type { JobRunHistory, JobRunListItem } from '../run-types';
import type { RunReferencesLookup } from '../use-run-references';
import { SectionCard } from '../../../components/shared';
import { Loader } from '../../../components';
import { useRunReferences } from '../use-run-references';
import { clockSkewMs } from '../run-utils';
import { RunRow } from './run-row';

const RunSection: FunctionComponent<{
  title: string,
  emptyLabel: string,
  runs: Array<JobRunListItem>,
  total: number,
  unit: RunUnit | null,
  skewMs: number,
  referencesFor: RunReferencesLookup['referencesFor'],
}> = ({ title, emptyLabel, runs, total, unit, skewMs, referencesFor }) => {
  const listed = runs.length;
  return (
    <SectionCard title={title}>
      {listed === 0 && <p className="text-default-secondary">{emptyLabel}</p>}
      {runs.map((run, index) => (
        <div key={run.id} className={index === 0 ? undefined : 'border-t pt-6'}>
          <RunRow run={run} unit={unit} skewMs={skewMs} references={referencesFor(run.payload)} />
        </div>
      ))}
      {total > listed && (
        <p className="text-default-secondary">
          <Trans>The {listed} most recent are listed.</Trans>
        </p>
      )}
    </SectionCard>
  );
};

export const RunHistoryPanel: FunctionComponent<{
  data: JobRunHistory | undefined,
  isPending: boolean,
  error: unknown,
  dataUpdatedAt: number,
  unit: RunUnit | null,
  neverRanLabel: ReactNode,
  inProgressTitle: (count: number) => string,
  completedTitle: (count: number) => string,
}> = ({ data, isPending, error, dataUpdatedAt, unit, neverRanLabel, inProgressTitle, completedTitle }) => {
  const { referencesFor } = useRunReferences(data ? [...data.inProgress, ...data.completed] : []);

  if (isPending) {
    return <Loader />;
  }

  if (error || !data) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>These runs could not be read.</Trans>
      </p>
    );
  }

  if (data.inProgressCount === 0 && data.completedCount === 0) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        {neverRanLabel}
      </p>
    );
  }

  const inProgressCount = data.inProgressCount;
  const completedCount = data.completedCount;
  const skewMs = clockSkewMs(data.serverNow, dataUpdatedAt);

  return (
    <div className="flex flex-col gap-6">
      <RunSection
        title={inProgressTitle(inProgressCount)}
        emptyLabel={t`Nothing is running.`}
        runs={data.inProgress}
        total={inProgressCount}
        unit={unit}
        skewMs={skewMs}
        referencesFor={referencesFor}
      />
      <RunSection
        title={completedTitle(completedCount)}
        emptyLabel={t`No run has finished yet.`}
        runs={data.completed}
        total={completedCount}
        unit={unit}
        skewMs={skewMs}
        referencesFor={referencesFor}
      />
    </div>
  );
};
