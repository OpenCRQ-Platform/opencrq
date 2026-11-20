import { Button, Paper } from '@filigran/design-system';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Pencil } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { LossCategoryGroup, LossEstimateRow, RecommendationCell } from '../scenario-loss-utils';
import type { MissingDataRow } from '../../../components/shared';
import { QUESTION_LABELS } from '../../financial-profiles/financial-profile-questions';
import {
  DOMINANT_LOSS_DRIVER_NAME,
  getRecommendedButUnderivedDrivers,
  isDominantLossDriverNeedingInput,
  LOSS_DRIVER_QUESTION_MAP,
} from '../loss-driver-question-map';
import { useTRPC } from '../../../lib';
import { tabForAction } from '../../organizations/scope-drawer-tabs';
import { formatDollar } from '../../../utils';
import {
  buildLossEstimateRows,
  getRowPert,
  groupByLossCategory,
  isRecomputeNoticeStanding,
  isRowComplete,
  partitionEstimateRows,
  sumEstimateTotals,
} from '../scenario-loss-utils';
import { InfoTooltip, MISSING_DATA_ACTION_CLASS, MissingDataAccordion, SectionCard, WarningDot } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ScenarioPlausibilityNotice } from './scenario-plausibility-notice';
import { ScenarioRecomputeNotice } from './scenario-recompute-notice';
import { LossDriverInfo } from './loss-driver-info';
import { LossEstimatesDrawer } from './loss-estimates-drawer';
import { LowConfidenceIndicator } from './low-confidence-indicator';
import { ProvenanceBadge } from './provenance-badge';

interface ScenarioLossEstimatesPageProps {
  riskScenarioId: string,
  organizationId: string,
}

/**
 * A declared zero is an answer, so the row names the cards that decide it. Naming them beats
 * asserting one driver's reason: the extortion row said "refuses to pay", which was already only
 * half the story once regulatory fines could reach zero the same way. A driver the map does not
 * hold names no card rather than the wrong one.
 */
const declaredZeroSource = (lossDriverName: string): string => {
  const questionIds = LOSS_DRIVER_QUESTION_MAP[lossDriverName] ?? [];
  if (questionIds.length === 0) {
    return t`Set by an answer in the risk scope's financial questionnaire.`;
  }
  const listFormatter = new Intl.ListFormat(i18n.locale || 'en', { style: 'long', type: 'conjunction' });
  const cardLabels = listFormatter.format(questionIds.map((questionId) => QUESTION_LABELS[questionId]()));
  return i18n._({
    id: "Set by {cardLabels} in the risk scope's financial questionnaire.",
    message: "Set by {cardLabels} in the risk scope's financial questionnaire.",
    values: { cardLabels },
  });
};

interface DrawerState {
  open: boolean,
  focusLossDriverId: string | null,
}

