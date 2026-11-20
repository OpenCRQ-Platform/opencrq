import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AssetCategory } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { getAssetCategoryLabel } from '../../../utils';
import { MonoChip } from './mono-chip';

interface ControlGapPaneProps {
  techniques: Array<{ externalId: string, name: string | null }>,
  tenantId: string,
  categoryId: AssetCategory,
}

/**
 * The techniques in reach that no creditable control stands on, and where a declaration closes them.
 *
 * Dashed and unfilled: on this page a dashed outline states an absence, and a filled card would
 * give the gap the anatomy of content.
 */
export const ControlGapPane: FunctionComponent<ControlGapPaneProps> = ({ techniques, tenantId, categoryId }) => {
  const categoryLabel = getAssetCategoryLabel(categoryId);
  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--fds-radius-sm)] border border-dashed p-4"
      style={{ borderColor: 'var(--fds-border-elevation-subtle)' }}
    >
      <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
        <Trans>Nothing stands on these</Trans>
      </span>
      <ul className="flex flex-col gap-1">
        {techniques.map((technique) => (
          <li key={technique.externalId} className="flex flex-wrap items-center gap-2">
            <MonoChip>{technique.externalId}</MonoChip>
            <span className="font-content-base text-content-base">{technique.name ?? technique.externalId}</span>
          </li>
        ))}
      </ul>
      <Link
        to="/$tenantId/{-$organizationId}/settings/taxonomies/supporting-asset-categories/$categoryId"
        params={{ tenantId, categoryId }}
        className="font-content-base text-content-base text-primary underline-offset-4 hover:underline"
      >
        {t`Declare a control on the ${categoryLabel} family`}
      </Link>
    </div>
  );
};
