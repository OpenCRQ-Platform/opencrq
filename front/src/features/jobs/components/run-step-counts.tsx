import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { RunStepCounts as StepCounts } from '../run-types';
import { CardField } from '../../../components/shared';
import { RunCount } from './run-count';

const stepTitle = (counts: StepCounts): string => {
  const step = counts.step === 'inventory' ? t`Inventory` : t`Observations`;
  if (counts.mode === 'full') {
    return t`${step}, full read`;
  }
  if (counts.mode === 'incremental') {
    return t`${step}, incremental read`;
  }
  return step;
};

const entityLabels = (entity: StepCounts['entity']) => (entity === 'assets'
  ? { read: t`Assets read`, written: t`Assets written`, created: t`Assets created`, removed: t`Assets removed`, skipped: t`Assets skipped` }
  : { read: t`Findings read`, written: t`Findings written`, created: t`Findings created`, removed: t`Findings removed`, skipped: t`Findings skipped` });

const Count: FunctionComponent<{ title: string, value: number }> = ({ title, value }) => (
  <CardField title={title}>
    <RunCount value={value} />
  </CardField>
);

/**
 * What each step of a run counted, so a run that succeeded with nothing new reads as such. Renders
 * nothing for a kind that reports no step counts.
 *
 * Laid out on the columns of the run row's grid (a subgrid starting at `firstRow`): the step title takes a
 * row of its own, then the counts fill the row under it from the first column (read, written, created,
 * removed, skipped under Name, Status, Operations, Total and the last column), so the 4 or 5 counts of a
 * step never wrap and each count keeps its column from one run to the next. A count the step does not
 * know (created, which a bulk upsert cannot tell from updated) is left out rather than drawn empty.
 */
export const RunStepCounts: FunctionComponent<{ stepCounts: Array<StepCounts>, firstRow: number }> = ({ stepCounts, firstRow }) => {
  if (stepCounts.length === 0) {
    return null;
  }
  return (
    <div className="col-span-full grid grid-cols-subgrid gap-y-4" style={{ gridRowStart: firstRow }} data-testid="run-step-counts">
      {stepCounts.map((counts) => {
        const labels = entityLabels(counts.entity);
        return (
          <div key={`${counts.step}:${counts.entity}`} className="col-span-full grid grid-cols-subgrid items-start gap-y-4">
            <p className="col-span-full txt-sub-content font-bold" data-testid="run-step-title">{stepTitle(counts)}</p>
            <div className="col-span-full grid grid-cols-subgrid items-start gap-y-4" data-testid="run-step-count-row">
              <Count title={labels.read} value={counts.read} />
              <Count title={labels.written} value={counts.written} />
              {counts.created !== null && <Count title={labels.created} value={counts.created} />}
              <Count title={labels.removed} value={counts.removed} />
              <Count title={labels.skipped} value={counts.skipped} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
