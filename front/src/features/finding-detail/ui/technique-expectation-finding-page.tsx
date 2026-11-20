import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FindingHistoryEntry } from '../../supporting-assets/components/finding-history';
import { describeHistoryRow, HistoryEntryIcon, HistoryTestedOn } from '../../supporting-assets/components/finding-history';
import { causeFacts } from '../finding-cause-utils';
import { getFindingTitle } from '../../supporting-assets/finding-title';
import { CardField, DetailPageLayout, InfoField, SectionCard } from '../../../components/shared';
import { stateDurationLabel } from '../../finding-score';
import { dismissedStateLabel } from '../dismissal-vocabulary';
import { FindingActivityChart } from '../../supporting-assets/components/finding-activity-chart';
import { buildLinks, hasLiveConnectorSource } from '../../supporting-assets/connectors-utils';
import { getFindingFirstSeen, getFindingStateSince } from '../../supporting-assets/finding-dates-utils';
import { AssetName } from '../../../components/shared/asset-name';
import { DisplayDrawer } from '../../../components/shared/display-drawer';
import { EmptyValue } from '../../../components/ui/empty-value';
import { UserAvatar } from '../../../components/ui/user-avatar';
import { useTRPC } from '../../../lib';
import { formatDateTime, getExpectationTypeLabel } from '../../../utils';
import { FindingStateActions } from './finding-state-actions';

interface TechniqueExpectationFindingPageProps {
  evidenceId: string,
  tenantId: string,
}

