import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { Button } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { Shield } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import type { IntensityStep, RepertoireActor, TechniqueGap, TtpReading, TtpRow, ValueTone } from '../scenario-ttp-utils';
import { DisplayDrawer, InfoTooltip, MetricInfo } from '../../../components/shared';
import { DataPageWithTtpMatrix } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { usePersistedView } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cn, formatDateTime, formatDollar, formatNumber } from '../../../utils';
import { createTechniqueColumn } from '../../mitre-attack/components';
import { useCrqSimulationOrchestrator } from '../use-crq-simulation-orchestrator';
import {
  buildTtpRows,
  formatShare,
  isUnplayedTechnique,
  shareOfExposure,
  TTP_READINGS,
  usageFillRatio,
  usageStep,
  valueFillRatio,
  valueTone,
} from '../scenario-ttp-utils';
import { WeighingRuleSentence } from './weighing-rule-sentence';
import { FigureFamilyDate } from './figure-family-date';
import { RunCrqButton } from './run-crq-button';
import { ScenarioMixturePendingNotice } from './scenario-mixture-pending-notice';

interface RiskScenarioForTtps {
  id: string,
  organizationId: string,
  attackOutcomeId: string,
  attackOutcome: { id: string, name: string },
}

interface RiskScenarioTtpsProps {
  riskScenario: RiskScenarioForTtps,
}

const TECHNIQUE_COLOR = 'blue';

/**
 * One hue at four opacities, not four hues: a share has a size but no verdict, so it gets no
 * semantic ramp. Mixing the brand primary toward transparent keeps the steps monotonic on either
 * ground, which a fixed palette ramp would not.
 */
/* eslint-disable lingui/no-unlocalized-strings -- CSS values, not copy */
const USAGE_ACCENT: Record<IntensityStep, string> = {
  1: 'color-mix(in srgb, var(--fds-color-filigran-brand-primary) 35%, transparent)',
  2: 'color-mix(in srgb, var(--fds-color-filigran-brand-primary) 55%, transparent)',
  3: 'color-mix(in srgb, var(--fds-color-filigran-brand-primary) 75%, transparent)',
  4: 'var(--fds-color-filigran-brand-primary)',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** Value carries a verdict, unlike usage, so it gets the feedback tokens rather than one hue. */
const VALUE_ACCENT: Record<ValueTone, string> = {
  benign: 'var(--fds-color-feedback-success-primary)',
  low: 'var(--fds-color-feedback-alert-primary)',
  medium: 'var(--fds-color-feedback-warning-primary)',
  high: 'var(--fds-color-feedback-error-primary)',
};

const gapExplanation = (gap: TechniqueGap): string =>
  (gap === 'estate'
    ? t`The estate holds no asset family this technique applies to, so the run had nothing to play it against.`
    : t`No catalogue control contests this technique, so removing it changes nothing the run can measure.`);

const gapLabel = (gap: TechniqueGap): string =>
  (gap === 'estate' ? t`estate gap` : t`catalogue gap`);

const unplayedLabel = (): string => t`not played`;

const unplayedExplanation = (): string =>
  t`The scenario's attack path gives this technique no step where it would count, so interdicting it changes nothing here.`;

/**
 * `undefined`, not null, from the accessor: `sortUndefined` is the only ordering TanStack applies
 * AFTER the direction flip, so a comparator of our own strands unpriced rows on top when sorted up.
 */
const amountColumn = (params: {
  id: string,
  header: string,
  size: number,
  valueOf: (row: TtpRow) => number | null,
  accentOf?: (value: number) => string,
}): ColumnDefWithOptionsHeader<TtpRow, unknown> => ({
  id: params.id,
  accessorFn: (row) => params.valueOf(row) ?? undefined,
  sortUndefined: 'last',
  header: params.header,
  size: params.size,
  cell: ({ row }) => {
    const value = params.valueOf(row.original);
    const unplayed = isUnplayedTechnique(row.original);
    return (
      <span
        className={cn('font-mono tabular-nums', unplayed && 'text-muted-foreground')}
        style={value === null || unplayed || params.accentOf === undefined ? undefined : { color: params.accentOf(value) }}
      >
        {formatDollar(value)}
      </span>
    );
  },
});

const ReadingToggle: FunctionComponent<{
  reading: TtpReading,
  onChange: (reading: TtpReading) => void,
  aside?: ReactNode,
}> = ({ reading, onChange, aside }) => {
  const label: Record<TtpReading, string> = { usage: t`Usage`, value: t`Value` };
  const hint: Record<TtpReading, string> = { usage: t`share of the threat`, value: t`$ / year` };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-label={t`Read the techniques by`} className="flex w-fit items-center gap-1 rounded-lg border p-0.5">
        {TTP_READINGS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === reading}
            onClick={() => onChange(key)}
            className={cn(
              'flex items-baseline gap-1.5 rounded-md px-2 py-1',
              key === reading ? 'bg-primary/20 text-primary' : 'hover:bg-hover',
            )}
          >
            <span className="txt-sub-content font-medium">{label[key]}</span>
            <span className="txt-mini text-muted-foreground">{hint[key]}</span>
          </button>
        ))}
      </div>
      {aside}
    </div>
  );
};

