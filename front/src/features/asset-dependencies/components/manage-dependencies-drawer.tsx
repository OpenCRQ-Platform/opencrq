import { Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Text } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useParams } from '@tanstack/react-router';
import type { FunctionComponent, SyntheticEvent } from 'react';
import { useRef, useState } from 'react';
import { uuidv7 } from 'uuidv7';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DependencyWrite, LinkDelta, PendingCounts, SaveOperation, StoredLink } from '../manage-dependencies-utils';
import type { PrimaryCandidateRow } from './primary-asset-candidates';
import type { SupportingCandidateRow } from './supporting-asset-candidates';
import { formatList } from '../../../utils';
import {
  DrawerFormActions,
  DrawerFormBody,
  DrawerFormColumn,
  FormDrawer,
  useFormDrawerContext,
  useFormDrawerDirtyState,
} from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { useHoldDoorbells } from '../../../providers/event-stream-provider';
import {
  keysOfLinks,
  NOTHING_LEFT_OUT,
  pendingCounts,
  pendingMarker,
  pendingTotal,
  primaryLinkWrites,
  reconcileDelta,
  settleOperations,
  supportLinkWrites,
  withoutSettled,
} from '../manage-dependencies-utils';
import { PrimaryAssetCandidates } from './primary-asset-candidates';
import { SupportingAssetCandidates } from './supporting-asset-candidates';

const drawerClassName = 'max-md:w-full md:w-[70vw] max-w-[1280px] min-w-[min(860px,100vw)]';
/**
 * Failures are summed into one toast of the drawer's own, so no request raises its own. Each call is
 * its own request, since a save sends several calls of up to 500 links at once.
 */
const WRITE_OPTIONS = { meta: { skipSuccessToast: true, skipErrorToast: true }, trpc: { context: { skipBatch: true } } };

export type SupportingAssetDependencyTab = 'primary' | 'dependsOn' | 'providesTo';
const isSupportingTab = (value: string): value is SupportingAssetDependencyTab =>
  value === 'primary' || value === 'dependsOn' || value === 'providesTo';

/** The table pagers are type-less buttons inside this form: a page change must not submit it. */
const preventSubmit = (event: SyntheticEvent) => event.preventDefault();

const addAll = (a: PendingCounts, b: PendingCounts): PendingCounts => ({
  added: a.added + b.added,
  removed: a.removed + b.removed,
  edited: a.edited + b.edited,
});

const PendingSummary: FunctionComponent<{ counts: PendingCounts }> = ({ counts }) => {
  const { added, removed, edited } = counts;
  if (added + removed + edited === 0) {
    return <Text as="span" variant="content-compact" className="text-default-secondary"><Trans>No pending changes</Trans></Text>;
  }
  return (
    <Text as="span" variant="content-compact" className="flex gap-3">
      {added > 0 && <span className="text-[var(--fds-color-feedback-success-primary)]">{plural(added, { one: '+# added', other: '+# added' })}</span>}
      {removed > 0 && <span className="text-[var(--fds-color-feedback-error-primary)]">{plural(removed, { one: '−# removed', other: '−# removed' })}</span>}
      {edited > 0 && <span className="text-[var(--fds-color-feedback-alert-primary)]">{plural(edited, { one: '~# edited', other: '~# edited' })}</span>}
    </Text>
  );
};

/** The badge's accessible name, naming only the kinds of change the tab holds: "2 added and 1 edited". */
const pendingBadgeLabel = ({ added, removed, edited }: PendingCounts) => formatList([
  ...(added > 0 ? [plural(added, { one: '# added', other: '# added' })] : []),
  ...(removed > 0 ? [plural(removed, { one: '# removed', other: '# removed' })] : []),
  ...(edited > 0 ? [plural(edited, { one: '# edited', other: '# edited' })] : []),
]);

