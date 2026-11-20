import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { AssetNameParts } from '../../utils/asset-name-utils';
import { assetNameDisplay } from '../../utils/asset-name-utils';
import { cn } from '../../utils/cn';

interface AssetNameProps extends AssetNameParts {
  className?: string,
}

// Inside a link the colour is the link's, so the name still reads as clickable. The arbitrary form
// of the muted colour is what lets that variant win: `fds.css` ships `text-default-secondary`
// unlayered, which beats any variant of ours.
const mutedClassName = 'text-[color:var(--fds-text-default-secondary)] in-[a]:text-[color:inherit]';

/** The one way to show an asset's name: the muted paint tells a deduced or missing name from a real one. */
export const AssetName: FunctionComponent<AssetNameProps> = ({ name, derivedName, className }) => {
  const display = assetNameDisplay({ name, derivedName });
  if (display.kind === 'name') {
    return <span className={className}>{display.text}</span>;
  }
  if (display.kind === 'derived') {
    const { text } = display;
    return (
      <span
        className={cn(mutedClassName, 'italic', className)}
        title={i18n._({ id: '{text}, name deduced from the asset\'s properties', message: '{text}, name deduced from the asset\'s properties', values: { text } })}
      >
        {text}
      </span>
    );
  }
  return <span className={cn(mutedClassName, className)}>{t`Unnamed asset`}</span>;
};
