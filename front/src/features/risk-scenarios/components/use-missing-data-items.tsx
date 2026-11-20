import { computeScenarioReadiness, SCENARIO_INPUT_KINDS } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib';

export type MissingDataKey = 'no-mapped-asset' | 'loss-drivers' | 'tef' | 'what-if-stale' | 'financial-stale' | 'tef-stale';
export type MissingDataLabelKey = 'controls' | 'estate' | 'loss-drivers' | 'tef';

export interface MissingDataActionLink {
  from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
  to:
    | '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/financial-impact'
    | '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/threat',
  text: string,
}

export interface MissingDataItem {
  key: MissingDataKey,
  labelKey: MissingDataLabelKey,
  label: string,
  description: string,
  action?: MissingDataActionLink,
}

interface UseMissingDataItemsOptions {
  riskScenarioId: string,
  whatIfStale?: boolean,
  /** True when the scenario's risk scope is measured over its mapped assets and holds none. */
  noMappedAsset?: boolean,
  /**
   * The label of the page currently being viewed.
   * - Omit (overview mode) → all items returned with a navigation action.
   * - Provided (page mode) → only the item matching this label is returned, without action.
   */
  currentLabel?: MissingDataLabelKey,
}

export const useMissingDataItems = ({ riskScenarioId, whatIfStale, noMappedAsset, currentLabel }: UseMissingDataItemsOptions): Array<MissingDataItem> => {
  const trpc = useTRPC();
  const { data: tefMode, isPending: isTefModePending } = useQuery(trpc.crqIndicators.getTefMode.queryOptions(
    { riskScenarioId },
  ));
  const isAutoTef = tefMode === 'auto';

  const { data: tefInput, isPending: isTefInputPending } = useQuery(trpc.crqIndicators.getTefInput.queryOptions(
    { riskScenarioId },
    { enabled: !isAutoTef },
  ));
  // Auto mode never reads the manual triplet — it always has a computed estimate, same source the
  // simulation itself samples from (see buildTefInputForSimulation). Gated behind auto mode since
  // the query itself computes-and-persists the estimate when missing.
  const { data: autoTefEstimate, isPending: isAutoTefPending } = useQuery(trpc.crqIndicators.getAutoTefEstimate.queryOptions(
    { riskScenarioId },
    { enabled: isAutoTef },
  ));

  const { data: financialSummary, isPending: isFinancialPending } = useQuery(trpc.scenarioLossEstimates.getFinancialSummary.queryOptions(
    { riskScenarioId },
  ));

  const { data: latestRun, isPending: isLatestRunPending } = useQuery(trpc.crqIndicators.getLatestRun.queryOptions({ riskScenarioId }));

  const isTefPending = isTefModePending || (isAutoTef ? isAutoTefPending : isTefInputPending);
  // A run still in flight reads as a scenario that never ran, which flags every input as outdated.
  if (isLatestRunPending || isFinancialPending || isTefPending) {
    return [];
  }

  const hasLossDrivers = (financialSummary?.pertExpectedValue ?? 0) > 0;
  const tefUpdatedAt = isAutoTef
    ? (autoTefEstimate ? new Date(autoTefEstimate.createdAt) : null)
    : (tefInput ? new Date(tefInput.updatedAt) : null);

  const lastRunAt = latestRun ? new Date(latestRun.createdAt) : null;

  const readiness = computeScenarioReadiness({
    lastRunAt,
    tefUpdatedAt,
    lossDriversUpdatedAt: hasLossDrivers && financialSummary?.updatedAt
      ? new Date(financialSummary.updatedAt)
      : null,
  });

  const missing = new Set(readiness.missing);
  // A scenario that has never run reflects none of its inputs, so every one of them is outdated.
  // Its inputs never changed, though, and saying they did sends the reader hunting for an edit that
  // was never made.
  const neverRun = lastRunAt === null;
  const outdated = new Set(neverRun ? SCENARIO_INPUT_KINDS : readiness.outdated);
  const outdatedDescription = neverRun
    ? t`Never reflected by a simulation. Run one to price this scenario.`
    : t`Values have changed, run a new CRQ simulation to update estimates.`;

  const items: Array<MissingDataItem> = [];

  if (noMappedAsset === true) {
    items.push({
      key: 'no-mapped-asset',
      labelKey: 'estate',
      label: t`Estate`,
      description: t`This risk scope is measured over the assets mapped into it and holds none. Map assets into it before pricing this scenario.`,
    });
  }

  if (missing.has('loss-drivers')) {
    items.push({
      key: 'loss-drivers',
      labelKey: 'loss-drivers',
      label: t`Financial Impact`,
      description: t`Fill in at least one loss driver estimate to compute the financial impact.`,
      action: {
        from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
        to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/financial-impact',
        text: t`Go to Financial Impact`,
      },
    });
  }
  if (missing.has('tef')) {
    items.push({
      key: 'tef',
      labelKey: 'tef',
      label: t`Threat Event Frequency`,
      description: t`Fill in a Threat Event Frequency to compute loss event frequency.`,
      action: {
        from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
        to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/threat',
        text: t`Go to Threat`,
      },
    });
  }
  if (whatIfStale) {
    items.push({
      key: 'what-if-stale',
      labelKey: 'controls',
      label: t`Controls`,
      description: t`Values have changed, run a new CRQ simulation to update estimates.`,
    });
  }
  if (outdated.has('loss-drivers')) {
    items.push({
      key: 'financial-stale',
      labelKey: 'loss-drivers',
      label: t`Financial Impact`,
      description: outdatedDescription,
    });
  }
  if (outdated.has('tef')) {
    items.push({
      key: 'tef-stale',
      labelKey: 'tef',
      label: t`Threat Event Frequency`,
      description: outdatedDescription,
    });
  }

  // Deduplicate by labelKey (first occurrence wins — missing-data items take priority over stale items)
  const seen = new Set<string>();
  return items.filter((item) => {
    if (currentLabel !== undefined && currentLabel !== item.labelKey) {
      return false;
    }
    if (seen.has(item.labelKey)) {
      return false;
    }
    seen.add(item.labelKey);
    return true;
  })
    .toSorted((a, b) => a.labelKey.localeCompare(b.labelKey))
    .map((item) => currentLabel === item.labelKey ? { ...item, action: undefined } : item);
};
