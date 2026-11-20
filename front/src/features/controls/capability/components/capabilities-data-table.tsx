import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { CONTROL_DOMAINS } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import type { ListedCapability } from '../types/capability';
import type { AssessmentFilter } from '../capability-data-utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { DataPageLayout } from '../../../../components/ui/data-page-layout';
import { useUrlListFilters } from '../../../../hooks';
import { useTRPC } from '../../../../lib';
import { capabilitiesListSearchSchema } from '../capabilities-list-search';
import { useCapabilityColumns } from '../hooks/use-capability-columns';
import { buildCapabilitiesView, resolveAssessmentFilter } from '../capability-data-utils';
import { useScopePosture } from '../hooks/use-scope-posture';
import { overlayScopePosture } from '../utils/scope-posture-utils';
import { controlDomainLabel } from '../ui/control-domain-label';
import { DebouncedSearchField } from '../../../../components/shared';
import { CapabilityAssessmentEditDrawer } from './capability-assessment-edit-drawer';
import { UnassessedCount } from './unassessed-count';

const toAssessmentFilter = (value: string, inScope: boolean): AssessmentFilter => {
  if (value === 'unassessed' || value === 'forced') {
    return resolveAssessmentFilter(value, inScope);
  }
  return 'all';
};

interface EditTarget {
  id: string,
  externalId: string,
  name: string,
  index: number,
}

export const CapabilitiesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const { data, isLoading: isLoadingCapabilities } = useQuery(trpc.controlCapabilities.getControlCapabilities.queryOptions());
  const { organizationId, postures, isAwaitingScope } = useScopePosture();
  const inScope = organizationId !== undefined;
  const isLoading = isLoadingCapabilities || isAwaitingScope;
  const { filters, setFilters } = useUrlListFilters(capabilitiesListSearchSchema);
  const assessment = resolveAssessmentFilter(filters.assessment, inScope);
  const rows = data === undefined || isAwaitingScope ? undefined : overlayScopePosture(data, postures);
  const { processedData, unassessedCount } = buildCapabilitiesView(rows, { search: filters.search, assessment });

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [departedName, setDepartedName] = useState<string | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const pendingFocusRef = useRef<EditTarget | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Read from the DOM rather than from `processedData`, which the table then sorts and paginates:
  // the position focus has to return to is the one the reader sees.
  const rowActionsInDisplayOrder = (): Array<HTMLElement> => Array.from(
    tableContainerRef.current?.querySelectorAll<HTMLElement>('[data-row-action]') ?? [],
  );

  const openDrawer = (capability: ListedCapability, e: MouseEvent) => {
    e.stopPropagation();
    setDepartedName(null);
    setEditTarget({
      id: capability.id,
      externalId: capability.externalId,
      name: capability.name,
      index: rowActionsInDisplayOrder().findIndex((node) => node.dataset.rowAction === capability.id),
    });
  };

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) {
      return;
    }
    pendingFocusRef.current = null;
    const holders = rowActionsInDisplayOrder();
    const successor = pending.index < 0 ? undefined : holders[Math.min(pending.index, holders.length - 1)];
    const holder = holders.find((node) => node.dataset.rowAction === pending.id) ?? successor;
    const trigger = holder?.querySelector('button');
    if (trigger) {
      trigger.focus();
    } else {
      tableContainerRef.current?.focus();
    }
  }, [focusRevision, processedData]);

  const columns = useCapabilityColumns(openDrawer);

  return (
    <div ref={tableContainerRef} tabIndex={-1}>
      <DataPageLayout
        data={processedData}
        columns={columns}
        isLoading={isLoading}
        storageKey="control-capabilities-with-effectiveness"
        // The catalogue is bounded: a page break would hide its last domains behind a click.
        initialPageSize={100}
        rowGroups={{
          groupOf: (capability) => capability.domain,
          order: CONTROL_DOMAINS,
          renderHeader: (domain, count) => (
            <>
              <span className="txt-category">{controlDomainLabel(domain)}</span>
              <span className="txt-sub-content text-muted-foreground"> · {count}</span>
            </>
          ),
        }}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}/controls/',
            to: '$controlId',
            params: { controlId: row.original.id },
          });
        }}
        emptyState={assessment === 'unassessed'
          ? (
            <p className="py-8 text-center text-muted-foreground">
              <Trans>Every control carries a declaration.</Trans>
            </p>
          )
          : assessment === 'forced'
            ? (
              <p className="py-8 text-center text-muted-foreground">
                <Trans>No control is overridden on this scope.</Trans>
              </p>
            )
            : undefined}
        leftHeaderContent={(
          <>
            <DebouncedSearchField
              placeholder={t`Search controls...`}
              value={filters.search}
              onCommit={(search) => setFilters({ search })}
              clearLabel={t`Clear search`}
              className="w-80"
            />
            <Select value={assessment} onValueChange={(value) => setFilters({ assessment: toAssessmentFilter(value, inScope) })}>
              <SelectTrigger className={inScope ? 'w-72' : 'w-56'} aria-label={t`Filter by assessment status`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><Trans>All assessment statuses</Trans></SelectItem>
                <SelectItem value="unassessed"><Trans>Not assessed</Trans></SelectItem>
                {inScope && <SelectItem value="forced"><Trans>Overrides on this scope</Trans></SelectItem>}
              </SelectContent>
            </Select>
          </>
        )}
        headerActions={(
          <UnassessedCount
            count={unassessedCount}
            rowCount={processedData.length}
            filterSignature={assessment}
            departedName={departedName}
            onDepartureAnnounced={() => setDepartedName(null)}
          />
        )}
      />
      {editTarget !== null && (
        <CapabilityAssessmentEditDrawer
          capabilityId={editTarget.id}
          externalId={editTarget.externalId}
          name={editTarget.name}
          onClose={() => {
            pendingFocusRef.current = editTarget;
            setFocusRevision((revision) => revision + 1);
            setEditTarget(null);
          }}
          onSuccess={() => {
            if (assessment === 'unassessed') {
              setDepartedName(editTarget.name);
            }
          }}
        />
      )}
    </div>
  );
};
