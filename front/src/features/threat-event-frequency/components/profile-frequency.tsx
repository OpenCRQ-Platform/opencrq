import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { Button, Chip, Icon, Paper } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import type { ProfileLabels, ProfileNotes, ScenarioTefGap, ScopeScenarioTef, TefOutcomeReading, TefRange, TefReading } from '../threat-event-frequency-utils';
import { InfoTooltip, SectionCard, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useOpenScopeDrawer } from '../../organizations';
import { cn } from '../../../utils';
import { formatNumber } from '../../../utils/format-number';
import { profileNotes, RANGE_SCALE_DECADES, rangePercent, scenarioTefGap } from '../threat-event-frequency-utils';
import { countryNoteText, formatAttempts, formatRange, recurrenceText, sectorNoteText, sizeNoteText, unsetPartText } from './frequency-labels';

const RangeBar: FunctionComponent<TefRange> = ({ low, likely, high }) => (
  <span aria-hidden="true" className="flex flex-col gap-1">
    <span className="relative block h-2.5 rounded-full bg-[var(--fds-bg-elevation-highlight)]">
      <span
        className="absolute inset-y-0 rounded-full bg-[color-mix(in_srgb,var(--fds-color-filigran-brand-primary)_35%,transparent)]"
        style={{ left: `${rangePercent(low)}%`, width: `${rangePercent(high) - rangePercent(low)}%` }}
      />
      <span className="absolute -inset-y-1 w-0.5 rounded-full bg-filigran-brand-primary" style={{ left: `${rangePercent(likely)}%` }} />
    </span>
    <span className="flex justify-between txt-mini text-muted-foreground">
      {RANGE_SCALE_DECADES.map((decade) => <span key={decade}>{formatNumber(decade)}</span>)}
    </span>
  </span>
);

interface ProfileChipProps {
  label: string,
  /** Why the figure does not measure this part of the profile, `null` when it does. */
  note: string | null,
}

/**
 * A part of the profile, in the alert tone with its reason when the catalogue does not measure it. The
 * tooltip names the part too, since a narrow cell cuts the chip's label short. A click opens the
 * tooltip on a touch screen, so it stops there rather than open the table row the chip sits in.
 */
export const ProfileChip: FunctionComponent<ProfileChipProps> = ({ label, note }) => {
  if (note === null) {
    return <Chip label={label} />;
  }
  return (
    <TooltipHint hint={<><span className="block font-medium">{label}</span>{note}</>}>
      <button type="button" aria-label={`${label}. ${note}`} onClick={(event) => event.stopPropagation()} className="inline-flex min-w-0 max-w-full cursor-help rounded-[var(--fds-radius-sm)] focus-visible:outline-none focus-visible:ring-2 ring-focus">
        <Chip severity="medium" label={label} startIcon={<Icon name="info" size={16} />} className="min-w-0 max-w-full" />
      </button>
    </TooltipHint>
  );
};

const noteTexts = (notes: ProfileNotes): Record<keyof ProfileNotes, string | null> => ({
  country: notes.country === null ? null : countryNoteText(notes.country),
  sector: notes.sector === null ? null : sectorNoteText(notes.sector),
  size: notes.size === null ? null : sizeNoteText(notes.size),
});

/** The profile's three parts in a row, each chip in the alert tone where the catalogue does not measure it. */
export const ProfileChips: FunctionComponent<{ labels: ProfileLabels, notes: ProfileNotes }> = ({ labels, notes }) => {
  const texts = noteTexts(notes);
  return (
    <TooltipHintProvider>
      <ProfileChip label={labels.country ?? unsetPartText('country')} note={texts.country} />
      <ProfileChip label={labels.sector ?? unsetPartText('sector')} note={texts.sector} />
      <ProfileChip label={labels.size ?? unsetPartText('size')} note={texts.size} />
    </TooltipHintProvider>
  );
};

const Panel: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <Paper elevation={2} padding={16} className="flex min-w-0 flex-col gap-2.5">
    {children}
  </Paper>
);

const PanelTitle: FunctionComponent<{ children: ReactNode, hint: string, hintLabel: string }> = ({ children, hint, hintLabel }) => (
  <span className="flex items-center gap-1 txt-sub-content text-muted-foreground">
    {children}
    <InfoTooltip label={hintLabel}>{hint}</InfoTooltip>
  </span>
);

