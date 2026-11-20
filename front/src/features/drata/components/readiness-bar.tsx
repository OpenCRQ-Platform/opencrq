import { Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { TooltipHintProvider } from '../../../components/shared';
import { ChartSwatch } from '../../../components/ui/chart-segment';
import { SegmentBar } from '../../../components/ui/segment-bar';
import { NOT_READY_COLOR, READY_COLOR } from '../drata-utils';

interface ReadinessBarProps {
  ready: number,
  notReady: number,
  outOfScope?: number,
  variant?: 'full' | 'mini',
}

const ReadinessTooltip = ({ ready, notReady, outOfScope }: { ready: number, notReady: number, outOfScope: number }) => (
  <div className="space-y-1">
    <p>{t`Ready`}: {ready}</p>
    <p>{t`Not ready`}: {notReady}</p>
    {outOfScope > 0 && <p>{t`Out of scope`}: {outOfScope}</p>}
  </div>
);

export const ReadinessBar: FunctionComponent<ReadinessBarProps> = ({
  ready,
  notReady,
  outOfScope: outOfScopeProp,
  variant: variantProp,
}) => {
  const outOfScope = outOfScopeProp ?? 0;
  const variant = variantProp ?? 'full';
  const total = ready + notReady + outOfScope;

  const bar = (height: string) => (
    <SegmentBar
      height={height}
      total={total}
      hatchedCount={outOfScope}
      segments={[
        { key: 'ready', value: ready, color: READY_COLOR },
        { key: 'not_ready', value: notReady, color: NOT_READY_COLOR },
      ]}
    />
  );

  if (variant === 'mini') {
    return (
      <TooltipHintProvider>
        <Tooltip>
          <TooltipTrigger className="w-full cursor-default" aria-label={t`Readiness`}>
            {bar('h-1.5')}
          </TooltipTrigger>
          <TooltipContent side="top">
            <ReadinessTooltip ready={ready} notReady={notReady} outOfScope={outOfScope} />
          </TooltipContent>
        </Tooltip>
      </TooltipHintProvider>
    );
  }

  return (
    <div className="w-full space-y-2">
      {bar('h-3')}
      <div className="flex flex-wrap gap-3 txt-sub-content text-muted-foreground">
        <span className="flex items-center gap-1">
          <ChartSwatch color={READY_COLOR} />
          {t`Ready`}
        </span>
        <span className="flex items-center gap-1">
          <ChartSwatch color={NOT_READY_COLOR} />
          {t`Not ready`}
        </span>
        {outOfScope > 0 && (
          <span className="flex items-center gap-1">
            <ChartSwatch />
            {t`Out of scope`}
          </span>
        )}
      </div>
    </div>
  );
};
