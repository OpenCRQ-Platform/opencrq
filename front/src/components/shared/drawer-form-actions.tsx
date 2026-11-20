import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { useFormDrawerContext } from './form-drawer';
import { DrawerFormFooter } from './drawer-form-footer';

interface DestructiveAction {
  label: string,
  pendingLabel?: string,
  isPending?: boolean,
  disabled?: boolean,
  onClick: () => void,
}

interface DrawerFormActionsProps {
  isPending?: boolean,
  submitLabel?: string,
  pendingLabel?: string,
  disabled?: boolean,
  onCancel?: () => void,
  submitType?: 'submit' | 'button',
  onSubmit?: () => void,
  destructiveAction?: DestructiveAction,
  /** What the save will do, read at the far end from the buttons. */
  summary?: ReactNode,
}

export const DrawerFormActions: FunctionComponent<DrawerFormActionsProps> = ({
  isPending: isPendingProp,
  submitLabel,
  pendingLabel,
  disabled: disabledProp,
  onCancel,
  submitType: submitTypeProp,
  onSubmit,
  destructiveAction,
  summary,
}) => {
  const isPending = isPendingProp ?? false;
  const disabled = disabledProp ?? false;
  const submitType = submitTypeProp ?? 'submit';
  const { closeDrawer } = useFormDrawerContext();

  return (
    <DrawerFormFooter>
      {summary !== undefined && <div className="flex items-center sm:mr-auto">{summary}</div>}
      <Button priority="secondary" type="button" onClick={() => (onCancel ?? closeDrawer)()}>
        <Trans>Cancel</Trans>
      </Button>
      {destructiveAction && (
        <Button
          type="button"
          variant="destructive"
          disabled={destructiveAction.isPending || destructiveAction.disabled}
          onClick={destructiveAction.onClick}
        >
          {destructiveAction.isPending
            ? (destructiveAction.pendingLabel ?? destructiveAction.label)
            : destructiveAction.label}
        </Button>
      )}
      <Button
        type={submitType}
        disabled={isPending || disabled}
        onClick={submitType === 'button' ? onSubmit : undefined}
      >
        {isPending ? (pendingLabel ?? t`Saving...`) : (submitLabel ?? t`Save`)}
      </Button>
    </DrawerFormFooter>
  );
};
