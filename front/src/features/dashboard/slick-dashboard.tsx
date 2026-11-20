import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { ControlMove } from './widgets/slick-moves-widget';
import type { BandForecast } from './widgets/slick-timeline-widget';
import { ExposureFlowWidget } from './widgets/exposure-flow-widget';
import { ScenariosTableWidget } from './widgets/scenarios-table-widget';
import { SlickMovesWidget } from './widgets/slick-moves-widget';
import { SlickTimelineWidget } from './widgets/slick-timeline-widget';
import { projectMeanReduction } from './exposure-flow-utils';
import { useExposureFlowData } from './use-exposure-flow-data';

interface SlickDashboardProps {
  organizationId?: string,
}

/**
 * Risk, read through the exposure Sankey.
 *
 * Reading order is deliberate and top-down: the timeline answers "how bad is it and is it moving",
 * the move list answers "what do I do", the Sankey answers "why" for anyone auditing the number,
 * and the table is the scenario-by-scenario detail underneath.
 *
 * There is no KPI strip. Every figure it carried is already stated by the timeline beside it, the
 * expected total and its change over the window, so it was the same numbers twice on one screen.
 */
export const SlickDashboard: FunctionComponent<SlickDashboardProps> = ({ organizationId }) => {
  const data = useExposureFlowData(organizationId);
  const [projected, setProjected] = useState<ControlMove | null>(null);

  const currentMean = data.totals.aleMean;
  const forecast: BandForecast | null = projected === null || currentMean === null
    ? null
    : {
      moveLabel: projected.name,
      mean: projectMeanReduction(currentMean, projected.aleReduction),
      note: t`The expected total minus this control's mean reduction on every scenario it reduces, everything else unchanged.`,
    };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <SlickTimelineWidget organizationId={organizationId} forecast={forecast} />
        </div>
        <div className="lg:col-span-4">
          <SlickMovesWidget
            organizationId={organizationId}
            projectedControlId={projected?.controlId ?? null}
            onProject={setProjected}
          />
        </div>
      </div>

      <ExposureFlowWidget data={data} organizationId={organizationId} />

      <ScenariosTableWidget organizationId={organizationId} />
    </div>
  );
};
