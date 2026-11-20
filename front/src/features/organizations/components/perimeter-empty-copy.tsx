import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';

/**
 * The one perimeter message, shared by the empty-tenant card and the risk scopes
 * list empty state so the two surfaces cannot drift apart.
 */
export const PerimeterEmptyTitle: FunctionComponent = () => (
  <Trans>Start with a risk scope</Trans>
);

export const PerimeterEmptyBody: FunctionComponent = () => (
  <Trans>
    A risk scope is the perimeter a risk is measured against: its sector, its country,
    its size and its primary assets are what turn a scenario into a number. Create one and
    the risk surfaces open up.
  </Trans>
);

export const PerimeterEmptyActionLabel: FunctionComponent = () => (
  <Trans>Create a risk scope</Trans>
);
