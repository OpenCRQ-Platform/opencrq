import { Alert, Button, Chip, IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Check, Copy, ExternalLink, ShieldCheck, User, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type { ConnectorDetail } from '../connector-detail-types';
import { CardField, InfoField, SectionCard } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useCopyToClipboard } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDate, formatDateTime, formatDurationMs, msBetween } from '../../../utils';
import { runStatusLabel } from '../../jobs';
import {
  connectorDomainLabel,
  connectorMechanismLabel,
  connectorScopeKindLabel,
  formatNextRun,
  scheduleSummary,
} from '../connector-vocabulary';
import { NvdNotice } from './nvd-notice';
import { getConnectors } from './connectors-list';
import { OpenctiThreatVisibilityField } from './opencti-threat-visibility';

/** The state blob is a handler's own shape: it is shown truncated and never parsed. */
const STATE_PREVIEW_LIMIT = 200;

const CONNECTOR_ROUTE = '/_auth/$tenantId/{-$organizationId}/integrations/connectors/$connectorSlug';

const ChipRow: FunctionComponent<{ labels: Array<string> }> = ({ labels }) => (
  labels.length === 0 ? <EmptyValue /> : (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => <Chip key={label} label={label} />)}
    </span>
  )
);

const ChipField: FunctionComponent<{ title: string, labels: Array<string>, className?: string }> = ({ title, labels, className }) => (
  <CardField title={title} className={className}>
    <ChipRow labels={labels} />
  </CardField>
);

/** An identity the operator can open, as chips beside the icon that says what kind it is. */
const IdentityField: FunctionComponent<{
  title: string,
  icon: ReactNode,
  items: ReadonlyArray<{ id: string, name: string }>,
  onOpen: (id: string) => void,
  className?: string,
}> = ({ title, icon, items, onOpen, className }) => (
  <CardField title={title} className={className}>
    <span className="flex items-center gap-2">
      <span className="text-default-secondary" aria-hidden="true">{icon}</span>
      {items.length === 0 ? <EmptyValue /> : (
        <span className="flex flex-wrap gap-1">
          {items.map((item) => <Chip key={item.id} label={item.name} onClick={() => onOpen(item.id)} />)}
        </span>
      )}
    </span>
  </CardField>
);

const stateText = (connector: ConnectorDetail): string | null => {
  if (connector.mechanism === 'live_stream') {
    return connector.streamCursor;
  }
  const state = connector.lastRunState;
  return state === null || state === undefined ? null : JSON.stringify(state);
};

const StateField: FunctionComponent<{ connector: ConnectorDetail }> = ({ connector }) => {
  const { copied, copy } = useCopyToClipboard();
  const state = stateText(connector);
  return (
    <CardField title={t`State`} className="col-span-2">
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-all font-mono txt-sub-content">
          {state === null ? <EmptyValue /> : state.slice(0, STATE_PREVIEW_LIMIT)}
        </span>
        {state !== null && (
          <IconButton
            priority="tertiary"
            size="sm"
            aria-label={t`Copy state`}
            onClick={() => void copy(state)}
            icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          />
        )}
      </span>
    </CardField>
  );
};

const ExternalLinkButton: FunctionComponent<{ href: string, children: ReactNode }> = ({ href, children }) => (
  <Button priority="secondary" size="sm" startIcon={<ExternalLink className="size-4" />} asChild>
    <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
  </Button>
);

const DEFAULT_THREATS_LINKS = {
  attack: { name: 'MITRE ATT&CK', href: 'https://attack.mitre.org' },
  repository: 'https://github.com/OpenCRQ-Platform/datasets',
};

const DefaultThreatsAbout: FunctionComponent = () => (
  <span className="flex flex-wrap gap-2">
    <ExternalLinkButton href={DEFAULT_THREATS_LINKS.attack.href}>{DEFAULT_THREATS_LINKS.attack.name}</ExternalLinkButton>
    <ExternalLinkButton href={DEFAULT_THREATS_LINKS.repository}><Trans>Dataset repository</Trans></ExternalLinkButton>
  </span>
);