/** The requests a save sends for the writes of one list. */
const useDependencyWrites = () => {
  const trpc = useTRPC();
  const createPrimaryLinks = useMutation(trpc.assetDependencies.createSupportToPrimaryLinks.mutationOptions(WRITE_OPTIONS));
  const updatePrimaryLinks = useMutation(trpc.assetDependencies.updateSupportToPrimaryLinks.mutationOptions(WRITE_OPTIONS));
  const deletePrimaryLinks = useMutation(trpc.assetDependencies.deleteSupportToPrimaryLinks.mutationOptions(WRITE_OPTIONS));
  const createSupportLinks = useMutation(trpc.assetDependencies.createSupportToSupportLinks.mutationOptions(WRITE_OPTIONS));
  const deleteSupportLinks = useMutation(trpc.assetDependencies.deleteSupportToSupportLinks.mutationOptions(WRITE_OPTIONS));
  return <List extends string>(list: List, writes: ReadonlyArray<DependencyWrite>): Array<SaveOperation<List>> =>
    writes.map((write) => ({
      list,
      ids: write.ids,
      run: async () => {
        switch (write.kind) {
          case 'createPrimary': {
            const { skippedIds, goneIds } = await createPrimaryLinks.mutateAsync(write.links);
            return { skipped: keysOfLinks(write, skippedIds), gone: keysOfLinks(write, goneIds) };
          }
          case 'updatePrimary':
            return { skipped: keysOfLinks(write, (await updatePrimaryLinks.mutateAsync(write.links)).skippedIds), gone: [] };
          case 'createSupport':
            return { skipped: [], gone: keysOfLinks(write, (await createSupportLinks.mutateAsync(write.links)).goneIds) };
          case 'deletePrimary':
            await deletePrimaryLinks.mutateAsync(write.linkIds);
            return NOTHING_LEFT_OUT;
          case 'deleteSupport':
            await deleteSupportLinks.mutateAsync(write.linkIds);
            return NOTHING_LEFT_OUT;
        }
      },
    }));
};

const storedOfIn = (stored: ReadonlyMap<string, StoredLink>) => (id: string) => stored.get(id) ?? null;

const saveLabel = (total: number) => (total === 0 ? t`Save` : plural(total, { one: 'Save # change', other: 'Save # changes' }));

/**
 * Sends the save and settles the delta: a full success closes the drawer behind one toast, a
 * partial one keeps the failed and skipped changes pending and says how many. A skip comes from
 * another writer's change, whose doorbell refreshes the links the delta is reconciled against. A
 * link to an asset deleted meanwhile is dropped from the delta, since a retry could never create it.
 * The doorbells are held until the last call settles, so the page refreshes, and redraws, once.
 * `isSaving` makes the lists inert, since a full success closes the drawer and would drop unsaved a
 * change made during the save.
 */
const useSaveChanges = <List extends string>(onPartialSave: (settled: ReadonlyMap<List, ReadonlySet<string>>) => void) => {
  const { toast } = useToast();
  const { closeDrawer } = useFormDrawerContext();
  const holdDoorbells = useHoldDoorbells();
  const [isSaving, setIsSaving] = useState(false);
  const save = async (operations: ReadonlyArray<SaveOperation<List>>, total: number) => {
    setIsSaving(true);
    const release = holdDoorbells();
    const { settled, failed, skipped, gone } = await settleOperations(operations).finally(release);
    if (failed === 0 && skipped === 0) {
      const saved = total - gone;
      if (saved > 0) {
        toast({ description: plural(saved, { one: '# dependency change saved.', other: '# dependency changes saved.' }) });
      }
      closeDrawer();
    } else {
      onPartialSave(settled);
      setIsSaving(false);
    }
    if (gone > 0) {
      toast({
        description: plural(gone, {
          one: '# link was not created, as its asset was deleted in the meantime.',
          other: '# links were not created, as their assets were deleted in the meantime.',
        }),
        variant: 'info',
      });
    }
    if (skipped > 0) {
      toast({
        description: plural(skipped, {
          one: '# change was not applied, as its link changed in the meantime. Check it against the refreshed list.',
          other: '# changes were not applied, as their links changed in the meantime. Check them against the refreshed list.',
        }),
        variant: 'info',
      });
    }
    if (failed > 0) {
      toast({
        title: t`Error`,
        description: plural(failed, {
          one: '# change could not be saved. It is still pending.',
          other: '# changes could not be saved. They are still pending.',
        }),
        variant: 'destructive',
      });
    }
  };
  return { isSaving, save };
};

