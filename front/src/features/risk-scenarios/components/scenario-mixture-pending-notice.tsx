import { Spinner } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';

/**
 * Stands where a list of the scenario's threat-derived rows would be while the observed job has not
 * computed the attacker mixture for the pair yet, so an empty list is not read as a verdict. What is
 * missing is how much each threat weighs, not the threats themselves, which other cards already list.
 */
export const ScenarioMixturePendingNotice: FunctionComponent = () => (
  <div className="flex items-center gap-2 rounded-l-sm border-l-2 border-l-highlight bg-card px-4 py-3">
    <Spinner size="sm" />
    <p className="txt-sub-content">
      <Trans>Weighing the threats for this scenario. This page updates on its own once it is done.</Trans>
    </p>
  </div>
);

/**
 * The same state inside one row of a list mixing several scenarios, where only that row waits. It
 * wraps rather than inherit a truncating cell's ellipsis, which would cut it with no hover text.
 */
export const ScenarioMixturePendingLabel: FunctionComponent = () => (
  <span className="flex items-center gap-2 whitespace-normal txt-sub-content text-muted-foreground">
    <Spinner size="sm" />
    <span><Trans>Threats being weighed</Trans></span>
  </span>
);