export const ScenarioLossEstimatesPage: FunctionComponent<ScenarioLossEstimatesPageProps> = ({
  riskScenarioId,
  organizationId,
}) => {
  const trpc = useTRPC();
  const [drawer, setDrawer] = useState<DrawerState>({ open: false, focusLossDriverId: null });

  const { data: lossDrivers, isLoading: isLoadingDrivers } = useQuery(trpc.lossDrivers.getLossDrivers.queryOptions());

  const { data: existingEstimates, isLoading: isLoadingEstimates } = useQuery(trpc.scenarioLossEstimates.getScenarioLossEstimates.queryOptions(
    { riskScenarioId },
  ));

  const { data: financialSummary } = useQuery(trpc.scenarioLossEstimates.getFinancialSummary.queryOptions(
    { riskScenarioId },
  ));

  const { data: recommendation, isLoading: isLoadingRecommendation } = useQuery(trpc.lossDrivers.getScenarioDriverRecommendation.queryOptions(
    { riskScenarioId },
  ));

  const { data: financialProfile, isLoading: isLoadingProfile, isError: isErrorProfile } = useQuery(trpc.financialProfiles.getFinancialProfile.queryOptions(
    { organizationId },
  ));

  const rows = lossDrivers && existingEstimates ? buildLossEstimateRows(lossDrivers, existingEstimates) : [];

  const hasRecommendation = (recommendation?.compatibleCellCount ?? 0) > 0;
  const { recommended, notRecommended } = partitionEstimateRows(
    rows,
    // No compatible cell: fall back to the whole catalog rather than an empty screen.
    hasRecommendation ? (recommendation?.recommendations ?? []) : rows.map((row) => ({ lossDriverId: row.lossDriverId, viaCells: [] })),
  );
  const shownRows = [...recommended, ...notRecommended];
  const estimatedCount = shownRows.filter((row) => row.isPosture || isRowComplete(row)).length;
  const shownCount = shownRows.length;
  const totals = sumEstimateTotals(rows);

  const scenarioUpdatedAt = existingEstimates && existingEstimates.length > 0
    ? existingEstimates.reduce((max, e) => e.updatedAt > max ? e.updatedAt : max, existingEstimates[0].updatedAt)
    : null;

  // Which recommended driver has no priced estimate at all, and what card would unlock it — both
  // facts computed here, never stored: see loss-driver-question-map.ts.
  const recommendationsWithNames = (recommendation?.recommendations ?? []).flatMap((rec) => {
    const driver = lossDrivers?.find((d) => d.id === rec.lossDriverId);
    return driver ? [{ lossDriverId: rec.lossDriverId, lossDriverName: driver.name, viaCells: rec.viaCells }] : [];
  });
  const presentLossDriverIds = new Set((existingEstimates ?? []).map((estimate) => estimate.lossDriverId));
  // The financial profile is what tells which cards are answered — never assert either claim
  // while that query is still loading or has failed, rather than fold the failure into "no profile".
  const underivedDrivers = !isLoadingProfile && !isErrorProfile
    ? getRecommendedButUnderivedDrivers(recommendationsWithNames, presentLossDriverIds, financialProfile ?? null)
    : [];
  const dominantLossDriverNeedsInput = !isLoadingProfile && !isErrorProfile
    && isDominantLossDriverNeedingInput(recommendationsWithNames, presentLossDriverIds, financialProfile?.rdIpValueBand ?? null);

  const financialProfileGapItems: Array<MissingDataRow> = [];
  if (!isLoadingProfile && !isErrorProfile && financialProfile === null) {
    financialProfileGapItems.push({
      key: 'no-financial-profile',
      label: t`No financial profile`,
      description: t`This risk scope has not answered the financial questionnaire yet.`,
      action: (
        <Link
          to="/$tenantId/{-$organizationId}/details/financial-profile"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId })}
          search={{ scopeDrawerTab: tabForAction('answer-questionnaire') }}
          className={MISSING_DATA_ACTION_CLASS}
        >
          {t`Go to questionnaire`}
        </Link>
      ),
    });
  }
  if (dominantLossDriverNeedsInput) {
    financialProfileGapItems.push({
      key: 'dominant-loss-driver',
      label: DOMINANT_LOSS_DRIVER_NAME,
      description: t`Dominant loss driver needs input`,
    });
  }
  const listFormatter = new Intl.ListFormat(i18n.locale || 'en', { style: 'long', type: 'conjunction' });
  for (const driver of underivedDrivers) {
    const cardLabels = listFormatter.format(driver.questionIds.map((questionId) => QUESTION_LABELS[questionId]()));
    financialProfileGapItems.push({
      key: `underived-${driver.lossDriverId}`,
      label: driver.lossDriverName,
      description: i18n._({ id: 'Needs card: {cardLabels}', message: 'Needs card: {cardLabels}', values: { cardLabels } }),
    });
  }

  if (isLoadingDrivers || isLoadingEstimates || isLoadingRecommendation) {
    return <div className="text-muted-foreground"><Trans>Loading...</Trans></div>;
  }

  if (lossDrivers && lossDrivers.length === 0) {
    return (
      <SectionCard title={t`Financial Impact`}>
        <p className="text-muted-foreground">
          <Trans>No loss drivers are available in this tenant's catalog.</Trans>
        </p>
      </SectionCard>
    );
  }

  const openDrawer = (focusLossDriverId: string | null) => setDrawer({ open: true, focusLossDriverId });

  return (
    <div className="flex flex-col gap-6">
      <ScenarioRecomputeNotice isRecomputing={isRecomputeNoticeStanding(financialSummary?.recomputePending ?? false, financialSummary?.updatedAt, scenarioUpdatedAt)} />

      <MissingDataAccordion title={t`Financial profile`} items={financialProfileGapItems} />

      <ScenarioPlausibilityNotice warnings={financialSummary?.sanityWarnings ?? []} />

      {/* Non-blocking: the scenario is legal, it simply recommends no loss driver. */}
      {!hasRecommendation && (
        <MissingDataAccordion
          title={t`No loss driver is recommended`}
          items={[{
            key: 'no-recommendation',
            label: t`Outcome and targets`,
            description: t`This outcome and this scenario's business resources have no combination in the loss model. The whole catalog is shown instead.`,
          }]}
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="txt-sub-content text-muted-foreground"><Trans>Loss Magnitude Summary</Trans></h2>
        <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-4">
          <SummaryFigure label={t`Min`} value={totals.min} />
          <SummaryFigure label={t`Most Likely`} value={totals.likely} />
          <SummaryFigure label={t`Max`} value={totals.max} />
          <SummaryFigure label={t`PERT Expected`} value={totals.pert} emphasized />
        </div>
      </section>

      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between">
          <span className="txt-sub-content text-muted-foreground">
            <Trans>Loss drivers · {estimatedCount} of {shownCount} estimated</Trans>
          </span>
          <Button startIcon={<Pencil className="size-4" />} onClick={() => openDrawer(null)}>
            <Trans>Edit estimates</Trans>
          </Button>
        </div>
        <EstimatesTable groups={groupByLossCategory(recommended)} onOpenRow={openDrawer} />
      </div>

      {notRecommended.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <WarningDot />
            <span className="txt-subtitle2 text-orange"><Trans>Not recommended for this scenario</Trans></span>
            <InfoTooltip label={t`Not recommended for this scenario`}>
              <p><Trans>The loss model does not recommend these drivers for this attack outcome and this scenario's business resources. Their amounts are kept and counted.</Trans></p>
            </InfoTooltip>
          </div>
          <EstimatesTable groups={groupByLossCategory(notRecommended)} onOpenRow={openDrawer} />
        </div>
      )}

      <LossEstimatesDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, focusLossDriverId: null })}
        riskScenarioId={riskScenarioId}
        focusLossDriverId={drawer.focusLossDriverId}
      />
    </div>
  );
};