const LinksLoading: FunctionComponent<{ isError: boolean }> = ({ isError }) => (
  <div className="flex flex-1 items-center justify-center p-8">
    {isError
      ? <Text as="p" variant="content-compact" className="text-default-secondary"><Trans>The dependencies of this asset could not be loaded.</Trans></Text>
      : <Spinner />}
  </div>
);

interface SupportingDeltas {
  primary: LinkDelta<PrimaryCandidateRow>,
  dependsOn: LinkDelta<SupportingCandidateRow>,
  providesTo: LinkDelta<SupportingCandidateRow>,
}
const EMPTY_SUPPORTING_DELTAS: SupportingDeltas = { primary: {}, dependsOn: {}, providesTo: {} };

interface SupportingAssetDependenciesFormProps {
  supportingAssetId: string,
  supportingAssetName: string,
  initialTab: SupportingAssetDependencyTab,
}

const SupportingAssetDependenciesForm: FunctionComponent<SupportingAssetDependenciesFormProps> = ({
  supportingAssetId,
  supportingAssetName,
  initialTab,
}) => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const scopeId = organizationId ?? null;
  const [tab, setTab] = useState(initialTab);
  const [deltas, setDeltas] = useState(EMPTY_SUPPORTING_DELTAS);
  const bodyRef = useRef<HTMLDivElement>(null);

  const primaryLinks = useQuery(trpc.assetDependencies.getSupportToPrimaryLinksBySupportingAssetId.queryOptions({ supportingAssetId }));
  const supportLinks = useQuery(trpc.assetDependencies.getSupportToSupportLinks.queryOptions({ assetId: supportingAssetId }));
  const primaryCandidates = useQuery(trpc.primaryAssets.getPrimaryAssetsWithScope.queryOptions());
  const toOperations = useDependencyWrites();

  const { isSaving, save } = useSaveChanges<keyof SupportingDeltas>((settled) => setDeltas((current) => ({
    primary: withoutSettled(current.primary, settled.get('primary') ?? new Set()),
    dependsOn: withoutSettled(current.dependsOn, settled.get('dependsOn') ?? new Set()),
    providesTo: withoutSettled(current.providesTo, settled.get('providesTo') ?? new Set()),
  })));

  const storedPrimary = new Map<string, StoredLink>((primaryLinks.data ?? []).map((link) => [link.primaryAssetId, { linkId: link.id, roles: link.roles }]));
  const storedSupport = (direction: 'depends' | 'provides') => new Map<string, StoredLink>((supportLinks.data ?? [])
    .filter((link) => link.direction === direction)
    .map((link) => [link.relatedAssetId, { linkId: link.id, roles: null }]));
  const storedDependsOn = storedSupport('depends');
  const storedProvidesTo = storedSupport('provides');
  const reconciled: SupportingDeltas = {
    primary: primaryLinks.data === undefined ? deltas.primary : reconcileDelta(deltas.primary, storedOfIn(storedPrimary)),
    dependsOn: supportLinks.data === undefined ? deltas.dependsOn : reconcileDelta(deltas.dependsOn, storedOfIn(storedDependsOn)),
    providesTo: supportLinks.data === undefined ? deltas.providesTo : reconcileDelta(deltas.providesTo, storedOfIn(storedProvidesTo)),
  };
  const candidates = primaryCandidates.data ?? [];

  const total = pendingTotal([reconciled.primary, reconciled.dependsOn, reconciled.providesTo]);
  useFormDrawerDirtyState(total > 0);

  const counts = {
    primary: pendingCounts(reconciled.primary),
    dependsOn: pendingCounts(reconciled.dependsOn),
    providesTo: pendingCounts(reconciled.providesTo),
  };
  const linkedCounts = {
    primary: candidates.filter((row) => storedPrimary.has(row.id)).length,
    dependsOn: storedDependsOn.size,
    providesTo: storedProvidesTo.size,
  };

  const onSave = () => {
    void save([
      ...toOperations('primary', primaryLinkWrites(reconciled.primary, (primaryAssetId) => ({ supportingAssetId, primaryAssetId }), uuidv7)),
      ...toOperations('dependsOn', supportLinkWrites(reconciled.dependsOn, supportingAssetId, 'dependsOn', uuidv7)),
      ...toOperations('providesTo', supportLinkWrites(reconciled.providesTo, supportingAssetId, 'providesTo', uuidv7)),
    ], total);
  };

  const name = <strong>{supportingAssetName}</strong>;
  const ready = primaryLinks.isSuccess && supportLinks.isSuccess;
  const trigger = (value: SupportingAssetDependencyTab, label: string) => {
    const marker = pendingMarker(counts[value]);
    return (
      <TabsTrigger value={value} badge={marker} badgeInvisible={marker === ''} badgeLabel={pendingBadgeLabel(counts[value])}>
        {label}
      </TabsTrigger>
    );
  };

  return (
    <DrawerFormColumn onSubmit={preventSubmit}>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isSupportingTab(value) && value !== tab) {
            setTab(value);
            // The three panels share one scroller, which would carry the previous tab's offset over.
            bodyRef.current?.scrollTo({ top: 0 });
          }
        }}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList>
          {trigger('primary', i18n._({ id: 'Primary assets · {count}', message: 'Primary assets · {count}', values: { count: linkedCounts.primary } }))}
          {trigger('dependsOn', i18n._({ id: 'Depends on · {count}', message: 'Depends on · {count}', values: { count: linkedCounts.dependsOn } }))}
          {trigger('providesTo', i18n._({ id: 'Provides to · {count}', message: 'Provides to · {count}', values: { count: linkedCounts.providesTo } }))}
        </TabsList>
        <DrawerFormBody ref={bodyRef} inert={isSaving}>
          {!ready && <LinksLoading isError={primaryLinks.isError || supportLinks.isError} />}
          {ready && (
            <>
              <TabsContent value="primary">
                <PrimaryAssetCandidates
                  candidates={candidates}
                  initialScopeId={scopeId}
                  isLoading={primaryCandidates.isLoading}
                  sentence={<Trans>{name} supports these primary assets…</Trans>}
                  storedLinks={storedPrimary}
                  delta={reconciled.primary}
                  onDeltaChange={(primary) => setDeltas((current) => ({ ...current, primary }))}
                />
              </TabsContent>
              <TabsContent value="dependsOn">
                <SupportingAssetCandidates
                  relation="dependsOn"
                  assetId={supportingAssetId}
                  sentence={<Trans>{name} depends on…</Trans>}
                  storedLinks={storedDependsOn}
                  delta={reconciled.dependsOn}
                  onDeltaChange={(dependsOn) => setDeltas((current) => ({ ...current, dependsOn }))}
                  withRoles={false}
                />
              </TabsContent>
              <TabsContent value="providesTo">
                <SupportingAssetCandidates
                  relation="providesTo"
                  assetId={supportingAssetId}
                  sentence={<Trans>{name} provides to…</Trans>}
                  storedLinks={storedProvidesTo}
                  delta={reconciled.providesTo}
                  onDeltaChange={(providesTo) => setDeltas((current) => ({ ...current, providesTo }))}
                  withRoles={false}
                />
              </TabsContent>
            </>
          )}
        </DrawerFormBody>
      </Tabs>
      <DrawerFormActions
        submitType="button"
        onSubmit={onSave}
        isPending={isSaving}
        disabled={total === 0}
        submitLabel={saveLabel(total)}
        summary={<PendingSummary counts={addAll(addAll(counts.primary, counts.dependsOn), counts.providesTo)} />}
      />
    </DrawerFormColumn>
  );
};

