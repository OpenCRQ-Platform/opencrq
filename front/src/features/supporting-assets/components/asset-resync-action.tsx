import { Button, Icon } from '@filigran/design-system';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { ConfirmDialog } from '../../../components/shared';
import { useConfirmationDialog } from '../../../hooks/utils/use-confirmation-dialog';
import { useTRPC } from '../../../lib';

interface AssetResyncActionProps {
  supportingAssetId: string,
  /**
   * Hidden unless something on the asset was set by hand and a connector still observes it: the
   * resync hands values back to the connectors, so without one it has nothing to hand them to.
   */
  canResync: boolean,
  /** The labels of the fields a person set by hand — named in the confirmation, not just counted. */
  manualFields: Array<string>,
}

/** Hands every hand-set value on the asset back to its connectors, naming which fields it clears. */
export const AssetResyncAction: FunctionComponent<AssetResyncActionProps> = ({
  supportingAssetId,
  canResync,
  manualFields,
}) => {
  const trpc = useTRPC();
  const resetConfirmation = useConfirmationDialog();

  const resync = useMutation(trpc.supportingAssets.resyncSupportingAssetWithConnectors.mutationOptions({
    meta: { successMessage: msg`Asset resynced with its connectors successfully.` },
  }));

  if (!canResync) {
    return null;
  }

  const fieldsList = manualFields.join(', ');

  return (
    <>
      <Button
        size="sm"
        priority="tertiary"
        startIcon={<Icon name="rotate-ccw" size={16} />}
        onClick={() => resetConfirmation.requestConfirmation(supportingAssetId)}
      >
        <Trans>Resync with connectors</Trans>
      </Button>
      <ConfirmDialog
        open={resetConfirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetConfirmation.cancel();
          }
        }}
        onConfirm={() => {
          resetConfirmation.confirm();
          resync.mutate({ id: supportingAssetId });
        }}
        title={<Trans>Resync with connectors</Trans>}
        description={t({
          message: plural(manualFields.length, {
            one: `# field edited by hand — ${fieldsList} — goes back to what the sources report, and the next sync is free to update it again. This cannot be undone.`,
            other: `# fields edited by hand — ${fieldsList} — go back to what the sources report, and the next sync is free to update it again. This cannot be undone.`,
          }),
        })}
        submitButtonText={<Trans>Resync</Trans>}
      />
    </>
  );
};
