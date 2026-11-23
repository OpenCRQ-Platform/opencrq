import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { RunStepCounts as StepCounts } from '../run-types';
import { CardField } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { formatNumber } from '../../../utils/format-number';

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

const Count: FunctionComponent<{ title: string, value: number | null }> = ({ title, value }) => (
  <CardField title={title}>
    {value === null ? <EmptyValue /> : <span className="tabular-nums">{formatNumber(value)}</span>}
  </CardField>
);

/**
 * What each step of a run counted, so a run that succeeded with nothing new reads as such. Renders
 * nothing for a kind that reports no step counts.
 */
export const RunStepCounts: FunctionComponent<{ stepCounts: Array<StepCounts> }> = ({ stepCounts }) => {
  if (stepCounts.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="run-step-counts">
      {stepCounts.map((counts) => {
        const labels = entityLabels(counts.entity);
        return (
          <CardField key={`${counts.step}:${counts.entity}`} title={stepTitle(counts)}>
            <div className="grid grid-cols-5 gap-x-6">
              <Count title={labels.read} value={counts.read} />
              <Count title={labels.written} value={counts.written} />
              <Count title={labels.created} value={counts.created} />
              <Count title={labels.removed} value={counts.removed} />
              <Count title={labels.skipped} value={counts.skipped} />
            </div>
          </CardField>
        );
      })}
    </div>
  );
};