const ProfileField: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2">
    <span className="flex min-h-7 items-center txt-sub-content text-muted-foreground">{label}</span>
    <span className="flex min-h-7 flex-wrap items-center gap-1">{children}</span>
  </div>
);

interface ProfileCardProps {
  total: TefRange,
  labels: ProfileLabels,
  notes: ProfileNotes,
  /** Absent for a simulated profile, which no risk scope drawer can fill in. */
  scopeId: string | undefined,
  hasEmployeeCount: boolean,
}

const ProfileCard: FunctionComponent<ProfileCardProps> = ({ total, labels, notes, scopeId, hasEmployeeCount }) => {
  const openScopeDrawer = useOpenScopeDrawer();
  const attempts = formatAttempts(total.likely);
  const totalRecurrence = recurrenceText(total.likely);
  const range = formatRange(total.low, total.high);
  const texts = noteTexts(notes);
  return (
    <SectionCard title={t`Profile`}>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-[minmax(0,1fr)]">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 max-md:grid-cols-[minmax(0,1fr)]">
          <Panel>
            <PanelTitle hintLabel={t`How this number is built`} hint={t`The sum of the most likely values of the attack outcomes below.`}>
              {t`Attack attempts per year`}
            </PanelTitle>
            <span className="txt-jumbo font-medium leading-none text-filigran-brand-primary">{attempts}</span>
            {totalRecurrence !== undefined && <span className="text-muted-foreground">{totalRecurrence}</span>}
          </Panel>
          <Panel>
            <PanelTitle hintLabel={t`What the range covers`} hint={t`From the sum of the attack outcomes' minimums to the sum of their maximums.`}>
              {t`Range`}
            </PanelTitle>
            <span className="flex items-baseline gap-2">
              <span className="txt-title font-mono tabular-nums">{range}</span>
              <span className="text-muted-foreground">{t`per year`}</span>
            </span>
            <span className="mt-1.5"><RangeBar {...total} /></span>
          </Panel>
        </div>
        <Panel>
          <TooltipHintProvider>
            <ProfileField label={t`Country`}>
              <ProfileChip label={labels.country ?? unsetPartText('country')} note={texts.country} />
            </ProfileField>
            <ProfileField label={t`Sector`}>
              <ProfileChip label={labels.sector ?? unsetPartText('sector')} note={texts.sector} />
            </ProfileField>
            <ProfileField label={t`Size`}>
              <ProfileChip label={labels.size ?? unsetPartText('size')} note={texts.size} />
              {scopeId !== undefined && !hasEmployeeCount && (
                <Button priority="tertiary" onClick={() => openScopeDrawer(scopeId, 'edit')}>{t`Fill in the employee count`}</Button>
              )}
            </ProfileField>
          </TooltipHintProvider>
        </Panel>
      </div>
    </SectionCard>
  );
};

interface FrequencyScope {
  id: string,
  scenarios: ReadonlyArray<ScopeScenarioTef>,
  highlightedOutcomeId: string | undefined,
}

interface OutcomeTableRow extends TefOutcomeReading {
  id: string,
  scenarios: Array<ScopeScenarioTef>,
}

const gapText = (scenario: ScopeScenarioTef & { likely: number }, gap: ScenarioTefGap): string => {
  const { name } = scenario;
  const likely = formatAttempts(scenario.likely);
  return gap === 'manual'
    ? i18n._({ id: '{name}: typed by hand, {likely} per year', message: '{name}: typed by hand, {likely} per year', values: { name, likely } })
    : i18n._({ id: '{name}: estimated before the latest change, {likely} per year', message: '{name}: estimated before the latest change, {likely} per year', values: { name, likely } });
};

const ScenariosCell: FunctionComponent<{ row: OutcomeTableRow, scopeId: string }> = ({ row, scopeId }) => {
  const { scenarios, read } = row;
  if (scenarios.length === 0) {
    return <span className="block truncate text-muted-foreground">{t`None`}</span>;
  }
  const gaps = scenarios.flatMap((scenario) => {
    const gap = scenarioTefGap(scenario, read);
    return gap === null || scenario.likely === null ? [] : [{ gap, text: gapText({ ...scenario, likely: scenario.likely }, gap) }];
  });
  const [only] = scenarios;
  const catalog = formatAttempts(read.likely);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {scenarios.length === 1 && only !== undefined
        ? (
          <Link
            to="/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/threat"
            params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: scopeId, riskScenarioId: only.id })}
            className="truncate hover:underline"
          >
            {only.name}
          </Link>
        )
        : (
          <Link
            to="/$tenantId/{-$organizationId}/risk-scenarios"
            params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: scopeId })}
            className="truncate hover:underline"
          >
            {plural(scenarios.length, { one: '# risk scenario', other: '# risk scenarios' })}
          </Link>
        )}
      {gaps.length > 0 && (
        <span
          className="shrink-0"
          title={[i18n._({ id: 'The catalog gives {catalog} per year.', message: 'The catalog gives {catalog} per year.', values: { catalog } }), ...gaps.map((entry) => entry.text)].join('\n')}
        >
          <Chip severity="medium" label={gaps.some((entry) => entry.gap === 'manual') ? t`Manual` : t`To recompute`} />
        </span>
      )}
    </span>
  );
};

