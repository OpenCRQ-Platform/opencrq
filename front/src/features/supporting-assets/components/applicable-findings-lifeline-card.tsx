import { Skeleton } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PeriodWindowId } from '../../../components/shared';
import type { CountMark, DailyCount } from '../applicable-findings-lifeline-utils';
import { formatSignedPoints, LIFELINE_TONE_CLASS, LifelinePlot, PeriodSelect, SectionCard } from '../../../components/shared';
import { useReaderTimeZone } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cn, formatDate } from '../../../utils';
import { buildApplicableFindingsLifeline, countDirection } from '../applicable-findings-lifeline-utils';

const DEFAULT_WINDOW: PeriodWindowId = '12m';

interface ApplicableFindingsLifelineCardProps {
  assetId: string,
  className?: string,
}

const applicableFindingsLabel = (count: number): string =>
  plural(count, { one: '# applicable finding', other: '# applicable findings' });

const previousCountLabel = (previous: number): string => t`from ${previous}`;

const curveLabel = (oldestCount: number, oldestDate: string, latestCount: number, latestDate: string): string =>
  t`Applicable findings over time, from ${oldestCount} on ${oldestDate} to ${latestCount} on ${latestDate}`;

const Card: FunctionComponent<{ className?: string, children: ReactNode }> = ({ className, children }) => (
  <SectionCard title={t`Applicable findings trend`} className={className} cardClassName="flex-1" contentClassName="gap-3">
    {children}
  </SectionCard>
);

const markAnnouncement = ({ day, count, previous }: CountMark): string => {
  const date = formatDate(day);
  const value = applicableFindingsLabel(count);
  const change = formatSignedPoints(count - previous);
  return t`${date}, ${value}, ${change} from ${previous}.`;
};

const MarkTooltip: FunctionComponent<{ mark: CountMark }> = ({ mark }) => (
  <>
    <span className="txt-sub-content text-muted-foreground">{formatDate(mark.day)}</span>
    <div className="flex items-baseline gap-2">
      <span className="txt-body2 font-bold">{applicableFindingsLabel(mark.count)}</span>
      <span className={cn('txt-body2 font-medium', LIFELINE_TONE_CLASS.bad[countDirection(mark.count - mark.previous)])}>
        {formatSignedPoints(mark.count - mark.previous)}
      </span>
    </div>
    <span className="txt-sub-content text-muted-foreground">{previousCountLabel(mark.previous)}</span>
  </>
);

interface ApplicableFindingsLifelineProps {
  series: ReadonlyArray<DailyCount> | undefined,
  isError: boolean,
  className?: string,
}

export const ApplicableFindingsLifeline: FunctionComponent<ApplicableFindingsLifelineProps> = ({ series, isError, className }) => {
  const [windowId, setWindowId] = useState<PeriodWindowId>(DEFAULT_WINDOW);
  const [active, setActive] = useState<number | null>(null);

  const lifeline = series === undefined ? null : buildApplicableFindingsLifeline(series, windowId);
  if (lifeline === null) {
    if (series === undefined && !isError) {
      return (
        <Card className={className}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-4 w-56" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
          <Skeleton className="h-24 w-full" />
        </Card>
      );
    }
    return (
      <Card className={className}>
        <p className="flex h-24 items-center justify-center txt-sub-content text-muted-foreground">
          <Trans>The applicable findings trend could not be loaded.</Trans>
        </p>
      </Card>
    );
  }

  const { oldest, latest, change } = lifeline;
  const oldestCount = oldest.count;
  const oldestDate = formatDate(oldest.day);
  const latestDate = formatDate(latest.day);
  const changeTone = LIFELINE_TONE_CLASS.bad[countDirection(change)];

  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <span className="txt-title font-bold">{latest.count}</span>
            <span className={cn('txt-body2 font-medium', changeTone)}>{formatSignedPoints(change)}</span>
          </div>
          <p className="txt-sub-content text-muted-foreground">
            <Trans>applicable findings · {oldestCount} on {oldestDate}</Trans>
          </p>
        </div>
        <PeriodSelect
          value={windowId}
          onChange={(next) => {
            setWindowId(next);
            setActive(null);
          }}
          ariaLabel={t`Applicable findings trend window`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <LifelinePlot
          values={lifeline.values}
          xs={lifeline.xs}
          marks={lifeline.marks}
          active={active}
          onActiveChange={setActive}
          ariaLabel={curveLabel(oldestCount, oldestDate, latest.count, latestDate)}
          groupLabel={t`Applicable findings changes, use the arrow keys to move between them`}
          renderTooltip={(index) => <MarkTooltip mark={lifeline.marks[index]} />}
          announce={(index) => markAnnouncement(lifeline.marks[index])}
          rise="bad"
          className="h-24"
        />
        <div className="flex justify-between txt-mini text-muted-foreground">
          <span>{oldestDate}</span>
          <span>{latestDate}</span>
        </div>
      </div>
    </Card>
  );
};

/** Reads the query the findings heatmap reads, with the same input, so both share one request. */
export const ApplicableFindingsLifelineCard: FunctionComponent<ApplicableFindingsLifelineCardProps> = ({ assetId, className }) => {
  const trpc = useTRPC();
  const { timeZone, queryOptions, fallBackOn } = useReaderTimeZone();
  const { data, error, isError } = useQuery(trpc.supportingAssets.getEvidenceActivityForAsset.queryOptions({ assetId, timeZone }, queryOptions));
  fallBackOn(error);

  return <ApplicableFindingsLifeline series={data} isError={isError} className={className} />;
};
