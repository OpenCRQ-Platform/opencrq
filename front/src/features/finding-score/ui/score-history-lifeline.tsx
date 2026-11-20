import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import type { PeriodWindowId } from '../../../components/shared/period-window';
import type { BandMove, ScoreHistoryLine, ScoreLifelineLine, ScoreMark } from '../score-history-utils';
import { changePointsLabel } from '../../../components/shared/change-points-label';
import { LifelinePlot } from '../../../components/shared/lifeline-plot';
import { directionBetween, LIFELINE_TONE_CLASS } from '../../../components/shared/lifeline-utils';
import { PeriodSelect } from '../../../components/shared/period-select';
import { cn, formatDate, formatDateMinute, formatTimeOfDay } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { buildScoreLifeline, spansLessThanADay } from '../score-history-utils';
import { severityBandFigureColor, severityBandLabel } from './severity-ramp';

export interface ScoreLifelineWording {
  curve: (oldestScore: number, oldestDate: string, latestScore: string, latestDate: string) => string,
  marks: string,
  empty: string,
}

interface ScoreLifelinePanelProps<Line extends ScoreLifelineLine> {
  /** Undefined while loading, and after a load that failed. */
  lines: ReadonlyArray<Line> | undefined,
  isError: boolean,
  /** Prints the current score and its band above the curve, for a placement with no gauge beside it. */
  withFigure: boolean,
  defaultWindow: PeriodWindowId,
  wording: ScoreLifelineWording,
  renderTooltip: (mark: ScoreMark<Line>) => ReactNode,
  announce: (mark: ScoreMark<Line>) => string,
  renderEventsLink: (link: { className: string, children: ReactNode }) => ReactNode,
}

const previousScoreLabel = (previous: number): string => t`from ${previous}`;

export const bandMoveSentence = ({ from, to }: BandMove): string => {
  const [fromWord, toWord] = [severityBandLabel(from), severityBandLabel(to)];
  return t`Band ${fromWord} → ${toWord}.`;
};

/** Null on the first mark, and on a mark only its band wrote. */
export const scoreMarkMovedFrom = ({ score, previous }: Pick<ScoreMark<ScoreLifelineLine>, 'score' | 'previous'>): number | null =>
  (previous === score ? null : previous);

export const ScoreMarkMove: FunctionComponent<{ score: number, previous: number }> = ({ score, previous }) => (
  <>
    <span className={cn('txt-body2 font-medium', LIFELINE_TONE_CLASS.bad[directionBetween(previous, score)])}>
      {changePointsLabel(score - previous)}
    </span>
    <span className="txt-sub-content text-muted-foreground">{previousScoreLabel(previous)}</span>
  </>
);

export const scoreMarkMoveAnnouncement = (score: number, previous: number): string =>
  `${changePointsLabel(score - previous)} ${previousScoreLabel(previous)}`;

const Loading: FunctionComponent = () => (
  <div className="flex flex-col gap-4">
    <div className="flex items-start justify-between gap-4">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-9 w-32" />
    </div>
    <Skeleton className="h-24 w-full" />
  </div>
);