interface SummaryFigureProps {
  label: string,
  value: number,
  emphasized?: boolean,
}

const SummaryFigure: FunctionComponent<SummaryFigureProps> = ({ label, value, emphasized }) => (
  <Paper
    elevation={1}
    className={`flex flex-col gap-2 p-5 ${emphasized ? 'border border-[color:var(--fds-color-filigran-brand-primary-transparency-55)]' : ''}`}
  >
    <span className={`txt-sub-content ${emphasized ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
    <span className={`font-title-lg text-[length:var(--fds-text-7)] font-medium leading-none tabular-nums ${emphasized ? 'text-primary' : ''}`}>
      {formatDollar(value)}
    </span>
  </Paper>
);

type EstimateTableRow = LossEstimateRow & { viaCells?: Array<RecommendationCell> };

interface EstimatesTableProps {
  groups: Array<LossCategoryGroup<EstimateTableRow>>,
  onOpenRow: (lossDriverId: string) => void,
}

const EstimatesTable: FunctionComponent<EstimatesTableProps> = ({ groups, onOpenRow }) => (
  <Paper elevation={1} className="overflow-hidden p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead><Trans>Loss Driver</Trans></TableHead>
          <TableHead className="w-[140px]"><Trans>Source</Trans></TableHead>
          <TableHead className="w-[120px] text-right"><Trans>Min</Trans></TableHead>
          <TableHead className="w-[120px] text-right"><Trans>Most Likely</Trans></TableHead>
          <TableHead className="w-[120px] text-right"><Trans>Max</Trans></TableHead>
          <TableHead className="w-[130px] text-right"><Trans>PERT Expected</Trans></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => {
          const subtotal = sumEstimateTotals(group.rows);
          const isPriced = group.rows.some((row) => row.isPosture || isRowComplete(row));
          const subtotalCell = (value: number) => (isPriced ? formatDollar(value) : <EmptyValue />);
          return [
            <TableRow key={group.lossCategoryId} className="bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={2}><span className="txt-category">{group.lossCategoryName}</span></TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{subtotalCell(subtotal.min)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{subtotalCell(subtotal.likely)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{subtotalCell(subtotal.max)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums text-primary">{subtotalCell(subtotal.pert)}</TableCell>
            </TableRow>,
            ...group.rows.map((row) => <EstimateRowView key={row.lossDriverId} row={row} onOpen={() => onOpenRow(row.lossDriverId)} />),
          ];
        })}
      </TableBody>
    </Table>
  </Paper>
);

interface EstimateRowViewProps {
  row: EstimateTableRow,
  onOpen: () => void,
}

const EstimateRowView: FunctionComponent<EstimateRowViewProps> = ({ row, onOpen }) => {
  const pert = getRowPert(row);
  const isBlank = row.minValue === '' && row.likelyValue === '' && row.maxValue === '';

  return (
    <TableRow
      className="cursor-pointer"
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-loss-driver-info]')) {
          return;
        }
        onOpen();
      }}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <button type="button" className="text-left hover:underline">{row.lossDriverName}</button>
          <span data-loss-driver-info className="inline-flex">
            <LossDriverInfo lossDriverName={row.lossDriverName} description={row.lossDriverDescription} viaCells={row.viaCells ?? []} />
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {row.provenance && <ProvenanceBadge provenance={row.provenance} />}
          <LowConfidenceIndicator lowConfidence={row.lowConfidence} />
        </div>
      </TableCell>
      {row.isPosture ? (
        <TableCell colSpan={3} className="text-right text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 italic">
            <Trans>declared zero</Trans>
            <InfoTooltip label={t`declared zero`}>
              <p>{declaredZeroSource(row.lossDriverName)}</p>
            </InfoTooltip>
          </span>
        </TableCell>
      ) : isBlank ? (
        <TableCell colSpan={3} className="text-right italic text-muted-foreground"><Trans>Not estimated</Trans></TableCell>
      ) : (
        <>
          <TableCell className="text-right tabular-nums">{row.minValue === '' ? <EmptyValue /> : formatDollar(Number(row.minValue))}</TableCell>
          <TableCell className="text-right tabular-nums">{row.likelyValue === '' ? <EmptyValue /> : formatDollar(Number(row.likelyValue))}</TableCell>
          <TableCell className="text-right tabular-nums">{row.maxValue === '' ? <EmptyValue /> : formatDollar(Number(row.maxValue))}</TableCell>
        </>
      )}
      <TableCell className="text-right font-medium tabular-nums text-primary">
        {pert === null ? <EmptyValue /> : formatDollar(pert)}
      </TableCell>
    </TableRow>
  );
};
