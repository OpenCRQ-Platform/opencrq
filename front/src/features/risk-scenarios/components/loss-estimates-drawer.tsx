import {
  Combobox,
  ComboboxControls,
  ComboboxField,
  ComboboxInput,
  ComboboxLabel,
  ComboboxTrigger,
  IconButton,
  Input,
} from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Sparkles, X } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import type { Control } from 'react-hook-form';
import type { AutomaticEstimate, DraftEstimateRow, DriverRecommendation, EstimateSource, LossEstimateRow, RecommendationCell, RecommendationRequirement } from '../scenario-loss-utils';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import {
  ComboboxPanel,
  DrawerFormActions,
  DrawerFormColumn,
  FormDrawer,
  InfoTooltip,
  SavedMeanwhile,
  STALE_WRITE_TOAST_DURATION,
  useFormDrawerContext,
  useFormDrawerDirtyState,
} from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { useTRPC } from '../../../lib';
import { filterOptionsByLabel, formatDollar } from '../../../utils';
import {
  buildLossEstimateRows,
  conflictingDraftRows,
  getEffectiveValues,
  getRowPert,
  getRowValidationError,
  groupByLossCategory,
  initialEstimateSource,
  partitionEstimateRows,
  planEstimatesSave,
  recommendationsOrCatalog,
  reconcileDraftRows,
  sameDraftRow,
  sumEstimateTotals,
} from '../scenario-loss-utils';
import { LossDriverInfo } from './loss-driver-info';
import { LowConfidenceIndicator } from './low-confidence-indicator';

const ROW_GRID_CLASSNAME = 'grid grid-cols-[minmax(0,1fr)_72px_repeat(3,120px)_100px_36px] items-center gap-x-3';

const VALIDATION_ERROR_MESSAGES = {
  NEGATIVE: () => t`Values must be zero or more`,
  MIN_GT_LIKELY: () => t`Min must be ≤ Most Likely`,
  LIKELY_GT_MAX: () => t`Most Likely must be ≤ Max`,
  MIN_GT_MAX: () => t`Min must be ≤ Max`,
} as const;

const lossEstimateRowDomId = (lossDriverId: string) => `loss-estimate-${lossDriverId}`;

interface EstimatesFormValues {
  rows: Array<DraftEstimateRow>,
  /** The server rows `rows` was last reconciled with, which the save is planned against. */
  base: Array<DraftEstimateRow>,
  /** The server's version of the rows the last reconcile kept from the draft although the server changed them too. */
  savedMeanwhile: Array<DraftEstimateRow>,
}

interface EstimateRowEditorProps {
  control: Control<EstimatesFormValues>,
  index: number,
  row: DraftEstimateRow,
  catalogRow: LossEstimateRow,
  automatic: AutomaticEstimate | undefined,
  viaCells: ReadonlyArray<RecommendationCell>,
  viaRequirements: ReadonlyArray<RecommendationRequirement>,
  savedMeanwhile: DraftEstimateRow | undefined,
  onSourceChange: (source: EstimateSource) => void,
  onUseSaved: () => void,
  onRemove?: () => void,
}

const formatEstimate = (value: string) => (value === '' ? <EmptyValue /> : formatDollar(Number(value)));

