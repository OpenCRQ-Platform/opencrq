import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { EllipsisVertical, Trash2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useConfirmationDialog } from '../../../hooks/utils/use-confirmation-dialog';
import { useTRPC } from '../../../lib';

interface AssetActionsMenuProps {
  supportingAssetId: string,
}

export const AssetActionsMenu: FunctionComponent<AssetActionsMenuProps> = ({ supportingAssetId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const deleteConfirmation = useConfirmationDialog();

  const deleteSupportingAssets = useMutation(trpc.supportingAssets.deleteSupportingAssets.mutationOptions({
    meta: { successMessage: msg`Supporting asset deleted successfully.` },
    onSuccess: () => {
      void navigate({ from: '/$tenantId/{-$organizationId}', to: 'assets' });
    },
  }));

  return (
    <>
      <IconActions className="h-9 w-9" icon={<EllipsisVertical className="h-5 w-5 text-primary" />} priority="secondary">
        <IconActionsItem
          startIcon={<Trash2 className="h-4 w-4" />}
          onClick={() => deleteConfirmation.requestConfirmation(supportingAssetId)}
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
            deleteSupportingAssets.mutate([id]);
          }
        }}
        title={<Trans>Delete supporting asset</Trans>}
        description={<Trans>This will permanently delete this supporting asset and all its dependency links. This action cannot be undone.</Trans>}
      />
    </>
  );
};
