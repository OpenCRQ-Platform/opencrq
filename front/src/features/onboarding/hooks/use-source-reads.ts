import type { ConnectorSource, FinancialProfileProgress, ThreatSourceKind } from '@app/module/client';
import { computeProgress, DECLARED_ESTATE_KIND_VALUES, EMPTY_FINANCIAL_PROFILE_ANSWERS } from '@app/module/client';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { OnboardingStepKey } from '../onboarding-steps';
import type { OnboardingWizard, StepProgressCount, StepSyncReads, StepSyncSource } from '../onboarding-utils';
import { useTRPC } from '../../../lib';
import { countAssessed } from '../defenses-utils';

/** A threat source's own threats; undefined while it loads. */
export const useThreatCount = (kind: ThreatSourceKind, enabled = true): number | undefined => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.threats.list.queryOptions({ page: 1, limit: 1, kind }, { enabled }));
  return data?.total;
};

/**
 * The tenant's whole threat count, undefined while it loads, and whether OpenCTI left the reader's scope
 * unresolved, so the counts may lack threats.
 */
export const useTenantThreats = (): { total: number | undefined, readerScopeUnresolved: boolean } => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.threats.list.queryOptions({ page: 1, limit: 1, kind: undefined }));
  return { total: data?.total, readerScopeUnresolved: data?.readerScopeUnresolved ?? false };
};

/** An asset source's own assets, or the tenant's whole count without a source; undefined while it loads. */
export const useAssetCount = (source?: 'microsoft_graph' | 'user', enabled = true): number | undefined => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.supportingAssets.listSupportingAssets.queryOptions({ page: 1, limit: 1, source }, { enabled }));
  return data?.total;
};

/** How many kinds of asset the scope declared an order of magnitude for; undefined while it loads. */
export const useDeclaredEstateKindCount = (organizationId: string, enabled = true): number | undefined => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.declaredEstate.get.queryOptions({ organizationId }, { enabled }));
  return data?.filter((row) => row.bounds !== null).length;
};

/** The control catalogue with the tenant's assessment of each control; undefined while it loads. */
export const useControlCapabilities = (enabled = true) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.controlCapabilities.getControlCapabilities.queryOptions(undefined, { enabled }));
  return data;
};

/** How many questions of the scope's financial profile are answered; undefined while it loads. */
export const useFinancialProfileProgress = (organizationId: string, enabled = true): FinancialProfileProgress | undefined => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.financialProfiles.getFinancialProfile.queryOptions({ organizationId }, { enabled }));
  return data === undefined ? undefined : computeProgress(data ?? EMPTY_FINANCIAL_PROFILE_ANSWERS);
};

/**
 * How far each started step is, by the figure its own page shows. A step appears once its read has landed,
 * and the reads only run while the step is started.
 */
export const useStepProgress = (wizard: OnboardingWizard | null | undefined): Partial<Record<OnboardingStepKey, StepProgressCount>> => {
  const organizationId = wizard?.organizationId ?? '';
  const financesStarted = wizard?.steps.finances === 'started';
  const defensesStarted = wizard?.steps.defenses === 'started';
  const assetsStarted = wizard?.steps.assets === 'started';
  const finances = useFinancialProfileProgress(organizationId, financesStarted);
  const capabilities = useControlCapabilities(defensesStarted);
  const declaredKinds = useDeclaredEstateKindCount(organizationId, assetsStarted);

  return {
    ...(financesStarted && finances !== undefined && { finances: { done: finances.answeredCount, total: finances.totalCount } }),
    ...(defensesStarted && capabilities !== undefined && { defenses: { done: countAssessed(capabilities), total: capabilities.length } }),
    ...(assetsStarted && declaredKinds !== undefined && { assets: { done: declaredKinds, total: DECLARED_ESTATE_KIND_VALUES.length } }),
  };
};

/** One connector's card of the Integrations list: its state, its switch and the run that is going. */
export const useConnectorCard = (source: ConnectorSource) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.connectors.listConnectors.queryOptions(undefined, {
    select: (connectors) => connectors.find((connector) => connector.source === source),
  }));
  return data;
};

/** What a source has delivered so far: the same reads as its tile, so the two never disagree. */
export const useImportedCount = (source: StepSyncSource): number | undefined => {
  const threatKind = source === 'opencti' ? 'connector' : 'default-threats';
  const threats = useThreatCount(threatKind, source !== 'microsoft_graph');
  const assets = useAssetCount('microsoft_graph', source === 'microsoft_graph');
  return source === 'microsoft_graph' ? assets : threats;
};

/** The connectors and the OpenCTI stream a step's import can run behind. */
export const useStepSyncReads = (): StepSyncReads => {
  const trpc = useTRPC();
  const defender = useConnectorCard('microsoft_graph');
  const opencti = useConnectorCard('opencti');
  const defaultThreats = useConnectorCard('default_threats');
  const { data: backfill } = useQuery(trpc.opencti.getBackfillProgress.queryOptions());
  return { defender, opencti, defaultThreats, backfill };
};

/** Per outcome id, the categories the outcome reaches; undefined until every outcome's read has landed. */
export const useCompatibleCategoryIds = (outcomeIds: ReadonlyArray<string>): Record<string, ReadonlyArray<string>> | undefined => {
  const trpc = useTRPC();
  const reads = useQueries({
    queries: outcomeIds.map((attackOutcomeId) => trpc.lossDrivers.getCompatibleBusinessValueCategoryIds.queryOptions({ attackOutcomeId })),
  });
  if (reads.some((read) => read.data === undefined)) {
    return undefined;
  }
  return Object.fromEntries(outcomeIds.map((id, index) => [id, reads[index]?.data ?? []]));
};
