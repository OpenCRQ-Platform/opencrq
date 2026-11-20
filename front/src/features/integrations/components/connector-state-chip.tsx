import { Chip } from '@filigran/design-system';
import type { ConnectorState } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { TooltipHint } from '../../../components/shared';
import { CONNECTOR_STATE_SEVERITY, connectorStateLabel, connectorStateNextMove } from '../connector-vocabulary';

interface ConnectorStateChipProps {
  state: ConnectorState,
  enabled: boolean,
  /** Replaces the Integrations page's next move where the surface offers another control. */
  hint?: string,
}

/** The chip states what the connector is; its hint states what to do about it. */
export const ConnectorStateChip: FunctionComponent<ConnectorStateChipProps> = ({ state, enabled, hint }) => (
  <TooltipHint hint={hint ?? connectorStateNextMove(state, enabled)}>
    <span className="inline-flex">
      <Chip severity={CONNECTOR_STATE_SEVERITY[state]} label={connectorStateLabel(state)} />
    </span>
  </TooltipHint>
);