interface ManageSupportingAssetDependenciesDrawerProps {
  open: boolean,
  onClose: () => void,
  supportingAssetId: string,
  supportingAssetName: string,
  initialTab?: SupportingAssetDependencyTab,
}

/** Every link of a supporting asset, edited as one delta and saved together. */
export const ManageSupportingAssetDependenciesDrawer: FunctionComponent<ManageSupportingAssetDependenciesDrawerProps> = ({
  open,
  onClose,
  supportingAssetId,
  supportingAssetName,
  initialTab,
}) => (
  <FormDrawer
    open={open}
    onClose={onClose}
    title={i18n._({
      id: 'Manage dependencies of supporting asset {name}',
      message: 'Manage dependencies of supporting asset {name}',
      values: { name: supportingAssetName },
    })}
    className={drawerClassName}
  >
    {open && (
      <SupportingAssetDependenciesForm
        supportingAssetId={supportingAssetId}
        supportingAssetName={supportingAssetName}
        initialTab={initialTab ?? 'dependsOn'}
      />
    )}
  </FormDrawer>
);

interface PrimaryAssetDependenciesFormProps {
  primaryAssetId: string,
  primaryAssetName: string,
}

const PrimaryAssetDependenciesForm: FunctionComponent<PrimaryAssetDependenciesFormProps> = ({ primaryAssetId, primaryAssetName }) => {
  const trpc = useTRPC();
  const [stagedDelta, setDelta] = useState<LinkDelta<SupportingCandidateRow>>({});
  const links = useQuery(trpc.assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId.queryOptions({ primaryAssetId }));
  const toOperations = useDependencyWrites();
  const { isSaving, save } = useSaveChanges<'supportedBy'>((settled) =>
    setDelta((current) => withoutSettled(current, settled.get('supportedBy') ?? new Set())));

  const stored = new Map<string, StoredLink>((links.data ?? []).map((link) => [link.supportingAssetId, { linkId: link.id, roles: link.roles }]));
  const delta = links.data === undefined ? stagedDelta : reconcileDelta(stagedDelta, storedOfIn(stored));
  const total = Object.keys(delta).length;
  useFormDrawerDirtyState(total > 0);

  const onSave = () => {
    void save(toOperations('supportedBy', primaryLinkWrites(delta, (supportingAssetId) => ({ supportingAssetId, primaryAssetId }), uuidv7)), total);
  };

  const name = <strong>{primaryAssetName}</strong>;
  return (
    <DrawerFormColumn onSubmit={preventSubmit}>
      <DrawerFormBody inert={isSaving}>
        {!links.isSuccess && <LinksLoading isError={links.isError} />}
        {links.isSuccess && (
          <SupportingAssetCandidates
            relation="supportsPrimary"
            assetId={primaryAssetId}
            sentence={<Trans>{name} is supported by…</Trans>}
            storedLinks={stored}
            delta={delta}
            onDeltaChange={setDelta}
            withRoles
          />
        )}
      </DrawerFormBody>
      <DrawerFormActions
        submitType="button"
        onSubmit={onSave}
        isPending={isSaving}
        disabled={total === 0}
        submitLabel={saveLabel(total)}
        summary={<PendingSummary counts={pendingCounts(delta)} />}
      />
    </DrawerFormColumn>
  );
};

interface ManagePrimaryAssetDependenciesDrawerProps {
  open: boolean,
  onClose: () => void,
  primaryAssetId: string,
  primaryAssetName: string,
}

/** The supporting assets of a primary asset and their roles, edited as one delta and saved together. */
export const ManagePrimaryAssetDependenciesDrawer: FunctionComponent<ManagePrimaryAssetDependenciesDrawerProps> = ({
  open,
  onClose,
  primaryAssetId,
  primaryAssetName,
}) => (
  <FormDrawer
    open={open}
    onClose={onClose}
    title={i18n._({
      id: 'Manage dependencies of primary asset {name}',
      message: 'Manage dependencies of primary asset {name}',
      values: { name: primaryAssetName },
    })}
    className={drawerClassName}
  >
    {open && <PrimaryAssetDependenciesForm primaryAssetId={primaryAssetId} primaryAssetName={primaryAssetName} />}
  </FormDrawer>
);
