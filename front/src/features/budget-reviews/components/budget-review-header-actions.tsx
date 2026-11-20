import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { BudgetReviewStatus } from '../ui/review-chips';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { ReviewStatusChip } from '../ui/review-chips';

interface BudgetReviewHeaderActionsProps {
  status: BudgetReviewStatus,
  /** Why the review cannot be closed yet, `null` when it can. */
  closeHint: string | null,
  onEdit: () => void,
  onClose: () => void,
  onReopen: () => void,
  onDelete: () => void,
}

export const BudgetReviewHeaderActions: FunctionComponent<BudgetReviewHeaderActionsProps> = ({
  status,
  closeHint,
  onEdit,
  onClose,
  onReopen,
  onDelete,
}) => (
  <div className="flex items-center gap-2">
    <ReviewStatusChip status={status} />
    {status === 'closed'
      ? (
        <Button priority="secondary" onClick={onReopen}>
          <Trans>Reopen</Trans>
        </Button>
      )
      : (
        <>
          <Button priority="secondary" onClick={onEdit}>
            <Trans>Edit</Trans>
          </Button>
          {closeHint === null
            ? (
              <Button priority="secondary" onClick={onClose}>
                <Trans>Close the review</Trans>
              </Button>
            )
            : (
              // A disabled button fires no pointer event, so the hint hangs on a wrapper.
              <TooltipHintProvider>
                <TooltipHint hint={closeHint}>
                  <span tabIndex={0} className="inline-flex focus-visible:outline-none focus-visible:ring-2 ring-focus">
                    <Button priority="secondary" disabled>
                      <Trans>Close the review</Trans>
                    </Button>
                  </span>
                </TooltipHint>
              </TooltipHintProvider>
            )}
        </>
      )}
    <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
      <IconActionsItem onClick={onDelete}>{t`Delete`}</IconActionsItem>
    </IconActions>
  </div>
);
