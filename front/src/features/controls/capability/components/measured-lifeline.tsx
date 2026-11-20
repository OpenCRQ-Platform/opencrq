import { Skeleton } from '@filigran/ui';
import type { CapabilityFunction } from '@app/module/client';
import { roundPercentPoints } from '@app/utils/decimals';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useParams } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PeriodWindowId } from '../../../../components/shared';
import type { LifelineGuide } from '../hooks/use-lifeline-guide';
import type { ProvenPostureMark } from '../utils/proven-posture-lifeline-utils';
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
import { buildProvenPostureLifeline } from '../utils/proven-posture-lifeline-utils';
import { formatBoundedRate, formatRateReadout } from '../utils/validation-summary-utils';

const toPoints = (rate: number): number => roundPercentPoints(rate, 0);

const previousLabel = (previous: string): string => t`from ${previous}`;

const heldLine = (held: number, tested: number): string =>
  plural(held, { one: `# of ${tested} tested techniques held`, other: `# of ${tested} tested techniques held` });

const coverageLine = ({ credited, tested }: { credited: number, tested: number }): string => {
  const readout = formatRateReadout(credited === 0 ? 0 : tested / credited, tested, credited);
  return t`Proof coverage ${readout}`;
};

const curveLabel = (
  capabilityFunction: CapabilityFunction,
  values: { date: string, first: string, last: string, firstCoverage: string, lastCoverage: string },
): string => {
  const { date, first, last, firstCoverage, lastCoverage } = values;
  return capabilityFunction === 'prevent'
    ? t`Prevention since ${date}: success rate from ${first} to ${last}, proof coverage from ${firstCoverage} to ${lastCoverage}`
    : t`Detection since ${date}: success rate from ${first} to ${last}, proof coverage from ${firstCoverage} to ${lastCoverage}`;
};

const changeOf = (mark: ProvenPostureMark): string | null => (mark.previous === null
  ? null
  : formatSignedPoints(toPoints(mark.value) - toPoints(mark.previous)));

/** Focus stays on the plot while the arrows move the mark, so the tooltip reaches a screen reader through a live region. */
const markAnnouncement = (mark: ProvenPostureMark): string => {
  const change = changeOf(mark);
  const summary = [
    formatDate(mark.at),
    formatBoundedRate(mark.value),
    change === null || mark.previous === null ? null : `${change} ${previousLabel(formatBoundedRate(mark.previous))}`,
  ].filter((part) => part !== null).join(', ');
  return `${summary}. ${heldLine(mark.payload.held, mark.payload.tested)}. ${coverageLine(mark.payload)}.`;
};

const MarkTooltip: FunctionComponent<{ mark: ProvenPostureMark }> = ({ mark }) => {
  const change = changeOf(mark);
  return (
    <>
      <span className="txt-sub-content text-muted-foreground">{formatDate(mark.at)}</span>
      <div className="flex items-baseline gap-2">
        <span className="txt-subtitle2 font-bold tabular-nums">{formatBoundedRate(mark.value)}</span>
        {change !== null && mark.previous !== null && (
          <>
            <span className={cn('txt-body2 font-medium tabular-nums', LIFELINE_TONE_CLASS.good[directionBetween(mark.previous, mark.value)])}>
              {change}
            </span>
            <span className="txt-sub-content text-muted-foreground">{previousLabel(formatBoundedRate(mark.previous))}</span>
          </>
        )}
      </div>
      <span className="txt-sub-content">{heldLine(mark.payload.held, mark.payload.tested)}</span>
      <span className="txt-sub-content text-muted-foreground">{coverageLine(mark.payload)}</span>
    </>
  );
};

const Swatch: FunctionComponent<{ className: string }> = ({ className }) => (
  <span aria-hidden className={cn('inline-block h-0.5 w-3 rounded-full bg-current', className)} />
);

const PLOT_HEIGHT = 'h-36';

interface MeasuredLifelineProps {
  capabilityId: string,
  capabilityFunction: CapabilityFunction,
  guide: LifelineGuide,
}

/**
 * The success rate of one function over the period, with the proof coverage behind it on the same
 * scale. The curve comes from the daily recording while the figures beside it are live, so its last
 * point can lag them by up to a day.
 */
