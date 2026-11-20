import { postureBandForScore, postureSeverityBand } from '@app/module/client';
import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { PeriodWindowId } from '../../../components/shared';
import type { PostureHistoryLine, PostureMark } from '../posture-lifeline-utils';
import {
  changePointsLabel,
  DEFAULT_PERIOD_WINDOW,
  directionBetween,
  LIFELINE_TONE_CLASS,
  LifelinePlot,
  PeriodSelect,
  SectionCard,
} from '../../../components/shared';
import { cn, formatDate, formatDateMinute, formatTimeOfDay } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { severityBandFigureColor } from '../../finding-score';
import { buildPostureLifeline, spansLessThanADay } from '../posture-lifeline-utils';
import { postureBandLabel } from './posture-band-word';
import { postureCauseSentence } from './posture-cause-sentence';

interface AssetPostureLifelineCardProps {
  tenantId: string,
  supportingAssetId: string,
  /** Undefined while loading, and after a load that failed. */
  lines: ReadonlyArray<PostureHistoryLine> | undefined,
  isError: boolean,
}

const curveLabel = (oldestScore: number, oldestDate: string, latestScore: string, latestDate: string): string =>
  t`OpenCRQ Posture over time, from ${oldestScore} on ${oldestDate} to ${latestScore} on ${latestDate}`;

const previousScoreLabel = (previous: number): string => t`from ${previous}`;

const LoadingCard: FunctionComponent = () => (
  <SectionCard title={t`OpenCRQ Posture`} contentClassName="gap-4">
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-9 w-32" />
    </div>
    <Skeleton className="h-24 w-full" />
  </SectionCard>
);

const FailedCard: FunctionComponent = () => (
  <SectionCard title={t`OpenCRQ Posture`}>
    <p className="flex h-24 items-center justify-center txt-sub-content text-muted-foreground">
      <Trans>The posture history could not be loaded.</Trans>
    </p>
  </SectionCard>
);

/** Focus stays on the plot while the arrows move the mark, so the tooltip reaches a screen reader through a live region. */
const markAnnouncement = (mark: PostureMark): string => {
  const { score, previous } = mark;
  const change = previous === null ? null : `${changePointsLabel(score - previous)} ${previousScoreLabel(previous)}`;
  const summary = [formatDateMinute(mark.at), t`OpenCRQ Posture ${score}`, change].filter((part) => part !== null).join(', ');
  const cause = postureCauseSentence(mark.cause);
  return cause === null ? `${summary}.` : `${summary}. ${cause}`;
};

interface MarkTooltipProps {
  mark: PostureMark,
}

const MarkTooltip: FunctionComponent<MarkTooltipProps> = ({ mark }) => {
  const scoreColor = severityBandFigureColor(postureSeverityBand(postureBandForScore(mark.score)));
  const cause = postureCauseSentence(mark.cause);
  return (
    <>
      <span className="txt-sub-content text-muted-foreground">{formatDateMinute(mark.at)}</span>
      <div className="flex items-baseline gap-2">
        <span className="txt-subtitle2 font-bold" style={{ color: scoreColor }}>{mark.score}</span>
        {mark.previous !== null && (
          <>
            <span className={cn('txt-body2 font-medium', LIFELINE_TONE_CLASS.good[directionBetween(mark.previous, mark.score)])}>
              {changePointsLabel(mark.score - mark.previous)}
            </span>
            <span className="txt-sub-content text-muted-foreground">{previousScoreLabel(mark.previous)}</span>
          </>
        )}
      </div>
      {cause !== null && <span className="txt-sub-content">{cause}</span>}
    </>
  );
};

export const AssetPostureLifelineCard: FunctionComponent<AssetPostureLifelineCardProps> = ({ tenantId, supportingAssetId, lines, isError }) => {
  const [windowId, setWindowId] = useState<PeriodWindowId>(DEFAULT_PERIOD_WINDOW);
  const [active, setActive] = useState<number | null>(null);
  // Frozen on mount: reading the clock during render is impure.
  const [now] = useState(() => new Date());

  if (lines === undefined) {
    return isError ? <FailedCard /> : <LoadingCard />;
  }

  const lifeline = buildPostureLifeline(lines, windowId, now);
  const showHours = lifeline !== null && lifeline.marks.length > 0 && spansLessThanADay(lifeline);
  const oldestScore = lifeline?.oldest.score ?? null;
  const oldestDate = lifeline === null ? null : (showHours ? formatDateMinute : formatDate)(lifeline.start);
  const latestDate = lifeline === null ? null : (showHours ? formatDateMinute : formatDate)(lifeline.end);
  let endLabel = latestDate;
  if (lifeline !== null && showHours && !lifeline.single) {
    endLabel = formatTimeOfDay(lifeline.end);
  }
  const latest = lifeline?.latest ?? null;
  const band = latest === null ? null : postureBandForScore(latest);
  const bandLabel = band === null ? null : postureBandLabel(band);

  return (
    <SectionCard title={t`OpenCRQ Posture`} contentClassName="gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <span
              className="txt-title font-bold"
              style={band === null ? undefined : { color: severityBandFigureColor(postureSeverityBand(band)) }}
            >
              {latest ?? EMPTY_VALUE}
            </span>
            {lifeline !== null && lifeline.change !== null && oldestScore !== null && latest !== null && (
              <span className={cn('txt-body2 font-medium', LIFELINE_TONE_CLASS.good[directionBetween(oldestScore, latest)])}>
                {changePointsLabel(lifeline.change)}
              </span>
            )}
          </div>
          {bandLabel !== null && oldestScore !== null && oldestDate !== null && (
            <p className="txt-sub-content text-muted-foreground">
              <Trans>out of 100 · {bandLabel} · {oldestScore} on {oldestDate}</Trans>
            </p>
          )}
        </div>
        <PeriodSelect
          value={windowId}
          onChange={(next) => {
            setWindowId(next);
            setActive(null);
          }}
        />
      </div>

      {lifeline === null || oldestScore === null || oldestDate === null || latestDate === null
        ? (
          <p className="flex h-24 items-center justify-center txt-sub-content text-muted-foreground">
            {t`No OpenCRQ Posture recorded over this period.`}
          </p>
        )
        : (
          <div className="flex flex-col gap-1">
            <LifelinePlot
              values={lifeline.values}
              xs={lifeline.xs}
              marks={lifeline.marks}
              active={active}
              onActiveChange={setActive}
              ariaLabel={curveLabel(oldestScore, oldestDate, latest === null ? EMPTY_VALUE : String(latest), latestDate)}
              groupLabel={t`OpenCRQ Posture changes, use the arrow keys to move between them`}
              renderTooltip={(index) => <MarkTooltip mark={lifeline.marks[index]} />}
              announce={(index) => markAnnouncement(lifeline.marks[index])}
              rise="good"
              className="h-24"
            />
            <div className="flex justify-between txt-mini text-muted-foreground">
              <span>{lifeline.single ? '' : oldestDate}</span>
              <span>{endLabel}</span>
            </div>
          </div>
        )}
      <Link
        to="/$tenantId/{-$organizationId}/assets/$supportingAssetId/events"
        params={{ tenantId, supportingAssetId }}
        className="flex items-center gap-1 self-end txt-sub-content text-primary hover:underline"
      >
        <Trans>View events</Trans>
        <ChevronRight className="size-3.5" aria-hidden />
      </Link>
    </SectionCard>
  );
};
