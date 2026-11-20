import { Button, Icon } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { EllipsisVertical, Trash2 } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ConfirmDialog } from '../../../components/shared';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { EvidenceStateDialog } from '../../supporting-assets/components/evidence-state-dialog';
import { useConfirmationDialog } from '../../../hooks/utils/use-confirmation-dialog';
import { useTRPC } from '../../../lib';

interface FindingStateActionsProps {
  evidenceId: string,
  currentState: 'applicable' | 'dismissed',
  /** True once a person has set the state by hand, which is what a resync hands back to automation. */
  isManuallySet: boolean,
  /** A finding nobody syncs has no automation to hand control back to, so it is offered no resync. */
  isConnectorBacked: boolean,
  /** True when no connector ever reported the finding, the only case where deleting it is offered. */
  isHandAttached: boolean,
}

/** Set aside, mark applicable, resync and delete, acting in place on whichever finding page hosts them. */
export const FindingStateActions: FunctionComponent<FindingStateActionsProps> = ({
  evidenceId,
  currentState,
  isManuallySet,
  isConnectorBacked,
  isHandAttached,
}) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [stateDialogOpen, setStateDialogOpen] = useState(false);
  const resetConfirmation = useConfirmationDialog();
  const deleteConfirmation = useConfirmationDialog();

  const resetEvidenceState = useMutation(trpc.supportingAssets.resetEvidenceState.mutationOptions({
    meta: { successMessage: msg`Finding resynced with the connector successfully.` },
  }));

  const deleteEvidence = useMutation(trpc.supportingAssets.deleteAssetEvidence.mutationOptions({
    meta: { successMessage: msg`Finding deleted successfully.` },
    onSuccess: () => {
      void navigate({
        from: '/$tenantId/{-$organizationId}/findings/$evidenceId',
        to: '/$tenantId/{-$organizationId}/findings',
      });
    },
  }));

  const toggleTarget = currentState === 'applicable' ? 'dismissed' : 'applicable';

  return (
    <>
      {isManuallySet && isConnectorBacked && (
        <Button
          size="sm"
          priority="tertiary"
          startIcon={<Icon name="rotate-ccw" size={16} />}
          onClick={() => resetConfirmation.requestConfirmation(evidenceId)}
        >
          <Trans>Resync with connector</Trans>
        </Button>
      )}
      <Button
        size="sm"
        priority="secondary"
        startIcon={<Icon name={currentState === 'applicable' ? 'circle-x' : 'circle-check'} size={16} />}
        onClick={() => setStateDialogOpen(true)}
      >
        {currentState === 'applicable' ? t({ message: 'Set aside', context: 'action' }) : t`Mark applicable`}
      </Button>
      {isHandAttached && (
        <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
          <IconActionsItem
            className="text-feedback-error-primary"
            startIcon={<Trash2 className="h-4 w-4 text-feedback-error-primary" />}
            onClick={() => deleteConfirmation.requestConfirmation(evidenceId)}
          >
            {t`Delete`}
          </IconActionsItem>
        </IconActions>
      )}

      <EvidenceStateDialog
        open={stateDialogOpen}
        onOpenChange={setStateDialogOpen}
        evidenceId={evidenceId}
        targetState={toggleTarget}
      />

      <ConfirmDialog
        open={resetConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetConfirmation.cancel();
          }
        }}
        onConfirm={() => {
          resetConfirmation.confirm();
          resetEvidenceState.mutate({ evidenceId });
        }}
        title={<Trans>Resync with connector</Trans>}
        description={<Trans>The next connector sync will be free to update this finding's state again.</Trans>}
        submitButtonText={<Trans>Resync</Trans>}
      />

      <DeleteConfirmDialog
        open={deleteConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            deleteConfirmation.cancel();
          }
        }}
        onConfirm={() => {
          deleteConfirmation.confirm();
          deleteEvidence.mutate({ evidenceId });
        }}
        title={<Trans>Delete finding</Trans>}
        description={(
          <Trans>
            No connector reports this finding, so deleting it drops it for good, along with its
            history and its score.
          </Trans>
        )}
      />
    </>
  );
};