export const MeasuredLifeline: FunctionComponent<MeasuredLifelineProps> = ({
  capabilityId,
  capabilityFunction,
  guide,
}) => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const [windowId, setWindowId] = useState<PeriodWindowId>(DEFAULT_PERIOD_WINDOW);
  // Frozen on mount: reading the clock during render is impure.
  const [now] = useState(() => new Date());
  const { data: lines, isError } = useQuery(trpc.controlValidation.getProvenPostureHistory.queryOptions({ capabilityId, organizationId }));

  const lifeline = lines === undefined ? null : buildProvenPostureLifeline(lines, capabilityFunction, windowId, now);

  const { active, changeActive } = useGuidedMark(guide, lifeline?.marks);

  const rates = lifeline === null ? [] : lifeline.values.filter((value) => value !== null);
  const coverages = lifeline?.coverage ?? [];
  const rateTone = rates.length === 0 ? '' : LIFELINE_TONE_CLASS.good[directionBetween(rates[0], rates[rates.length - 1])];
  const oldestValue = lifeline === null ? null : formatBoundedRate(lifeline.oldest.value);
  const oldestDate = lifeline === null ? null : formatDate(lifeline.start);
  const latestDate = lifeline === null ? null : formatDate(lifeline.end);

  let body: ReactNode;
  if (lines === undefined) {
    body = isError
      ? (
        <p className={cn('flex items-center justify-center txt-sub-content text-muted-foreground', PLOT_HEIGHT)}>
          <Trans>The success rate history could not be loaded.</Trans>
        </p>
      )
      : <Skeleton className={cn('w-full', PLOT_HEIGHT)} />;
  } else if (lifeline === null || oldestDate === null || latestDate === null) {
    body = (
      <p className={cn('flex items-center justify-center txt-sub-content text-muted-foreground', PLOT_HEIGHT)}>
        <Trans>No success rate measured over this period.</Trans>
      </p>
    );
  } else {
    const ariaLabel = curveLabel(capabilityFunction, {
      date: oldestDate,
      first: formatBoundedRate(rates[0]),
      last: formatBoundedRate(rates[rates.length - 1]),
      firstCoverage: coverages.length === 0 ? '' : formatBoundedRate(coverages[0]),
      lastCoverage: coverages.length === 0 ? '' : formatBoundedRate(coverages[coverages.length - 1]),
    });
    body = (
      <div className="flex flex-col gap-1">
        <LifelinePlot
          values={lifeline.values}
          backValues={lifeline.coverage}
          domain={lifeline.domain}
          xs={lifeline.xs}
          marks={lifeline.marks}
          active={active}
          onActiveChange={changeActive}
          ariaLabel={ariaLabel}
          groupLabel={t`Success rate changes, use the arrow keys to move between them`}
          renderTooltip={(index) => <MarkTooltip mark={lifeline.marks[index]} />}
          announce={(index) => markAnnouncement(lifeline.marks[index])}
          rise="good"
          axisLabels={{ min: formatBoundedRate(lifeline.domain.min), max: formatBoundedRate(lifeline.domain.max) }}
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

  const isEmpty = lines !== undefined && lifeline === null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="txt-container-title text-muted-foreground">
            {isEmpty ? <Trans>Success rate over time</Trans> : <Trans>Evolution</Trans>}
          </span>
          {lifeline !== null && (
            <>
              <span className="flex items-center gap-1.5 txt-sub-content text-muted-foreground">
                <Swatch className={rateTone} />
                <Trans>Success rate</Trans>
              </span>
              <span className="flex items-center gap-1.5 txt-sub-content text-muted-foreground">
                <Swatch className="text-primary" />
                <Trans>Proof coverage</Trans>
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lifeline !== null && lifeline.latest !== null && oldestValue !== null && oldestDate !== null && (
            <span className="txt-sub-content text-muted-foreground tabular-nums">
              <span className={cn('font-medium', LIFELINE_TONE_CLASS.good[directionBetween(lifeline.oldest.value, lifeline.latest)])}>
                {formatSignedPoints(toPoints(lifeline.latest) - toPoints(lifeline.oldest.value))}
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
            ariaLabel={t`Success rate time window`}
          />
        </div>
      </div>
      {body}
    </div>
  );
};