export const AboutPanel: FunctionComponent<{ connector: Pick<ConnectorDetail, 'source' | 'domain' | 'url'>, description: string }> = ({ connector, description }) => (
  <SectionCard title={<Trans>About this connector</Trans>} contentClassName="gap-4">
    <p>{description}</p>
    {connector.source === 'nist' && <NvdNotice />}
    <span className="flex flex-wrap gap-1">
      <Chip label={connectorDomainLabel(connector.domain)} />
    </span>
    {connector.source === 'default_threats' && <DefaultThreatsAbout />}
    {connector.url !== null && connector.source !== 'default_threats' && (
      <span className="flex gap-2">
        <Button priority="secondary" size="sm" startIcon={<ExternalLink className="size-4" />} asChild>
          <a href={connector.url} target="_blank" rel="noreferrer noopener">
            <Trans>Vendor contact</Trans>
          </a>
        </Button>
      </span>
    )}
  </SectionCard>
);

const BasicInformationPanel: FunctionComponent<{ connector: ConnectorDetail }> = ({ connector }) => {
  const navigate = useNavigate();
  const { tenantId } = useParams({ from: CONNECTOR_ROUTE });
  const configuredLabel = (configured: boolean): string => configured ? t`Configured` : t`Not configured`;
  const { serviceAccount } = connector;
  return (
    <SectionCard title={<Trans>Basic information</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
      <ChipField title={t`Domain`} labels={[connectorDomainLabel(connector.domain)]} />
      <ChipField title={t`Type`} labels={[connectorMechanismLabel(connector.mechanism)]} />
      <ChipField title={t`Scope`} labels={connector.scopeKinds.map(connectorScopeKindLabel)} />
      {/* The stream consumer has no job, so the row has nothing to state rather than nothing to show. */}
      {connector.jobKind !== null && <ChipField title={t`Job kind`} labels={[connector.jobKind]} />}
      <ChipField title={t`Platform`} labels={[configuredLabel(connector.platformConfigured)]} />
      {/* Default Threats runs as the platform: a tenant binds nothing to it. */}
      {connector.source !== 'default_threats' && (
        <>
          <ChipField title={t`Tenant`} labels={[configuredLabel(connector.tenantConfigured)]} />
          <InfoField
            title={t`Last update`}
            value={connector.settingsUpdatedAt === null ? null : formatDateTime(connector.settingsUpdatedAt)}
          />
          <IdentityField
            title={t`Service account`}
            icon={<User className="size-4" />}
            className="col-start-1"
            items={serviceAccount === null ? [] : [serviceAccount]}
            onOpen={(serviceAccountId) => void navigate({
              to: '/$tenantId/{-$organizationId}/settings/security/service-accounts/$serviceAccountId',
              params: { tenantId, serviceAccountId },
            })}
          />
          {/* Groups and roles have no page of their own, so their chips open the list that holds them. */}
          <IdentityField
            title={t`Service account groups`}
            icon={<Users className="size-4" />}
            items={connector.groups}
            onOpen={() => void navigate({ to: '/$tenantId/{-$organizationId}/settings/security/groups', params: { tenantId } })}
          />
          <IdentityField
            title={t`Service account roles`}
            icon={<ShieldCheck className="size-4" />}
            items={connector.roles}
            onOpen={() => void navigate({ to: '/$tenantId/{-$organizationId}/settings/security/roles', params: { tenantId } })}
          />
        </>
      )}
      {connector.source === 'opencti' && connector.platformConfigured && <OpenctiThreatVisibilityField />}
    </SectionCard>
  );
};

const ScheduleFields: FunctionComponent<{ connector: ConnectorDetail }> = ({ connector }) => {
  const trpc = useTRPC();
  const { data: schedule } = useQuery(trpc.connectors.getSchedule.queryOptions({ source: connector.source }));
  return (
    <>
      <InfoField title={t`Schedule`} value={schedule ? scheduleSummary(schedule) : null} />
      <InfoField title={t`Next run`} value={schedule?.nextRunAt ? formatNextRun(schedule.nextRunAt, schedule) : null} />
    </>
  );
};

/** The full re-read of the source's assets, which runs on its own cadence beside the incremental reads. */
const InventoryFields: FunctionComponent<{ inventory: NonNullable<ConnectorDetail['inventory']> }> = ({ inventory }) => {
  const next = inventory.requestedAt !== null || inventory.nextDueAt === null
    ? t`At the next run`
    : formatDateTime(inventory.nextDueAt);
  return (
    <>
      <InfoField
        title={t`Last inventory`}
        value={inventory.lastCompletedAt === null ? null : formatDateTime(inventory.lastCompletedAt)}
      />
      <InfoField title={t`Next inventory`} value={next} />
    </>
  );
};

const DetailsPanel: FunctionComponent<{ connector: ConnectorDetail }> = ({ connector }) => {
  const { lastRun } = connector;
  const lastRunAt = lastRun?.finishedAt ?? connector.lastReportedAt;
  return (
    <SectionCard title={<Trans>Details</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
      {connector.jobKind !== null && <ScheduleFields connector={connector} />}
      <StateField connector={connector} />
      <InfoField
        title={t`Last run`}
        value={lastRunAt === null || lastRunAt === undefined ? null : formatDateTime(lastRunAt)}
      />
      <InfoField title={t`Status`} value={lastRun === null ? null : runStatusLabel(lastRun.status)} />
      <InfoField title={t`Duration`} value={formatDurationMs(msBetween(lastRun?.startedAt ?? null, lastRun?.finishedAt ?? null))} />
      <InfoField title={t`Processed`} value={lastRun === null ? null : String(lastRun.processedTotal)} />
      {connector.inventory !== null && <InventoryFields inventory={connector.inventory} />}
    </SectionCard>
  );
};

const DatasetPanel: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data: overview } = useQuery(trpc.defaultThreats.getOverview.queryOptions());
  if (overview === undefined) {
    return null;
  }
  const { groups, campaigns, loadedAt } = overview;
  const loadedOn = loadedAt === null ? null : formatDate(loadedAt);
  return (
    <SectionCard title={<Trans>Dataset</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
      <CardField title={t`File`} className="col-span-2">
        {overview.datasetFileUrl === null ? <EmptyValue /> : (
          <span className="flex flex-col gap-1">
            <span className="break-all font-mono txt-sub-content">{overview.datasetFileUrl}</span>
            <span className="txt-sub-content text-muted-foreground"><Trans>Set in the platform configuration.</Trans></span>
          </span>
        )}
      </CardField>
      <InfoField title={t`ATT&CK release of the dataset`} value={overview.datasetRelease} />
      <InfoField title={t`ATT&CK release of this OpenCRQ`} value={overview.catalogueRelease} />
      <CardField title={t`Loaded`}>
        {loadedAt === null ? <EmptyValue /> : (
          <span><Trans>{groups} groups, {campaigns} campaigns · {loadedOn}</Trans></span>
        )}
      </CardField>
    </SectionCard>
  );
};

/** Suggests only: switching Default Threats off happens on its own page, behind its confirmation. */
const OpenctiCaughtUpAlert: FunctionComponent<{ connector: ConnectorDetail }> = ({ connector }) => {
  const trpc = useTRPC();
  const { data: overview } = useQuery(trpc.defaultThreats.getOverview.queryOptions());
  const { linkOption } = getConnectors().default_threats;
  if (!connector.streamEnabled || !connector.streamReachedLiveTail || overview?.enabled !== true) {
    return null;
  }
  return (
    <Alert
      severity="info"
      title={<Trans>Your OpenCTI stream has caught up, and OpenCRQ Default Threats is still enabled.</Trans>}
      description={<Trans>The default threats are listed beside yours, and a group both know counts once in a simulation. Disable them once your stream covers your threats.</Trans>}
      action={(
        <Button priority="secondary" size="sm" asChild>
          <Link {...linkOption}><Trans>Review Default Threats</Trans></Link>
        </Button>
      )}
    />
  );
};

export const ConnectorOverview: FunctionComponent<{ connector: ConnectorDetail }> = ({ connector }) => {
  const { description } = getConnectors()[connector.source];
  return (
    <div className="flex flex-col gap-6">
      {connector.source === 'opencti' && <OpenctiCaughtUpAlert connector={connector} />}
      <AboutPanel connector={connector} description={description} />
      <div className="grid grid-cols-2 items-start gap-6">
        <BasicInformationPanel connector={connector} />
        <DetailsPanel connector={connector} />
      </div>
      {connector.source === 'default_threats' && <DatasetPanel />}
    </div>
  );
};
