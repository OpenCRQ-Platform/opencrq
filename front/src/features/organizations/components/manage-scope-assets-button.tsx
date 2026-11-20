import { Button } from '@filigran/design-system';
import type { ComponentProps, FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { ConfirmDialog } from '../../../components/shared';
import { useOpenScopeDrawer } from '../use-open-scope-drawer';

interface ManageScopeAssetsButtonProps {
  organizationId: string,
  priority?: ComponentProps<typeof Button>['priority'],
  children: ReactNode,
}

/**
 * The way to the scope's estate from a page that is not the scope's own. It asks before navigating,
 * since accepting takes the reader off the list they were reading.
 */
export const ManageScopeAssetsButton: FunctionComponent<ManageScopeAssetsButtonProps> = ({
  organizationId,
  priority,
  children,
}) => {
  const openScopeDrawer = useOpenScopeDrawer();
  const [isAsking, setAsking] = useState(false);

  return (
    <>
      <Button priority={priority} onClick={() => setAsking(true)}>{children}</Button>
      <ConfirmDialog
        open={isAsking}
        onOpenChange={setAsking}
        onConfirm={() => openScopeDrawer(organizationId, 'manage-assets')}
        title={<Trans>Assets are mapped on the risk scope</Trans>}
        description={<Trans>A scope's estate is managed from its own details page. Opening it leaves this page.</Trans>}
        submitButtonText={<Trans>Go to the risk scope</Trans>}
      />
    </>
  );
};
