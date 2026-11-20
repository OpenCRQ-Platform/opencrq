import { useToast } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { EllipsisVertical, Trash2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useConfirmationDialog } from '../../../hooks/utils/use-confirmation-dialog';
import { useTRPC } from '../../../lib';

interface ThreatActionsMenuProps {
  threatId: string,
}

/** For an imported threat only: the server refuses to delete a connector's. */
export const ThreatActionsMenu: FunctionComponent<ThreatActionsMenuProps> = ({ threatId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { toast } = useToast();
  const deleteConfirmation = useConfirmationDialog();

  const deleteImported = useMutation(trpc.threats.deleteImported.mutationOptions({
    meta: { skipSuccessToast: true },
    onSuccess: ({ deleted }) => {
      if (deleted === 0) {
        toast({ description: t`This threat was not deleted: it is no longer an import, or it was already removed.`, variant: 'destructive' });
        return;
      }
      toast({ description: t`Threat deleted successfully.` });
      void navigate({ from: '/$tenantId/{-$organizationId}', to: 'threat-center' });
    },
  }));

  return (
    <>
      <IconActions className="h-9 w-9" icon={<EllipsisVertical className="h-5 w-5 text-primary" />} priority="secondary">
        <IconActionsItem
          startIcon={<Trash2 className="h-4 w-4" />}
          onClick={() => deleteConfirmation.requestConfirmation(threatId)}
        >
          <Trans>Delete</Trans>
        </IconActionsItem>
      </IconActions>
      <DeleteConfirmDialog
        open={deleteConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            deleteConfirmation.cancel();
          }
        }}
        onConfirm={() => {
          const id = deleteConfirmation.confirm();
          if (id !== null) {
            deleteImported.mutate([id]);
          }
        }}
        title={<Trans>Delete threat</Trans>}
        description={<Trans>This will permanently delete this imported threat with its CVEs, techniques, locations and sectors. The scores it contributes to are recomputed. This action cannot be undone.</Trans>}
      />
    </>
  );
};
