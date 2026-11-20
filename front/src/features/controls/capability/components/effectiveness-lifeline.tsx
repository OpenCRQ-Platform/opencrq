import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useParams } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PeriodWindowId } from '../../../../components/shared';
import type { LifelineGuide } from '../hooks/use-lifeline-guide';
import type { EffectivenessMark } from '../utils/effectiveness-lifeline-utils';
import {
  DEFAULT_PERIOD_WINDOW,
  directionBetween,
  formatSignedPoints,
  guideFraction,
  LIFELINE_TONE_CLASS,
  LifelinePlot,
  PeriodSelect,
} from '../../../../components/shared';
import { useTRPC } from '../../../../lib';
import { cn, formatDate } from '../../../../utils';
import { useGuidedMark } from '../hooks/use-lifeline-guide';
import { capabilityEventSentence } from '../utils/capability-event-sentence';
import { buildEffectivenessLifeline } from '../utils/effectiveness-lifeline-utils';
import {
  effectivenessInheritedLine,
  effectivenessMarkAnnouncement,
  effectivenessSourceLine,
  formatEffectivenessPoints,
  previousLabel,
} from '../utils/effectiveness-mark-text';

const curveLabel = (oldest: string, oldestDate: string, latest: string, latestDate: string): string =>
  t`Effectiveness over time, from ${oldest} on ${oldestDate} to ${latest} on ${latestDate}`;

const MarkTooltip: FunctionComponent<{ mark: EffectivenessMark, inScope: boolean }> = ({ mark, inScope }) => {
  const inherited = effectivenessInheritedLine(mark.event, inScope);
  return (
    <>
      <span className="txt-sub-content text-muted-foreground">{formatDate(mark.at)}</span>
      <div className="flex items-baseline gap-2">
        <span className="txt-subtitle2 font-bold tabular-nums">{mark.value === null ? t`Not assessed` : formatEffectivenessPoints(mark.value)}</span>
        {mark.value !== null && mark.previous !== null && (
          <span className={cn('txt-body2 font-medium tabular-nums', LIFELINE_TONE_CLASS.good[directionBetween(mark.previous, mark.value)])}>
            {formatSignedPoints(mark.value - mark.previous)}
          </span>
        )}
        {mark.previous !== null && <span className="txt-sub-content text-muted-foreground">{previousLabel(formatEffectivenessPoints(mark.previous))}</span>}
      </div>
      <span className="txt-sub-content">{capabilityEventSentence(mark.event)}</span>
      <span className="txt-sub-content text-muted-foreground">{effectivenessSourceLine(mark.event)}</span>
      {inherited !== null && <span className="txt-sub-content text-muted-foreground">{inherited}</span>}
    </>
  );
};

const PLOT_HEIGHT = 'h-36';

interface EffectivenessLifelineProps {
  capabilityId: string,
  guide: LifelineGuide,
}

export const EffectivenessLifeline: FunctionComponent<EffectivenessLifelineProps> = ({ capabilityId, guide }) => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const inScope = organizationId !== undefined;
  const [windowId, setWindowId] = useState<PeriodWindowId>(DEFAULT_PERIOD_WINDOW);
  // Frozen on mount: reading the clock during render is impure.
  const [now] = useState(() => new Date());
  const { data: lines, isError } = useQuery(trpc.controlCapabilities.getEffectivenessHistory.queryOptions({ capabilityId, organizationId }));

  const lifeline = lines === undefined ? null : buildEffectivenessLifeline(lines, windowId, now);

  const { active, changeActive } = useGuidedMark(guide, lifeline?.marks);
  const oldestValue = lifeline === null ? null : formatEffectivenessPoints(lifeline.oldest.value);
  const oldestDate = lifeline === null ? null : formatDate(lifeline.start);
  const latestDate = lifeline === null ? null : formatDate(lifeline.end);
  const latestValue = lifeline?.latest == null ? null : formatEffectivenessPoints(lifeline.latest);

  let body: ReactNode;
  if (lines === undefined) {
    body = isError
      ? (
        <p className={cn('flex items-center justify-center txt-sub-content text-muted-foreground', PLOT_HEIGHT)}>
          <Trans>The effectiveness history could not be loaded.</Trans>
        </p>
      )
      : <Skeleton className={cn('w-full', PLOT_HEIGHT)} />;
  } else if (lifeline === null || oldestValue === null || oldestDate === null || latestDate === null) {
    body = (
      <p className={cn('flex items-center justify-center txt-sub-content text-muted-foreground', PLOT_HEIGHT)}>
        <Trans>No effectiveness recorded over this period.</Trans>
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-1">
        <LifelinePlot
          values={lifeline.values}
          xs={lifeline.xs}
          marks={lifeline.marks}
          active={active}
          onActiveChange={changeActive}
          ariaLabel={curveLabel(oldestValue, oldestDate, latestValue ?? t`Not assessed`, latestDate)}
          groupLabel={t`Effectiveness changes, use the arrow keys to move between them`}
          renderTooltip={(index) => <MarkTooltip mark={lifeline.marks[index]} inScope={inScope} />}
          announce={(index) => effectivenessMarkAnnouncement(lifeline.marks[index], inScope)}
          rise="good"
          axisLabels={{ min: formatEffectivenessPoints(lifeline.min), max: formatEffectivenessPoints(lifeline.max) }}
          guideAt={guide.guideAt === null ? null : guideFraction(guide.guideAt, lifeline.start, lifeline.end)}
          className={PLOT_HEIGHT}
        />
        <div className="flex justify-between txt-mini text-muted-foreground">
          <span>{lifeline.single ? '' : oldestDate}</span>
          <span>{latestDate}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <span className="txt-container-title text-muted-foreground"><Trans>Evolution</Trans></span>
        <div className="flex items-center gap-3">
          {lifeline !== null && lifeline.change !== null && lifeline.latest !== null && oldestValue !== null && oldestDate !== null && (
            <span className="txt-sub-content text-muted-foreground tabular-nums">
              <span className={cn('font-medium', LIFELINE_TONE_CLASS.good[directionBetween(lifeline.oldest.value, lifeline.latest)])}>
                {formatSignedPoints(lifeline.change)}
              </span>
              {' · '}
              <Trans>{oldestValue} on {oldestDate}</Trans>
            </span>
          )}
          <PeriodSelect
            value={windowId}
            onChange={(next) => {
              setWindowId(next);
              changeActive(null);
            }}
            ariaLabel={t`Effectiveness time window`}
          />
        </div>
      </div>
      {body}
    </div>
  );
};