/** The finding page of a technique expectation: one scroll, no tabs, no finding score. The dossier is CVE-only. */
export const TechniqueExpectationFindingPage: FunctionComponent<TechniqueExpectationFindingPageProps> = ({ evidenceId, tenantId }) => {
  const trpc = useTRPC();
  const { data: finding } = useQuery(trpc.supportingAssets.getEvidenceDetail.queryOptions({ evidenceId }));
  // Sources come back oldest-first, so the one shown does not change between two identical requests.
  const primarySource = finding?.sources.at(0) ?? null;
  const isOpenAevEvidence = primarySource?.source === 'openaev';
  const { data: connectorsStatus } = useQuery(trpc.integrations.getConnectorsStatus.queryOptions());
  const openaevUrl = isOpenAevEvidence ? (connectorsStatus?.openaev.url ?? null) : null;
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<FindingHistoryEntry | null>(null);

  if (!finding) {
    return null;
  }

  const findingTitle = getFindingTitle(finding);

  const current = finding.currentState ?? 'applicable';
  const latest = finding.history.at(-1);
  const isManuallySet = latest !== undefined && causeFacts(latest.origin).decision;

  const source = primarySource !== null
    ? (primarySource.source ?? t`Connector`)
    : t`Manual`;
  const links = buildLinks({
    connectorSource: primarySource?.source ?? null,
    sourceScenarioId: finding.sourceScenarioId,
    sourceSimulationId: finding.sourceSimulationId,
    sourceInjectId: finding.sourceInjectId,
    sourceFindingId: primarySource?.sourceFindingId ?? null,
    openaevUrl,
  });

  const techniqueExternalId = finding.mitreTechniqueExternalId;
  // The latest of every test the finding's sources sent, which the sync advances on each of them.
  const lastSeen = finding.evaluatedAt;
  const firstSeen = getFindingFirstSeen(finding.history);
  const selectedDescription = selectedHistoryEntry === null
    ? null
    : describeHistoryRow(
      selectedHistoryEntry,
      finding.history[finding.history.findIndex((h) => h.id === selectedHistoryEntry.id) - 1] ?? null,
      { kind: 'technique', connectorName: source },
    );
  const stateDuration = stateDurationLabel(current, getFindingStateSince(finding.history), { kind: 'technique', latest: latest ?? null });

  return (
    <>
      <DetailPageLayout
        title={findingTitle}
        actions={
          <div className="flex items-center gap-2">
            <FindingStateActions
              evidenceId={evidenceId}
              currentState={current}
              isManuallySet={isManuallySet}
              isConnectorBacked={hasLiveConnectorSource(finding.sources)}
              isHandAttached={finding.sources.length === 0}
            />
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          <SectionCard title={t`Information`}>
            <CardField title={finding.cveId ? t`CVE ID` : t`MITRE technique`}>
              <p>
                {finding.cveId ? (
                  <Link
                    to="/$tenantId/{-$organizationId}/findings/cve/$cveId"
                    params={{ tenantId, cveId: finding.cveId }}
                    className="font-mono text-primary underline-offset-4 hover:underline"
                  >
                    {finding.cveId}
                  </Link>
                ) : techniqueExternalId === null ? (
                  finding.mitreTechniqueName ?? <EmptyValue />
                ) : (
                  <Link
                    to="/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
                    params={{ tenantId, techniqueExternalId }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {techniqueExternalId}
                    {finding.mitreTechniqueName ? ` — ${finding.mitreTechniqueName}` : ''}
                  </Link>
                )}
              </p>
            </CardField>

            <CardField title={t`Asset`}>
              <p>
                <Link
                  to="/$tenantId/{-$organizationId}/assets/$supportingAssetId/overview"
                  params={{ tenantId, supportingAssetId: finding.supportingAssetId }}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  <AssetName name={finding.assetName} derivedName={finding.assetDerivedName} />
                </Link>
              </p>
            </CardField>

            {(finding.expectationType || finding.securityPlatformType) && (
              <div className="grid grid-cols-2 gap-x-8">
                {finding.expectationType && (
                  <InfoField title={t`Detection type`} value={getExpectationTypeLabel(finding.expectationType)} />
                )}
                {finding.securityPlatformType && (
                  <InfoField title={t`Platform`} value={finding.securityPlatformType} />
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-8">
              <InfoField title={t`Source`} value={source} />
              <InfoField title={t`Reported by`} value={finding.userName ?? undefined} />
            </div>

            {(firstSeen || lastSeen) && (
              <div className="grid grid-cols-2 gap-x-8">
                {firstSeen && <InfoField title={t`First Seen`} value={formatDateTime(firstSeen)} />}
                {lastSeen && <InfoField title={t`Last Seen`} value={formatDateTime(lastSeen)} />}
              </div>
            )}

            {(finding.sourceScenarioId || finding.sourceSimulationId || finding.sourceInjectId || primarySource?.sourceFindingId) && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                {finding.sourceScenarioId && (
                  <CardField title={t`Scenario ID`}>
                    {links.scenario ? (
                      <a
                        href={links.scenario}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {finding.sourceScenarioId}
                      </a>
                    ) : (
                      <p>{finding.sourceScenarioId}</p>
                    )}
                  </CardField>
                )}
                {finding.sourceSimulationId && (
                  <CardField title={t`Simulation ID`}>
                    {links.simulation ? (
                      <a
                        href={links.simulation}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {finding.sourceSimulationId}
                      </a>
                    ) : (
                      <p>{finding.sourceSimulationId}</p>
                    )}
                  </CardField>
                )}
                {finding.sourceInjectId && (
                  <CardField title={t`Source inject ID`}>
                    {links.inject ? (
                      <a
                        href={links.inject}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {finding.sourceInjectId}
                      </a>
                    ) : (
                      <p>{finding.sourceInjectId}</p>
                    )}
                  </CardField>
                )}
                {primarySource?.sourceFindingId && (
                  <CardField title={t`Source finding ID`}>
                    {links.finding ? (
                      <a
                        href={links.finding}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {primarySource.sourceFindingId}
                      </a>
                    ) : (
                      <p>{primarySource.sourceFindingId}</p>
                    )}
                  </CardField>
                )}
              </div>
            )}

            <CardField title={t`State`}>
              <div className="flex items-center gap-2">
                {finding.currentState === 'dismissed'
                  ? <Chip label={dismissedStateLabel({ kind: 'technique', origin: latest?.origin, dismissalType: latest?.dismissalType })} />
                  : <Chip label={t`Applicable`} />}
                {stateDuration !== null && (
                  <span className="txt-sub-content text-muted-foreground">{stateDuration}</span>
                )}
                {isManuallySet && (
                  <span className="txt-sub-content text-muted-foreground"><Trans>Set by user</Trans></span>
                )}
              </div>
            </CardField>
          </SectionCard>

          <SectionCard title={t`State evolution`}>
            <p className="txt-sub-content text-muted-foreground">{t`Finding state over the last year`}</p>
            <FindingActivityChart history={finding.history} kind="technique" />
          </SectionCard>

          <SectionCard title={t`History`}>
            {finding.history.length === 0 ? (
              <span className="txt-sub-content text-muted-foreground"><Trans>No history yet.</Trans></span>
            ) : (
              <ul className="divide-y">
                {finding.history.map((entry, index) => {
                  const { title, testedAt } = describeHistoryRow(entry, finding.history[index - 1] ?? null, { kind: 'technique', connectorName: source });
                  return (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between py-3 px-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedHistoryEntry(entry)}
                    >
                      <div className="flex gap-x-2 items-center">
                        <HistoryEntryIcon state={entry.state} isFirst={index === 0} />
                        <div className="flex flex-col">
                          <p className="txt-body2">{title}</p>
                          <HistoryTestedOn testedAt={testedAt} className="txt-sub-content text-muted-foreground" />
                        </div>
                      </div>
                      <p className="txt-sub-content text-muted-foreground">
                        {formatDateTime(entry.stateChangedAt)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </DetailPageLayout>

      {selectedHistoryEntry && (
        <DisplayDrawer
          open
          onClose={() => setSelectedHistoryEntry(null)}
          category={<Trans>Event</Trans>}
          title={selectedDescription?.title}
        >
          <div className="mt-4 space-y-4 px-1">
            <div className="flex items-center justify-between">
              <UserAvatar name={selectedDescription?.actor} />
              <div className="flex flex-col">
                <p className="txt-sub-content text-muted-foreground">
                  {formatDateTime(selectedHistoryEntry.stateChangedAt)}
                </p>
                <HistoryTestedOn testedAt={selectedDescription?.testedAt ?? null} className="txt-sub-content text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-2">
              <p className="txt-sub-content"><Trans>State</Trans></p>
              {selectedHistoryEntry.state === 'dismissed'
                ? <Chip label={dismissedStateLabel({ kind: 'technique', ...selectedHistoryEntry })} />
                : <Chip label={t`Applicable`} />}
            </div>
            {selectedHistoryEntry.reason && (
              <div className="space-y-1">
                <p className="txt-sub-content"><Trans>Reason</Trans></p>
                <p className="txt-body2 italic">"{selectedHistoryEntry.reason}"</p>
              </div>
            )}
          </div>
        </DisplayDrawer>
      )}
    </>
  );
};