const EstimateRowEditor: FunctionComponent<EstimateRowEditorProps> = ({
  control, index, row, catalogRow, automatic, viaCells, viaRequirements, savedMeanwhile, onSourceChange, onUseSaved, onRemove,
}) => {
  const effective = getEffectiveValues(row, automatic);
  const isAuto = row.source === 'auto';
  const isPosture = isAuto && (automatic?.isPosture ?? catalogRow.isPosture);
  const lowConfidence = isAuto && (automatic?.lowConfidence ?? catalogRow.lowConfidence);
  const errorCode = isAuto ? null : getRowValidationError(row);
  const pert = getRowPert(effective);

  const sourceItems: Array<IconButtonGroupItem<EstimateSource>> = [
    { value: 'manual', icon: <Pencil className="size-4" />, tooltip: t`Manual` },
    {
      value: 'auto',
      icon: <Sparkles className="size-4" />,
      tooltip: automatic ? t`Auto` : t`No automatic value available`,
      disabled: !automatic,
    },
  ];

  return (
    <div id={lossEstimateRowDomId(row.lossDriverId)} className="flex scroll-mt-4 flex-col border-b border-border/40 py-2">
      <div className={ROW_GRID_CLASSNAME}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate">{catalogRow.lossDriverName}</span>
          <LossDriverInfo lossDriverName={catalogRow.lossDriverName} description={catalogRow.lossDriverDescription} viaCells={viaCells} viaRequirements={viaRequirements} />
          <LowConfidenceIndicator lowConfidence={lowConfidence} />
        </div>
        <IconButtonGroup items={sourceItems} value={row.source} onChange={onSourceChange} />
        {isPosture ? (
          <p className="col-span-3 text-right italic text-muted-foreground"><Trans>declared zero</Trans></p>
        ) : isAuto ? (
          <>
            <span className="text-right tabular-nums">{formatEstimate(effective.minValue)}</span>
            <span className="text-right tabular-nums">{formatEstimate(effective.likelyValue)}</span>
            <span className="text-right tabular-nums">{formatEstimate(effective.maxValue)}</span>
          </>
        ) : (
          <>
            <Controller
              control={control}
              name={`rows.${index}.minValue`}
              render={({ field }) => <Input {...field} type="number" min={0} aria-label={t`Min ($)`} />}
            />
            <Controller
              control={control}
              name={`rows.${index}.likelyValue`}
              render={({ field }) => <Input {...field} type="number" min={0} aria-label={t`Most Likely ($)`} />}
            />
            <Controller
              control={control}
              name={`rows.${index}.maxValue`}
              render={({ field }) => <Input {...field} type="number" min={0} aria-label={t`Max ($)`} />}
            />
          </>
        )}
        <span className="text-right font-medium tabular-nums text-primary">
          {pert === null ? <EmptyValue /> : formatDollar(pert)}
        </span>
        {onRemove ? (
          <IconButton priority="tertiary" size="sm" icon={<X className="size-4" />} aria-label={t`Remove`} onClick={onRemove} />
        ) : <span />}
      </div>
      {errorCode && (
        <p className="txt-sub-content text-right text-destructive">{VALIDATION_ERROR_MESSAGES[errorCode]()}</p>
      )}
      {savedMeanwhile && !sameDraftRow(row, savedMeanwhile) && (
        <div className="mt-2">
          <SavedMeanwhile onUse={onUseSaved}>
            <span className="tabular-nums">
              {savedMeanwhile.source === 'auto' ? t`Auto` : t`Manual`}
              {' · '}
              {formatEstimate(savedMeanwhile.minValue)}
              {' / '}
              {formatEstimate(savedMeanwhile.likelyValue)}
              {' / '}
              {formatEstimate(savedMeanwhile.maxValue)}
            </span>
          </SavedMeanwhile>
        </div>
      )}
    </div>
  );
};

interface LossEstimatesFormProps {
  riskScenarioId: string,
  catalogRows: Array<LossEstimateRow>,
  recommendations: Array<DriverRecommendation>,
  storedEstimates: Array<{ lossDriverId: string, updatedAt: string }>,
  focusLossDriverId: string | null,
}

