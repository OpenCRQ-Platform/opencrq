import { useNavbarCollapsed } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useTheme } from '../../../../providers';

/**
 * "Made by Filigran" signature row, mirroring the design-system docs site's NavbarSignature:
 * hidden entirely while collapsed (decorative, no navigational function), never truncated.
 */
export const MadeByFiligran: FunctionComponent = () => {
  const collapsed = useNavbarCollapsed();
  const { effectiveTheme } = useTheme();

  if (collapsed) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 pl-4 pr-2 h-9 text-content-caption font-content-caption leading-content-caption tracking-content-caption text-default-secondary">
      <Trans>Made by</Trans>
      <img
        alt={t`Filigran`}
        src={effectiveTheme === 'dark' ? '/filigran-dark.svg' : '/filigran-light.svg'}
        className="h-3 w-auto"
      />
    </div>
  );
};
