import { Button } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TEF_SIZE_CLASSES } from '@app/module/client';
import { compareText } from '@app/utils/text-fold';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { ScopeIdentity, SizeChoice, TefCatalog } from '../threat-event-frequency-utils';
import { SectionCard, SingleSelectField } from '../../../components/shared';
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { RevenueBandSelect } from '../../organizations';
import { threatEventFrequencyListSearchSchema } from '../threat-event-frequency-list-search';
import { choicesFor, sameProfile, simulatedProfile, sizeChoiceOf, startingProfile } from '../threat-event-frequency-utils';
import { profileLabels, sizeClassRange } from './frequency-labels';
import { ProfileFrequency } from './profile-frequency';

interface ProfileSimulatorProps {
  catalog: TefCatalog,
  scopes: ReadonlyArray<ScopeIdentity>,
}

interface PlainSelectProps<Value extends string> {
  label: string,
  /** `null` shows the placeholder: a part the starting scope leaves unset. */
  value: Value | null,
  placeholder?: string,
  options: ReadonlyArray<{ value: Value, label: string }>,
  onChange: (value: Value) => void,
}

const PlainSelect = <Value extends string>({ label, value, placeholder, options, onChange }: PlainSelectProps<Value>) => (
  <div className="flex flex-col">
    <Select
      value={value ?? ''}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option !== undefined) {
          onChange(option.value);
        }
      }}
    >
      <SelectLabel>{label}</SelectLabel>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
);

export const ProfileSimulator: FunctionComponent<ProfileSimulatorProps> = ({ catalog, scopes }) => {
  const trpc = useTRPC();
  const { filters, setFilters } = useUrlListFilters(threatEventFrequencyListSearchSchema);
  const from = scopes.find((scope) => scope.id === filters.from);
  const start = startingProfile(catalog, from);
  const profile = simulatedProfile(catalog, filters, start);
  const size = sizeChoiceOf(profile);
  const { data: reading, isError } = useQuery(trpc.crqIndicators.getTefCatalogReading.queryOptions(profile));
  const fromName = from?.name;
  const backLabel = fromName === undefined
    ? t`Back to the default profile`
    : i18n._({ id: 'Back to the profile of {fromName}', message: 'Back to the profile of {fromName}', values: { fromName } });
  const sizeOptions: Array<{ value: SizeChoice, label: string }> = [
    ...TEF_SIZE_CLASSES.map((sizeClass) => ({ value: sizeClass, label: sizeClassRange(sizeClass) })),
    { value: 'unknown', label: t`Unknown` },
  ];

  return (
    <>
      <SectionCard title={t`Simulated profile`}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid min-w-0 flex-[1_1_44rem] grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] items-end gap-4">
            <SingleSelectField
              label={t`Start from a risk scope`}
              options={scopes.map((scope) => ({ value: scope.id, label: scope.name })).toSorted((a, b) => compareText(a.label, b.label))}
              value={from?.id ?? null}
              onChange={(scopeId) => setFilters(scopeId === null
                // Leaving the scope keeps the parts it sets. One it leaves unset takes the default's, since
                // the simulator's own fields cannot hold an unset country or sector.
                ? { from: undefined, ...choicesFor(profile, startingProfile(catalog, undefined)) }
                : { from: scopeId, countryId: undefined, sectorId: undefined, size: undefined, revenueBand: undefined })}
              placeholder={t`None`}
              emptyMessage={t`No risk scope found`}
            />
            <SingleSelectField
              label={t`Country`}
              options={catalog.countries.map((country) => ({ value: country.id, label: country.name })).toSorted((a, b) => compareText(a.label, b.label))}
              value={profile.countryId}
              onChange={(countryId) => countryId !== null && setFilters({ countryId: countryId === start.countryId ? undefined : countryId })}
              clearable={false}
              placeholder={t`Select a country`}
              emptyMessage={t`No country found`}
            />
            <SingleSelectField
              label={t`Sector`}
              options={catalog.sectors.map((sector) => ({ value: sector.id, label: sector.name })).toSorted((a, b) => compareText(a.label, b.label))}
              value={profile.sectorId}
              onChange={(sectorId) => sectorId !== null && setFilters({ sectorId: sectorId === start.sectorId ? undefined : sectorId })}
              clearable={false}
              placeholder={t`Select a sector`}
              emptyMessage={t`No sector found`}
            />
            <PlainSelect
              label={t`Number of employees`}
              value={size}
              options={sizeOptions}
              onChange={(next) => setFilters({ size: next === sizeChoiceOf(start) ? undefined : next })}
            />
            {size === 'unknown' && (
              <RevenueBandSelect
                label={t`Revenue band`}
                value={profile.revenueBand}
                onValueChange={(revenueBand) => setFilters({ revenueBand: revenueBand === start.revenueBand ? undefined : revenueBand ?? undefined })}
              />
            )}
          </div>
          <Button
            priority="secondary"
            disabled={sameProfile(profile, start)}
            onClick={() => setFilters({ countryId: undefined, sectorId: undefined, size: undefined, revenueBand: undefined })}
          >
            {backLabel}
          </Button>
        </div>
      </SectionCard>
      {isError && <p className="txt-sub-content text-muted-foreground"><Trans>The frequencies could not be loaded.</Trans></p>}
      {!isError && (reading === undefined
        ? <Skeleton className="h-64 w-full" />
        : <ProfileFrequency reading={reading} labels={profileLabels(catalog, profile, filters.size !== undefined)} hasEmployeeCount={size !== 'unknown'} />)}
    </>
  );
};