export const ScoreLifelinePanel = <Line extends ScoreLifelineLine>({
  lines,
  isError,
  withFigure,
  defaultWindow,
  wording,
  renderTooltip,
  announce,
  renderEventsLink,
}: ScoreLifelinePanelProps<Line>): ReactNode => {
  const [windowId, setWindowId] = useState<PeriodWindowId>(defaultWindow);
  const [active, setActive] = useState<number | null>(null);
  // Frozen on mount: reading the clock during render is impure.
  const [now] = useState(() => new Date());

  if (lines === undefined) {
    return isError
      ? (
        <p className="flex h-24 items-center justify-center txt-sub-content text-muted-foreground">
          <Trans>The score history could not be loaded.</Trans>
        </p>
      )
      : <Loading />;
  }

  const lifeline = buildScoreLifeline(lines, windowId, now);
  const showHours = lifeline !== null && lifeline.marks.length > 0 && spansLessThanADay(lifeline);
  const oldestScore = lifeline?.oldest.score ?? null;
  const oldestDate = lifeline === null ? null : (showHours ? formatDateMinute : formatDate)(lifeline.start);
  const latestDate = lifeline === null ? null : (showHours ? formatDateMinute : formatDate)(lifeline.end);
  let endLabel = latestDate;
  if (lifeline !== null && showHours && !lifeline.single) {
    endLabel = formatTimeOfDay(lifeline.end);
  }
  const latest = lifeline?.latest ?? null;
  const band = lifeline?.latestBand ?? null;
  const bandLabel = band === null ? null : severityBandLabel(band);
  const changeLabel = lifeline === null || lifeline.change === null ? null : changePointsLabel(lifeline.change);
  const changeTone = oldestScore === null || latest === null ? null : LIFELINE_TONE_CLASS.bad[directionBetween(oldestScore, latest)];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {withFigure
          ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-3">
                <span className="txt-title font-bold" style={band === null ? undefined : { color: severityBandFigureColor(band) }}>
                  {latest ?? EMPTY_VALUE}
                </span>
                {changeLabel !== null && <span className={cn('txt-body2 font-medium', changeTone)}>{changeLabel}</span>}
              </div>
              {bandLabel !== null && oldestScore !== null && oldestDate !== null && (
                <p className="txt-sub-content text-muted-foreground">
                  <Trans>out of 100 · {bandLabel} · {oldestScore} on {oldestDate}</Trans>
                </p>
              )}
            </div>
          )
          : changeLabel !== null && oldestScore !== null && oldestDate !== null && (
            <p className="txt-sub-content text-muted-foreground">
              <Trans>
                <span className={cn('txt-body2 font-medium', changeTone)}>{changeLabel}</span> since {oldestScore} on {oldestDate}
              </Trans>
            </p>
          )}
        <PeriodSelect
          value={windowId}
          onChange={(next) => {
            setWindowId(next);
            setActive(null);
          }}
          ariaLabel={t`Score history window`}
        />
      </div>

      {lifeline === null || oldestScore === null || oldestDate === null || latestDate === null
        ? (
          <p className="flex h-24 items-center justify-center txt-sub-content text-muted-foreground">
            {wording.empty}
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
              ariaLabel={wording.curve(oldestScore, oldestDate, latest === null ? EMPTY_VALUE : String(latest), latestDate)}
              groupLabel={wording.marks}
              renderTooltip={(index) => renderTooltip(lifeline.marks[index])}
              announce={(index) => announce(lifeline.marks[index])}
              rise="bad"
              className="h-24"
            />
            <div className="flex justify-between txt-mini text-muted-foreground">
              <span>{lifeline.single ? '' : oldestDate}</span>
              <span>{endLabel}</span>
            </div>
          </div>
        )}
      {renderEventsLink({
        className: 'flex items-center gap-1 self-end txt-sub-content text-primary hover:underline',
        children: (
          <>
            <Trans>View events</Trans>
            <ChevronRight className="size-3.5" aria-hidden />
          </>
        ),
      })}
    </div>
  );
};

const findingCurveLabel = (oldestScore: number, oldestDate: string, latestScore: string, latestDate: string): string =>
  t`Finding score over time, from ${oldestScore} on ${oldestDate} to ${latestScore} on ${latestDate}`;

const findingMarkAnnouncement = (mark: ScoreMark): string => {
  const { score } = mark;
  if (score === null) {
    return `${formatDateMinute(mark.at)}, ${t`Pending vector`}.`;
  }
  const previous = scoreMarkMovedFrom(mark);
  const change = previous === null ? null : scoreMarkMoveAnnouncement(score, previous);
  const summary = [formatDateMinute(mark.at), t`Finding score ${score}`, change].filter((part) => part !== null).join(', ');
  return mark.bandMove === null ? `${summary}.` : `${summary}. ${bandMoveSentence(mark.bandMove)}`;
};

const FindingMarkTooltip: FunctionComponent<{ mark: ScoreMark }> = ({ mark }) => {
  const { score, band } = mark;
  if (score === null || band === null) {
    return (
      <>
        <span className="txt-sub-content text-muted-foreground">{formatDateMinute(mark.at)}</span>
        <span><Trans>Pending vector</Trans></span>
      </>
    );
  }
  const previous = scoreMarkMovedFrom(mark);
  return (
    <>
      <span className="txt-sub-content text-muted-foreground">{formatDateMinute(mark.at)}</span>
      <div className="flex items-baseline gap-2">
        <span className="txt-subtitle2 font-bold" style={{ color: severityBandFigureColor(band) }}>{score}</span>
        {previous !== null && <ScoreMarkMove score={score} previous={previous} />}
      </div>
      {mark.bandMove !== null && <span className="txt-sub-content">{bandMoveSentence(mark.bandMove)}</span>}
    </>
  );
};

interface ScoreHistoryLifelineProps {
  tenantId: string,
  evidenceId: string,
  lines: ReadonlyArray<ScoreHistoryLine> | undefined,
  isError: boolean,
  withFigure: boolean,
  defaultWindow: PeriodWindowId,
}

/**
 * A finding's score over the window, one shared drawing for the Score tab, where the gauge beside it
 * already prints the score, and the Overview, where it prints its own.
 */
export const ScoreHistoryLifeline: FunctionComponent<ScoreHistoryLifelineProps> = ({ tenantId, evidenceId, ...plot }) => (
  <ScoreLifelinePanel
    {...plot}
    wording={{
      curve: findingCurveLabel,
      marks: t`Finding score changes, use the arrow keys to move between them`,
      empty: t`No finding score recorded over this period.`,
    }}
    renderTooltip={(mark) => <FindingMarkTooltip mark={mark} />}
    announce={findingMarkAnnouncement}
    renderEventsLink={(link) => (
      <Link to="/$tenantId/{-$organizationId}/findings/$evidenceId/events" params={{ tenantId, evidenceId }} {...link} />
    )}
  />
);