const LossEstimatesForm: FunctionComponent<LossEstimatesFormProps> = ({
  riskScenarioId, catalogRows, recommendations, storedEstimates, focusLossDriverId,
}) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { closeDrawer } = useFormDrawerContext();
  const { toast } = useToast();

  const { data: automaticEstimates } = useQuery(trpc.scenarioLossEstimates.getAutomaticEstimates.queryOptions({ riskScenarioId }));
  const automaticById = new Map((automaticEstimates ?? []).map((estimate) => [estimate.lossDriverId, estimate]));

  const catalogById = new Map(catalogRows.map((row) => [row.lossDriverId, row]));
  const recommendationById = new Map(recommendations.map((entry) => [entry.lossDriverId, entry]));
  const { recommended, notRecommended } = partitionEstimateRows(catalogRows, recommendations);
  const serverRows: Array<DraftEstimateRow> = [...recommended, ...notRecommended].map((row) => ({
    lossDriverId: row.lossDriverId,
    source: initialEstimateSource(row.provenance),
    minValue: row.minValue,
    likelyValue: row.likelyValue,
    maxValue: row.maxValue,
  }));

  const form = useForm<EstimatesFormValues>({ defaultValues: { rows: serverRows, base: serverRows, savedMeanwhile: [] } });
  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: 'rows', keyName: 'fieldKey' });
  const rows = useWatch({ control: form.control, name: 'rows' }) ?? [];
  const base = useWatch({ control: form.control, name: 'base' }) ?? [];
  const savedMeanwhile = useWatch({ control: form.control, name: 'savedMeanwhile' }) ?? [];

  const serverKey = JSON.stringify(serverRows);
  const baseKey = JSON.stringify(base);
  useEffect(() => {
    if (serverKey === baseKey) {
      return;
    }
    const values = form.getValues();
    form.reset({
      rows: reconcileDraftRows(values.base, values.rows, serverRows),
      base: serverRows,
      savedMeanwhile: conflictingDraftRows(values.base, values.rows, serverRows, values.savedMeanwhile.map((row) => row.lossDriverId)),
    });
  }, [baseKey, form, serverKey, serverRows]);

  useEffect(() => {
    if (focusLossDriverId) {
      document.getElementById(lossEstimateRowDomId(focusLossDriverId))?.scrollIntoView({ block: 'center' });
    }
  }, [focusLossDriverId]);

  const upsertMutation = useMutation(trpc.scenarioLossEstimates.upsertScenarioLossEstimates.mutationOptions({
    meta: { skipSuccessToast: true, skipErrorToast: true },
    onError: (error) => {
      // The fingerprint is scenario-wide, so a recompute rewriting any row conflicts with this save.
      if (error.data?.reason === 'STALE_WRITE') {
        // eslint-disable-next-line no-restricted-syntax -- the retry needs the fresh fingerprint right after this response, not whenever the async doorbell round-trip lands.
        void queryClient.invalidateQueries(trpc.scenarioLossEstimates.getScenarioLossEstimates.queryFilter({ riskScenarioId }));
        toast({
          title: t`Error`,
          description: t`These loss estimates changed since they were last loaded. Reloading the latest values — review your edits and save again.`,
          variant: 'destructive',
          duration: STALE_WRITE_TOAST_DURATION,
        });
        return;
      }
      if (error.data?.code === 'PRECONDITION_FAILED') {
        // eslint-disable-next-line no-restricted-syntax -- the Auto toggles must disable right away on the drivers that lost their derived figure.
        void queryClient.invalidateQueries(trpc.scenarioLossEstimates.getAutomaticEstimates.queryFilter({ riskScenarioId }));
        toast({
          title: t`Error`,
          description: t`No automatic value is available for some of these drivers right now. Switch them back to Manual and save again.`,
          variant: 'destructive',
          duration: 2000,
        });
        return;
      }
      toast({ title: t`Error`, description: error.message, variant: 'destructive', duration: 2000 });
    },
  }));

  const storedIds = new Set(storedEstimates.map((estimate) => estimate.lossDriverId));
  const plan = planEstimatesSave(base, rows, storedIds);
  const changedCount = plan.estimates.length + plan.revertLossDriverIds.length;
  useFormDrawerDirtyState(changedCount > 0);
  const hasErrors = rows.some((row) => row.source === 'manual' && getRowValidationError(row) !== null);
  const totals = sumEstimateTotals(rows.map((row) => getEffectiveValues(row, automaticById.get(row.lossDriverId))));

  const save = async (values: EstimatesFormValues) => {
    const savePlan = planEstimatesSave(base, values.rows, storedIds);
    const scenarioUpdatedAt = storedEstimates.reduce<string | null>(
      (max, estimate) => (max === null || estimate.updatedAt > max ? estimate.updatedAt : max),
      null,
    );
    try {
      await upsertMutation.mutateAsync({
        riskScenarioId,
        estimates: savePlan.estimates,
        updatedAt: scenarioUpdatedAt,
        rowCount: storedEstimates.length,
        revertLossDriverIds: savePlan.revertLossDriverIds,
      });
    } catch {
      return;
    }
    toast({ description: t`Financial impact saved successfully.` });
    closeDrawer();
  };

  const savedMeanwhileById = new Map(savedMeanwhile.map((row) => [row.lossDriverId, row]));
  const recommendedIds = new Set(recommended.map((row) => row.lossDriverId));
  const indexed = fields.map((field, index) => ({ field, index, row: rows[index] ?? field }));
  const recommendedGroups = groupByLossCategory(
    indexed
      .filter(({ field }) => recommendedIds.has(field.lossDriverId))
      .map((entry) => ({ ...entry, ...pickCategory(catalogById.get(entry.field.lossDriverId)!) })),
  );
  const notRecommendedGroups = groupByLossCategory(
    indexed
      .filter(({ field }) => !recommendedIds.has(field.lossDriverId))
      .map((entry) => ({ ...entry, ...pickCategory(catalogById.get(entry.field.lossDriverId)!) })),
  );

  const draftIds = new Set(rows.map((row) => row.lossDriverId));
  const addableRows = catalogRows.filter((row) => !recommendedIds.has(row.lossDriverId) && !draftIds.has(row.lossDriverId));

  const changeSource = (index: number, row: DraftEstimateRow, source: EstimateSource) => {
    if (source === 'manual') {
      const values = getEffectiveValues(row, automaticById.get(row.lossDriverId));
      update(index, { ...row, ...values, source });
    } else {
      update(index, { ...row, source });
    }
  };

  const renderGroup = (groups: typeof recommendedGroups, removable: boolean) => groups.map((group) => (
    <div key={group.lossCategoryId} className="flex flex-col">
      <span className="txt-category pt-4 pb-1">{group.lossCategoryName}</span>
      {group.rows.map(({ field, index, row }) => (
        <EstimateRowEditor
          key={field.fieldKey}
          control={form.control}
          index={index}
          row={row}
          catalogRow={catalogById.get(field.lossDriverId)!}
          automatic={automaticById.get(field.lossDriverId)}
          viaCells={recommendationById.get(field.lossDriverId)?.viaCells ?? []}
          viaRequirements={recommendationById.get(field.lossDriverId)?.viaRequirements ?? []}
          savedMeanwhile={savedMeanwhileById.get(field.lossDriverId)}
          onSourceChange={(source) => changeSource(index, row, source)}
          onUseSaved={() => {
            const saved = savedMeanwhileById.get(field.lossDriverId);
            if (saved) {
              update(index, saved);
              form.setValue('savedMeanwhile', savedMeanwhile.filter((entry) => entry !== saved));
            }
          }}
          onRemove={removable ? () => remove(index) : undefined}
        />
      ))}
    </div>
  ));

  return (
    <DrawerFormColumn onSubmit={form.handleSubmit((values) => void save(values).catch(() => undefined))}>
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-4 rounded-sm bg-muted/40 px-4 py-3">
        <TotalTile label={t`Min`} value={totals.min} />
        <TotalTile label={t`Most Likely`} value={totals.likely} />
        <TotalTile label={t`Max`} value={totals.max} />
        <TotalTile label={t`PERT Expected`} value={totals.pert} emphasized />
      </div>

      <div className={`${ROW_GRID_CLASSNAME} txt-container-title border-b border-border pb-2 pr-2 text-muted-foreground`}>
        <span><Trans>Loss Driver</Trans></span>
        <span><Trans>Source</Trans></span>
        <span className="text-right"><Trans>Min ($)</Trans></span>
        <span className="text-right"><Trans>Most Likely ($)</Trans></span>
        <span className="text-right"><Trans>Max ($)</Trans></span>
        <span className="text-right"><Trans>PERT Expected</Trans></span>
        <span />
      </div>

      <div className="-mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
        {renderGroup(recommendedGroups, false)}

        <div className="flex items-center gap-2 pt-6 pb-1">
          <span className="txt-category text-orange"><Trans>Not recommended for this scenario</Trans></span>
          <InfoTooltip label={t`Not recommended for this scenario`}>
            <p><Trans>The loss model does not recommend these drivers for this attack outcome and this scenario's business resources. Their amounts are kept and counted.</Trans></p>
          </InfoTooltip>
        </div>
        {renderGroup(notRecommendedGroups, true)}

        {addableRows.length > 0 && (
          <div className="mt-4 max-w-md">
            <Combobox
              options={addableRows}
              value={null}
              onValueChange={(next) => {
                if (next && !Array.isArray(next)) {
                  append({ lossDriverId: next.lossDriverId, source: 'manual', minValue: '', likelyValue: '', maxValue: '' });
                }
              }}
              getOptionLabel={(option) => option.lossDriverName}
              filterOptions={filterOptionsByLabel((option) => option.lossDriverName)}
              isOptionEqualToValue={(a, b) => a.lossDriverId === b.lossDriverId}
              groupBy={(option) => option.lossCategoryName}
              renderOption={(option) => (
                <span className="flex flex-col py-1">
                  <span>{option.lossDriverName}</span>
                  {option.lossDriverDescription && (
                    <span className="txt-sub-content line-clamp-1 text-muted-foreground">{option.lossDriverDescription}</span>
                  )}
                </span>
              )}
            >
              <ComboboxLabel><Trans>Add a not-recommended driver</Trans></ComboboxLabel>
              <ComboboxField>
                <ComboboxInput placeholder={t`Search a loss driver`} />
                <ComboboxControls>
                  <ComboboxTrigger aria-label={t`Toggle the options`} />
                </ComboboxControls>
              </ComboboxField>
              <ComboboxPanel emptyMessage={t`No results`} listAriaLabel={t`Loss drivers from the catalog`} />
            </Combobox>
          </div>
        )}
      </div>

      {changedCount > 0 && (
        <p className="txt-sub-content text-muted-foreground">
          {plural(changedCount, { one: '# driver changed', other: '# drivers changed' })}
        </p>
      )}
      <DrawerFormActions
        isPending={upsertMutation.isPending}
        disabled={hasErrors || changedCount === 0}
      />
    </DrawerFormColumn>
  );
};