interface OutcomesSectionProps {
  reading: TefReading,
  scope: FrequencyScope | undefined,
}

const OutcomesSection: FunctionComponent<OutcomesSectionProps> = ({ reading, scope }) => {
  const rows: Array<OutcomeTableRow> = reading.outcomes.map((outcome) => ({
    ...outcome,
    id: outcome.attackOutcomeId,
    scenarios: scope?.scenarios.filter((scenario) => scenario.attackOutcomeId === outcome.attackOutcomeId) ?? [],
  }));
  const columns: Array<ColumnDefWithOptionsHeader<OutcomeTableRow, unknown>> = [
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: t`Attack outcome`,
      size: 220,
      cell: ({ row }): ReactElement => {
        const highlighted = scope !== undefined && row.original.attackOutcomeId === scope.highlightedOutcomeId;
        return (
          <span aria-current={highlighted ? 'true' : undefined} className={cn('block truncate', highlighted && 'font-medium text-filigran-brand-primary')}>
            {row.original.name}
          </span>
        );
      },
    },
    {
      id: 'attempts',
      accessorFn: (row) => row.read.likely,
      header: t`Attempts per year`,
      size: 140,
      cell: ({ row }): ReactElement => <span className="block text-right font-mono tabular-nums">{formatAttempts(row.original.read.likely)}</span>,
    },
    {
      id: 'range',
      accessorFn: (row) => row.read.high,
      header: t`Range`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <span className="block whitespace-nowrap text-right font-mono tabular-nums text-muted-foreground">
          {formatRange(row.original.read.low, row.original.read.high)}
        </span>
      ),
    },
    {
      id: 'recurrence',
      accessorFn: (row) => row.read.likely,
      header: t`Recurrence`,
      size: 230,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="block truncate">{recurrenceText(row.original.read.likely)}</span>,
    },
    ...(scope === undefined
      ? []
      : [{
        id: 'scenarios',
        accessorFn: (row) => row.scenarios.length,
        header: t`Risk Scenarios`,
        size: 240,
        cell: ({ row }): ReactElement => <ScenariosCell row={row.original} scopeId={scope.id} />,
      } satisfies ColumnDefWithOptionsHeader<OutcomeTableRow, unknown>]),
  ];
  return (
    <SectionCard title={t`Attack outcomes`}>
      {rows.length === 0
        ? <p className="txt-sub-content text-muted-foreground"><Trans>No attack outcome to show.</Trans></p>
        : (
          <div className="flex flex-col gap-4">
            <DataPageLayout
              data={rows}
              columns={columns}
              storageKey="threat-event-frequency-outcomes"
              search={{ placeholder: t`Search attack outcomes...`, texts: (outcome) => [outcome.name] }}
              initialSorting={[{ id: 'attempts', desc: true }]}
            />
            <p className="txt-sub-content text-muted-foreground">
              <Trans>An attempt is an attack carried out, whether it succeeds or not.</Trans>
            </p>
          </div>
        )}
    </SectionCard>
  );
};

interface ProfileFrequencyProps {
  reading: TefReading,
  labels: ProfileLabels,
  hasEmployeeCount: boolean,
  /** Absent for a profile the simulator holds. */
  scope?: FrequencyScope,
}

export const ProfileFrequency: FunctionComponent<ProfileFrequencyProps> = ({ reading, labels, hasEmployeeCount, scope }): ReactNode => (
  <>
    <ProfileCard
      total={reading.total}
      labels={labels}
      notes={profileNotes(reading.outcomes.map(({ read }) => read))}
      scopeId={scope?.id}
      hasEmployeeCount={hasEmployeeCount}
    />
    <OutcomesSection reading={reading} scope={scope} />
  </>
);