const DrawerFigure: FunctionComponent<{ label: string, value: ReactNode, hint: ReactNode }> = ({ label, value, hint }) => (
  <div className="flex flex-col gap-0.5">
    <span className="txt-sub-content text-muted-foreground">{label}</span>
    <span className="txt-subtitle2">{value}</span>
    <span className="txt-mini text-muted-foreground">{hint}</span>
  </div>
);

interface TechniqueDrawerProps {
  technique: TtpRow,
  actors: Array<RepertoireActor>,
  run: { createdAt: string | Date, iterations: number } | null,
  /** A null run means no run only once this is false, so the hint never claims one way too early. */
  isRunLoading: boolean,
  /** The annual loss exposure of the run that computed the technique values, which the value tone is read against. */
  exposure: number,
  riskScenarioId: string,
  onClose: () => void,
}

const TechniqueDrawer: FunctionComponent<TechniqueDrawerProps> = ({
  technique,
  actors,
  run,
  isRunLoading,
  exposure,
  riskScenarioId,
  onClose,
}) => {
  const weighingCount = actors.length;
  const playedByCount = plural(technique.sourceCount, {
    one: `# of the ${weighingCount} weighing threats plays it`,
    other: `# of the ${weighingCount} weighing threats play it`,
  });
  const runDate = run === null ? '' : formatDateTime(run.createdAt);
  const runWorlds = run === null ? '' : formatNumber(run.iterations);
  const runHint = run !== null
    ? t`Run of ${runDate}, ${runWorlds} worlds`
    : (isRunLoading ? '' : t`No run has priced this technique`);

  return (
    <DisplayDrawer title={`${technique.externalId} ${technique.name}`} open={true} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        {technique.tacticNames.length > 0 && (
          <span className="w-fit rounded-md border px-2 py-0.5 txt-sub-content text-muted-foreground">
            {technique.tacticNames.join(', ')}
          </span>
        )}

        <div className="grid grid-cols-2 gap-4">
          <DrawerFigure
            label={t`Share of the threat`}
            value={formatShare(technique.weight)}
            hint={playedByCount}
          />
          <DrawerFigure
            label={t`Value of interdicting`}
            value={technique.value === null
              ? <EmptyValue />
              : (
                <span style={isUnplayedTechnique(technique) ? undefined : { color: VALUE_ACCENT[valueTone(technique.value, exposure)] }}>
                  {formatDollar(technique.value)}
                </span>
              )}
            hint={technique.gap !== null && technique.value === null
              ? gapExplanation(technique.gap)
              : (isUnplayedTechnique(technique) ? unplayedExplanation() : runHint)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <p className="txt-category"><Trans>How the share is read</Trans></p>
          <p className="txt-sub-content text-muted-foreground">
            <WeighingRuleSentence />
            {' '}
            <Trans>Each receives a share of the threat from how likely it is to lead to the outcome, how closely its targeting matches this risk scope and how recent its activity is. A technique's share is the sum of the shares of the actors that play it. The shares are counted between the threats that weigh on the scenario, so they add up to 100% over the actors the catalogue could name rather than over the whole threat.</Trans>
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="txt-category"><Trans>How the value is read</Trans></p>
          <p className="txt-sub-content text-muted-foreground">
            <Trans>What the annual loss exposure drops by when the technique is still played but never succeeds, plus what it drops by when its detection is fully covered, on the same simulated worlds. Measured alone, never a sum with the other techniques.</Trans>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button priority="secondary" asChild>
            <Link
              from="/$tenantId/{-$organizationId}"
              to="settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
              params={{ techniqueExternalId: technique.externalId }}
            >
              <Trans>Open in ATT&CK</Trans>
            </Link>
          </Button>
          <Button priority="secondary" asChild>
            <Link
              from="/$tenantId/{-$organizationId}"
              to="risk-scenarios/$riskScenarioId/threat"
              params={{ riskScenarioId }}
            >
              <Trans>Relevant Threats</Trans>
            </Link>
          </Button>
        </div>
      </div>
    </DisplayDrawer>
  );
};

const EmptyPanel: FunctionComponent<{ title: ReactNode, hint: ReactNode, action?: ReactNode }> = ({ title, hint, action }) => (
  <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
    <Shield className="h-12 w-12 text-muted-foreground" />
    <div className="text-center">
      <p className="txt-subtitle2">{title}</p>
      <p className="txt-sub-content text-muted-foreground">{hint}</p>
    </div>
    {action}
  </div>
);

export const RiskScenarioTtps: FunctionComponent<RiskScenarioTtpsProps> = ({ riskScenario }) => {
  const trpc = useTRPC();
  const [drawerTechniqueId, setDrawerTechniqueId] = useState<string | null>(null);
  const { view: reading, setView: setReading } = usePersistedView<TtpReading>(
    'risk-scenario-ttps-reading',
    'usage',
    TTP_READINGS,
  );
  const { isRunning, isDisabled, onRun } = useCrqSimulationOrchestrator(riskScenario.id, { autoEnqueue: false });
  const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: riskScenario.organizationId }));

  const { data: repertoire, isPending: isRepertoireLoading } = useQuery(trpc.attackOutcomes.getRepertoireTechniquesForOutcome.queryOptions(
    { attackOutcomeId: riskScenario.attackOutcomeId, organizationId: riskScenario.organizationId },
  ));
  const { data: latestRun, isPending: isLatestRunPending } = useQuery(trpc.crqIndicators.getLatestRun.queryOptions(
    { riskScenarioId: riskScenario.id },
  ));
  const { data: runDetail, isPending: isRunDetailPending } = useQuery(trpc.crqIndicators.getRunWithScores.queryOptions(
    { runId: latestRun?.id ?? '' },
    { enabled: latestRun != null },
  ));
  // A disabled query stays pending for good, so the detail only counts as in flight once there is a
  // run to fetch.
  const isRunLoading = isLatestRunPending || (latestRun != null && isRunDetailPending);

  const rows = buildTtpRows({
    techniques: repertoire?.techniques ?? [],
    techniqueValues: runDetail?.techniqueWhatIfResults ?? [],
    reachGaps: runDetail?.reachGaps ?? [],
  });
  // Read by id rather than held as the row captured on click: a run landing while the drawer is
  // open moves its value with the rest of the panel, instead of leaving the amount and the run it
  // is measured against disagreeing until the drawer is reopened.
  const drawerTechnique = rows.find((row) => row.id === drawerTechniqueId) ?? null;
  const actors = repertoire?.actors ?? [];
  const unplayedCuratedCount = repertoire?.unplayedCuratedCount ?? 0;
  const pricedCount = rows.filter((row) => row.value !== null).length;
  const hasPricedRun = pricedCount > 0;
  // A price run computes no technique values, so they may come from an older run and read against
  // that run's exposure. Only rows predating the column fall through to 0, and those read benign,
  // which understates rather than raising an alarm the figures cannot support.
  const run = runDetail?.techniqueSource ?? null;
  const exposure = run?.aleMean ?? 0;

  const outcomeLink = (
    <Link
      from="/$tenantId/{-$organizationId}"
      to="settings/taxonomies/attack-outcomes/$attackOutcomeId"
      params={{ attackOutcomeId: riskScenario.attackOutcome.id }}
      className="font-medium text-primary hover:underline"
    >
      {riskScenario.attackOutcome.name}
    </Link>
  );

  const readingToggle = (aside?: ReactNode) => <ReadingToggle reading={reading} onChange={setReading} aside={aside} />;

  if (repertoire?.evidenceMode === 'mixture-pending') {
    return (
      <div className="flex flex-col gap-4">
        {readingToggle()}
        <ScenarioMixturePendingNotice />
      </div>
    );
  }

  // Never while the repertoire is still on the wire: an empty set and an unanswered query look the
  // same here, and this panel makes a claim about the scenario's threat rather than about the page.
  if (rows.length === 0 && !isRepertoireLoading) {
    // A technique is kept only when the catalogue knows it, so a weighing threat whose repertoire
    // is empty or unknown to ATT&CK leaves no row while still weighing on the scenario.
    const hasWeighingThreats = actors.length > 0;
    return (
      <div className="flex flex-col gap-4">
        {readingToggle()}
        <EmptyPanel
          title={hasWeighingThreats
            ? <Trans>The threats that weigh on this scenario carry no known technique</Trans>
            : <Trans>No threat weighs on this scenario</Trans>}
          hint={hasWeighingThreats
            ? (
              <Trans>
                The threats that weigh on {outcomeLink} have no technique on record in the ATT&CK catalogue, so neither reading has anything to show.
              </Trans>
            )
            : (
              <Trans>
                The techniques read here are the repertoires of the threats that weigh on this scenario, and none weighs on {outcomeLink}.
              </Trans>
            )}
        />
      </div>
    );
  }

  // Answered ahead of the run: a scenario priced before its scope was emptied still carries
  // values, and showing them would contradict every other surface, which reads it as unpriced.
  const estateRetired = scope?.noMappedAsset === true;
  // `hasPricedRun` is read off the joined rows, so it is false while EITHER query is in flight.
  if (reading === 'value' && !isRepertoireLoading && (estateRetired || (!hasPricedRun && !isRunLoading))) {
    return (
      <div className="flex flex-col gap-4">
        {readingToggle()}
        <EmptyPanel
          title={estateRetired
            ? <Trans>Not priced: the scope maps no asset</Trans>
            : <Trans>No run has priced these techniques yet</Trans>}
          hint={estateRetired
            ? <Trans>What interdicting a technique is worth comes from a CRQ run, and this scenario's scope maps no asset to price it over. Map assets to it to run one.</Trans>
            : <Trans>What interdicting a technique is worth comes from a CRQ run. Until one has priced them, this reading has nothing to show.</Trans>}
          action={(
            <RunCrqButton
              isRunning={isRunning}
              // A scope that has not answered may be one mapping nothing, whose run the engine
              // would skip without writing a row.
              isDisabled={isDisabled || scope == null || scope.noMappedAsset}
              onRun={onRun}
            />
          )}
        />
      </div>
    );
  }

  const shareLabel = t`Share of the threat`;
  const valueLabel = t`Value of interdicting`;
  const preventLabel = t`By preventing it`;
  const detectLabel = t`By detecting it`;
  const exposureShareLabel = t`Share of the annual loss exposure`;
  const notPricedLabel = t`Not priced`;

  // One table for both readings: the two figures answer different questions about the same
  // technique and the reader compares them row by row.
  const columns: Array<ColumnDefWithOptionsHeader<TtpRow, unknown>> = [
    createTechniqueColumn<TtpRow>(),
    ...(hasPricedRun
      ? [
        amountColumn({ id: 'prevent', header: preventLabel, size: 120, valueOf: (row) => row.preventValue }),
        amountColumn({ id: 'detect', header: detectLabel, size: 120, valueOf: (row) => row.detectValue }),
        // The same tone the matrix paints the cell with, so the two views never disagree on what a
        // figure means.
        amountColumn({
          id: 'value',
          header: valueLabel,
          size: 140,
          valueOf: (row) => row.value,
          accentOf: (value) => VALUE_ACCENT[valueTone(value, exposure)],
        }),
        {
          id: 'why',
          accessorFn: (row: TtpRow) => row.gap ?? (isUnplayedTechnique(row) ? unplayedLabel() : ''),
          header: t`Why`,
          size: 130,
          cell: ({ row }: { row: { original: TtpRow } }) => {
            const reason = row.original.value === null && row.original.gap !== null
              ? { label: gapLabel(row.original.gap), explanation: gapExplanation(row.original.gap) }
              : (isUnplayedTechnique(row.original) ? { label: unplayedLabel(), explanation: unplayedExplanation() } : null);
            if (reason === null) {
              return null;
            }
            return (
              <span className="inline-flex items-center gap-1">
                <span className="txt-sub-content text-muted-foreground">{reason.label}</span>
                <InfoTooltip label={reason.label}>{reason.explanation}</InfoTooltip>
              </span>
            );
          },
        } satisfies ColumnDefWithOptionsHeader<TtpRow, unknown>,
      ]
      : []),
    {
      id: 'weight',
      accessorKey: 'weight',
      header: t`Share`,
      size: 90,
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{formatShare(row.original.weight)}</span>
      ),
    },
  ];

  const highlightedTechniques: Array<HighlightedTechnique> = rows.map((row) => {
    const openDrawer = ({ className, children }: { className: string, children: ReactNode }) => (
      <button type="button" className={cn(className, 'text-left')} onClick={() => setDrawerTechniqueId(row.id)}>
        {children}
      </button>
    );
    if (reading === 'usage') {
      return {
        id: row.id,
        color: TECHNIQUE_COLOR,
        accent: USAGE_ACCENT[usageStep(row.weight)],
        categoryLabel: `${shareLabel}: ${formatShare(row.weight)}`,
        marker: formatShare(row.weight),
        fill: { ratio: usageFillRatio(row.weight), tone: 'default' as const },
        renderLink: openDrawer,
      };
    }
    const unplayed = isUnplayedTechnique(row);
    const ratio = unplayed ? null : valueFillRatio(row.value, exposure);
    const share = row.value === null ? null : shareOfExposure(row.value, exposure);
    const levers = row.value === null || unplayed
      ? []
      : [
        { label: preventLabel, value: formatDollar(row.preventValue) },
        { label: detectLabel, value: formatDollar(row.detectValue) },
        ...(share === null ? [] : [{ label: exposureShareLabel, value: formatShare(share) }]),
      ];
    return {
      id: row.id,
      color: TECHNIQUE_COLOR,
      accent: row.value === null || unplayed ? undefined : VALUE_ACCENT[valueTone(row.value, exposure)],
      categoryLabel: row.value === null ? notPricedLabel : `${valueLabel}: ${formatDollar(row.value)}`,
      marker: row.value === null && row.gap !== null
        ? `${notPricedLabel} · ${gapLabel(row.gap)}`
        : formatDollar(row.value),
      fill: ratio === null ? undefined : { ratio, tone: 'default' as const },
      outlined: row.value === null || unplayed,
      tooltipExtra: [
        ...(row.value === null && row.gap !== null ? [{ label: gapLabel(row.gap), value: gapExplanation(row.gap) }] : []),
        ...(unplayed ? [{ label: unplayedLabel(), value: unplayedExplanation() }] : []),
        ...levers,
      ],
      renderLink: openDrawer,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      {readingToggle(reading === 'value' ? <FigureFamilyDate riskScenarioId={riskScenario.id} family="techniques" /> : undefined)}
      <DataPageWithTtpMatrix
        data={rows}
        columns={columns}
        storageKey="risk-scenario-ttps"
        sortingStorageKey={`risk-scenario-ttps-${reading}`}
        highlightedTechniques={highlightedTechniques}
        defaultColor={TECHNIQUE_COLOR}
        isLoading={isRepertoireLoading || (reading === 'value' && isRunLoading)}
        leftHeaderContent={
          <div className="flex flex-col gap-1">
            <div className="flex items-start gap-1.5">
              <p className="txt-sub-content text-muted-foreground">
                {reading === 'usage'
                  ? <Trans>Every technique the threats that weigh on {outcomeLink} are known to use, weighted by the share of them that use it.</Trans>
                  : <Trans>Every technique the threats that weigh on {outcomeLink} are known to use, priced by what interdicting it would take off this scenario's annual loss exposure.</Trans>}
              </p>
              {reading === 'usage'
                ? (
                  <MetricInfo
                    className="mt-0.5"
                    title={shareLabel}
                    what={<Trans>Every technique the threats that weigh on this scenario are known to use, and the share of the threat that plays each one.</Trans>}
                    how={<Trans>The threats that weigh on the scenario are those of the Threat tab, and their repertoires come from the ATT&CK catalogue. Each threat weighs by its place in this scenario, and a technique receives the sum of the shares of the threats that play it.</Trans>}
                    caveat={<Trans>The shares are counted between the threats that weigh on the scenario. No intelligence knows every group there is: a technique at 100% is played by every threat the catalogue could name, not by the whole threat.</Trans>}
                  />
                )
                : (
                  <MetricInfo
                    className="mt-0.5"
                    title={valueLabel}
                    what={<Trans>What this scenario would stop costing each year if the technique were interdicted.</Trans>}
                    how={<Trans>The scenario is re-evaluated on the same simulated worlds, once with the technique still played but never succeeding, once with its detection fully covered by the controls. The amount adds the two levers, and each technique shows them apart.</Trans>}
                    caveat={<Trans>A ceiling, not a promise: it assumes a control that works every time, which none does, so it ranks what is worth treating rather than announcing a gain. Techniques overlap, so the amounts do not add up across techniques.</Trans>}
                  />
                )}
            </div>
            {unplayedCuratedCount > 0 && (
              <p className="txt-sub-content text-muted-foreground">
                <Plural
                  value={unplayedCuratedCount}
                  one="# technique curated on the outcome is played by no threat that weighs on this scenario."
                  other="# techniques curated on the outcome are played by no threat that weighs on this scenario."
                />
                {' '}
                <Trans>Review them on {outcomeLink}.</Trans>
              </p>
            )}
          </div>
        }
        matrixFooter={reading === 'value'
          ? (
            <p className="txt-sub-content text-muted-foreground">
              <Trans>Each contribution is measured on its own, by re-evaluating the scenario with that technique interdicted. They are not a sum: adding them up does not give the scenario's exposure.</Trans>
            </p>
          )
          : undefined}
        onClickRow={(row) => setDrawerTechniqueId(row.original.id)}
        initialSorting={reading === 'usage' ? [{ id: 'weight', desc: true }] : [{ id: 'value', desc: true }]}
      />
      {drawerTechnique && (
        <TechniqueDrawer
          technique={drawerTechnique}
          actors={actors}
          run={run}
          isRunLoading={isRunLoading}
          exposure={exposure}
          riskScenarioId={riskScenario.id}
          onClose={() => setDrawerTechniqueId(null)}
        />
      )}
    </div>
  );
};