const pickCategory = (row: LossEstimateRow) => ({
  lossCategoryId: row.lossCategoryId,
  lossCategoryName: row.lossCategoryName,
  lossCategoryDisplayOrder: row.lossCategoryDisplayOrder,
});

interface TotalTileProps {
  label: string,
  value: number,
  emphasized?: boolean,
}

const TotalTile: FunctionComponent<TotalTileProps> = ({ label, value, emphasized }) => (
  <div className="flex flex-col">
    <span className={`txt-sub-content ${emphasized ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
    <span className={`txt-subtitle tabular-nums ${emphasized ? 'text-primary' : ''}`}>{formatDollar(value)}</span>
  </div>
);

interface LossEstimatesDrawerProps {
  open: boolean,
  onClose: () => void,
  riskScenarioId: string,
  focusLossDriverId: string | null,
}

export const LossEstimatesDrawer: FunctionComponent<LossEstimatesDrawerProps> = ({
  open, onClose, riskScenarioId, focusLossDriverId,
}) => (
  <FormDrawer
    open={open}
    onClose={onClose}
    title={t`Edit estimates`}
    className="max-md:w-full md:w-[70vw] max-w-[1080px] min-w-[min(960px,100vw)]"
    // The first focusable element is a row's info icon, whose tooltip would open on every opening.
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.focus();
      }
    }}
  >
    <LossEstimatesDrawerBody riskScenarioId={riskScenarioId} focusLossDriverId={focusLossDriverId} />
  </FormDrawer>
);

const LossEstimatesDrawerBody: FunctionComponent<{ riskScenarioId: string, focusLossDriverId: string | null }> = ({
  riskScenarioId, focusLossDriverId,
}) => {
  const trpc = useTRPC();
  const { data: lossDrivers } = useQuery(trpc.lossDrivers.getLossDrivers.queryOptions());
  const { data: storedEstimates } = useQuery(trpc.scenarioLossEstimates.getScenarioLossEstimates.queryOptions({ riskScenarioId }));
  const { data: recommendation } = useQuery(trpc.lossDrivers.getScenarioDriverRecommendation.queryOptions({ riskScenarioId }));

  if (!lossDrivers || !storedEstimates || !recommendation) {
    return <p className="text-muted-foreground"><Trans>Loading...</Trans></p>;
  }

  const catalogRows = buildLossEstimateRows(lossDrivers, storedEstimates);
  const recommendations = recommendationsOrCatalog(recommendation, catalogRows);

  return (
    <LossEstimatesForm
      riskScenarioId={riskScenarioId}
      catalogRows={catalogRows}
      recommendations={recommendations}
      storedEstimates={storedEstimates}
      focusLossDriverId={focusLossDriverId}
    />
  );
};
