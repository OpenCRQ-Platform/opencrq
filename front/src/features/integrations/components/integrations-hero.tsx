import { Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Cable, Database, Gauge, Hourglass, Play, SatelliteDish, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { Fragment, useState } from 'react';
import type { RibbonValues } from '../connector-ribbon-utils';
import {
  advanceSampleWindow,
  buildRibbonValues,
  deriveIngestionRate,
  EMPTY_SAMPLE_WINDOW,
  isRibbonFlowing,
  shouldWarnNoWorker,
} from '../connector-ribbon-utils';
import { useTRPC } from '../../../lib';
import { useOptionalTenant } from '../../../providers';

const brandMix = (percent: number): string =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS color expression, not copy
  `color-mix(in srgb, var(--fds-color-filigran-brand-primary) ${percent}%, transparent)`;

const RibbonNode: FunctionComponent<{ icon: LucideIcon, value: string, label: string }> = ({ icon: NodeIcon, value, label }) => (
  <div className="flex max-w-28 shrink-0 flex-col items-center gap-1.5 text-center">
    <span
      aria-hidden
      className="flex size-11 items-center justify-center rounded-full border"
      style={{
        borderColor: brandMix(50),
        background: brandMix(6),
        boxShadow: `0 0 18px ${brandMix(35)}`,
        color: 'var(--fds-color-filigran-brand-primary)',
      }}
    >
      <NodeIcon className="size-[18px]" />
    </span>
    <Text as="span" variant="content-base-bold" className="leading-none tabular-nums">{value}</Text>
    <Text as="span" variant="content-compact" className="leading-tight text-default-secondary">{label}</Text>
  </div>
);

const RibbonLink: FunctionComponent<{ index: number, animated: boolean }> = ({ index, animated }) => (
  <div
    aria-hidden
    className="relative mx-3 mt-[22px] h-px min-w-6 flex-1"
    style={{ background: `linear-gradient(90deg, transparent, ${brandMix(35)}, transparent)` }}
  >
    {animated && (
      <span
        className="ribbon-flow-dot absolute top-1/2 size-[5px] -translate-y-1/2 rounded-full"
        style={{
          background: 'var(--fds-color-filigran-brand-primary)',
          boxShadow: `0 0 6px ${brandMix(55)}`,
          animationDelay: `${index * 0.45}s`,
        }}
      />
    )}
  </div>
);

/**
 * The live region is mounted whether or not it holds anything: a region inserted together with its
 * text is not reliably announced. `status` not `alert`, the banner arriving on a five-second poll:
 * an assertive region would interrupt a screen reader mid-sentence on every tick.
 */
const NoWorkerBanner: FunctionComponent<{ shown: boolean }> = ({ shown }) => (
  <div role="status">
    {shown && (
      <div
        className="mt-6 flex items-center gap-2.5 rounded-[var(--fds-radius-sm)] px-5 py-3"
        style={{ background: 'var(--fds-color-feedback-warning-secondary-transparency-30)' }}
      >
        <TriangleAlert className="size-[18px] shrink-0" style={{ color: 'var(--fds-color-feedback-warning-primary)' }} />
        <span className="font-content-base text-content-base">
          {t`No worker is answering. Queued runs will not advance.`}
        </span>
      </div>
    )}
  </div>
);

const useRibbonState = (): { values: RibbonValues, flowing: boolean, warnNoWorker: boolean } => {
  const trpc = useTRPC();
  const tenantContext = useOptionalTenant();
  const { data, dataUpdatedAt } = useQuery(trpc.connectors.getPipelineSnapshot.queryOptions(undefined, {
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
    enabled: !!tenantContext,
  }));
  const [sampleWindow, setSampleWindow] = useState(EMPTY_SAMPLE_WINDOW);
  // Guarded adjust-during-render on purpose (react.dev: storing information from previous renders).
  // Do not move this into an effect: `react-hooks/set-state-in-effect` rejects that form.
  if (data !== undefined && dataUpdatedAt > 0 && sampleWindow.current?.sampledAt !== dataUpdatedAt) {
    setSampleWindow(advanceSampleWindow(sampleWindow, { recordsIngested: data.recordsIngested, sampledAt: dataUpdatedAt }));
  }
  return {
    values: buildRibbonValues(data, deriveIngestionRate(sampleWindow)),
    flowing: isRibbonFlowing(data),
    warnNoWorker: shouldWarnNoWorker(data),
  };
};

export const IntegrationsHero: FunctionComponent = () => {
  const { values, flowing, warnNoWorker } = useRibbonState();
  const nodes: Array<{ icon: LucideIcon, value: string, label: string }> = [
    { icon: Cable, value: values.configuredConnectors, label: t`Configured connectors` },
    { icon: Hourglass, value: values.queuedRuns, label: t`Queued runs` },
    { icon: Play, value: values.runningNow, label: t`Running now` },
    { icon: Gauge, value: values.ingestionRate, label: t`Ingestion rate` },
    { icon: SatelliteDish, value: values.streamCatchup, label: t`Stream catch-up` },
    { icon: Database, value: values.recordsIngested, label: t`Records ingested` },
  ];
  return (
    // One element, so the empty live region below never claims a gap of the page's column.
    <div>
      <Paper elevation={1} className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h1>{t`Integrations`}</h1>
          <p className="text-default-secondary">{t`Configure and monitor the connectors feeding your platform.`}</p>
        </div>
        <div className="flex items-start px-2">
          {nodes.map((node, index) => (
            <Fragment key={node.label}>
              {index > 0 && <RibbonLink index={index - 1} animated={flowing} />}
              <RibbonNode icon={node.icon} value={node.value} label={node.label} />
            </Fragment>
          ))}
        </div>
      </Paper>
      <NoWorkerBanner shown={warnNoWorker} />
    </div>
  );
};
