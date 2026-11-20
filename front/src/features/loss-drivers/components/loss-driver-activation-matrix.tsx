import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { ActivationCellState } from '../loss-driver-activation-grid';
import { SectionCard } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { businessResourceName } from '../../business-value-categories';
import { buildActivationGrid } from '../loss-driver-activation-grid';

const CELL_CLASS: Record<ActivationCellState, string> = {
  applies: 'bg-primary',
  compatible: 'bg-muted',
  // An outline rather than a fill: the pairing itself is not part of the model.
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy
  incompatible: 'bg-transparent border border-dashed border-border',
};

const CELL_LABEL: Record<ActivationCellState, () => string> = {
  applies: () => t`This driver applies`,
  compatible: () => t`Realistic pairing, driver not called`,
  incompatible: () => t`Pairing not held realistic`,
};

interface LossDriverActivationMatrixProps {
  lossDriverId: string,
}

/**
 * Where a single loss driver applies, as an outcome-by-category grid.
 *
 * A grid rather than a list: a driver recommended by every compatible pairing produces a list of
 * items that says nothing, while the same grid says "universal" at a glance.
 */
export const LossDriverActivationMatrix: FunctionComponent<LossDriverActivationMatrixProps> = ({ lossDriverId }) => {
  const trpc = useTRPC();
  const { data: cells } = useQuery(trpc.lossDrivers.getLossDriverActivations.queryOptions({ lossDriverId }));

  if (!cells || cells.length === 0) {
    return null;
  }

  const { outcomes, categories, states } = buildActivationGrid(cells);

  return (
    <SectionCard title={t`When this driver applies`}>
      <div className="overflow-x-auto">
        <table className="txt-sub-content">
          <thead>
            <tr>
              <th className="p-1 text-left font-normal text-muted-foreground" />
              {categories.map((category) => (
                <th key={category.id} className="max-w-24 p-1 text-left align-bottom font-normal text-muted-foreground">
                  {businessResourceName(category)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcomes.map((outcome, rowIndex) => (
              <tr key={outcome.id}>
                <th className="p-1 pr-3 text-left font-normal whitespace-nowrap">{outcome.name}</th>
                {categories.map((category, columnIndex) => {
                  const state = states[rowIndex][columnIndex];
                  return (
                    <td key={category.id} className="p-1">
                      <span
                        className={`block h-4 w-full min-w-8 rounded-sm ${CELL_CLASS[state]}`}
                        role="img"
                        aria-label={CELL_LABEL[state]()}
                        title={CELL_LABEL[state]()}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 txt-sub-content text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className={`h-3 w-6 rounded-sm ${CELL_CLASS.applies}`} />
          <Trans>Applies</Trans>
        </span>
        <span className="flex items-center gap-2">
          <span className={`h-3 w-6 rounded-sm ${CELL_CLASS.compatible}`} />
          <Trans>Realistic pairing, driver not called</Trans>
        </span>
        <span className="flex items-center gap-2">
          <span className={`h-3 w-6 rounded-sm ${CELL_CLASS.incompatible}`} />
          <Trans>Pairing not held realistic</Trans>
        </span>
      </div>
    </SectionCard>
  );
};
