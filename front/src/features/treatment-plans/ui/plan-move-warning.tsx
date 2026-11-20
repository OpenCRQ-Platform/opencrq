import { Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { TriangleAlert } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { PlanMoveWarning } from '../treatment-plan-utils';
import { TooltipHintProvider } from '../../../components/shared';

const warningLabel = (warning: PlanMoveWarning): string => (warning === 'needs-strength'
  ? t`This buys nothing until the control also declares a strength.`
  : t`This buys nothing until the control also has a coverage.`);

/**
 * A move the engine will price at nothing, marked where it is aimed.
 *
 * A glyph rather than a line of text: the target sits in a table cell, and a second line under it
 * would set the height of every row of the column.
 */
export const PlanMoveWarningHint: FunctionComponent<{ warning: PlanMoveWarning }> = ({ warning }) => {
  const label = warningLabel(warning);
  return (
    <TooltipHintProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex shrink-0 cursor-help items-center justify-center text-icon-warning"
          >
            <TriangleAlert aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </TooltipHintProvider>
  );
};
