import {
  Card,
  CardDescription,
  CardHeader,
  CardMetaBar,
  CardOverview,
  CardTitle,
  Text,
  Thumbnail,
} from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import type { ConnectorListEntry } from '../connector-list-utils';
import { CARD_CONTENT_FILLS } from '../../../components/ui/card-content-fills';
import { EMPTY_VALUE, formatTimeUntil } from '../../../utils';
import { lastRunRead, objectsRead } from '../connector-card-utils';
import { readNextRun } from '../connector-schedule-utils';
import { connectorMechanismLabel } from '../connector-vocabulary';
import { ConnectorStateChip } from './connector-state-chip';

const ConnectorCardHead: FunctionComponent<{
  entry: ConnectorListEntry,
  action?: ReactNode,
}> = ({ entry, action }) => (
  <CardHeader
    icon={(
      <Thumbnail>
        <img src={entry.icon} alt="" aria-hidden="true" className="size-full object-contain" />
      </Thumbnail>
    )}
    action={action}
  >
    <CardOverview>{connectorMechanismLabel(entry.mechanism)}</CardOverview>
    <CardTitle as="h3">{entry.name}</CardTitle>
  </CardHeader>
);

const Figure: FunctionComponent<{ label: string, value: string }> = ({ label, value }) => (
  <span className="flex flex-col">
    <Text variant="content-caption" className="text-default-secondary">{label}</Text>
    <Text as="span" variant="content-compact" className="tabular-nums">{value}</Text>
  </span>
);

const nextRunText = (entry: ConnectorListEntry): string => {
  const read = readNextRun(entry.schedule);
  switch (read.kind) {
    case 'at': return formatTimeUntil(read.at);
    case 'manual': return t({ message: 'Manual', context: 'next run of a connector' });
    case 'none': return EMPTY_VALUE;
  }
};

/**
 * A connector this deployment carries: what it brought in, how its last run went and when it runs
 * next. The action is the one that binds a service account, so it is present only while the
 * connector still needs one.
 *
 * The card opens the connector through `onClick` rather than a link: the title is what carries the
 * interaction, and it only ever renders a bare anchor, which would leave the router behind.
 */
export const DeployedConnectorCard: FunctionComponent<{
  entry: ConnectorListEntry,
  configureAction: ReactNode,
}> = ({ entry, configureAction }) => {
  const navigate = useNavigate();
  const open = () => {
    void navigate(entry.linkOption);
  };
  return (
    <Card gap={16} className={`h-full ${CARD_CONTENT_FILLS}`} onClick={open}>
      <ConnectorCardHead entry={entry} action={<ConnectorStateChip state={entry.state} enabled={entry.enabled} />} />
      <CardDescription clamp={2}>{entry.shortDescription}</CardDescription>
      <CardMetaBar>
        <span className="flex flex-1 items-center justify-between gap-6">
          <Figure label={t`Objects`} value={objectsRead(entry)} />
          <Figure label={t`Last run`} value={lastRunRead(entry)} />
          <Figure label={t`Next run`} value={nextRunText(entry)} />
        </span>
        {configureAction}
      </CardMetaBar>
    </Card>
  );
};

/**
 * A connector OpenCRQ ships that this deployment carries no credentials for. It holds no state chip:
 * every card on that tab would read the same word, and that word contradicts the tab's own name.
 */
export const CatalogueConnectorCard: FunctionComponent<{ entry: ConnectorListEntry }> = ({ entry }) => {
  const navigate = useNavigate();
  return (
    <Card gap={16} className={`h-full ${CARD_CONTENT_FILLS}`} onClick={() => void navigate(entry.linkOption)}>
      <ConnectorCardHead entry={entry} />
      <CardDescription clamp={2}>{entry.shortDescription}</CardDescription>
      <CardMetaBar>
        <Text variant="content-compact" className="text-default-secondary">
          {t`Add this connector to your deployment configuration to use it.`}
        </Text>
      </CardMetaBar>
    </Card>
  );
};
