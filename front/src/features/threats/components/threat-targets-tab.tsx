import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { ThreatAnalysisDetailData } from './threat-detail-tabs';
import { Chip } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { DebouncedSearchField, SectionCard } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useOpenCtiBaseUrl, useUrlListFilters } from '../../../hooks';
import { useTheme } from '../../../providers';
import { getCountryFlagEmoji, resolveOptionFilter } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { buildOpenCtiObjectLink } from '../../supporting-assets/connectors-utils';
import { threatLocationsSectorsListSearchSchema } from '../threat-locations-sectors-list-search';
import { OpenCtiLink } from './opencti-link';
import { TargetedCountriesMap } from './targeted-countries-map';
import { EmptyRow } from './threat-detail-tabs';
import {
  concernsYouChipStyle,
  filterAndOrderLocations,
  filterAndOrderSectors,
  hasOpenCtiLink,
  targetedCountryIds,
  targetedCountryName,
} from './threat-targets-utils';

const LOCATIONS_PAGE_SIZE = 10;
const SECTORS_PAGE_SIZE = 20;

type LocationRow = ThreatAnalysisDetailData['locations'][number] & { displayName: string };
type SectorRow = ThreatAnalysisDetailData['sectors'][number] & { displayName: string };

const ConcernsYouCell: FunctionComponent<{ concernsYou: boolean }> = ({ concernsYou }) => {
  const { effectiveTheme } = useTheme();
  return concernsYou
    ? <Chip className="w-fit border" style={concernsYouChipStyle(effectiveTheme)} label={t`Yes`} />
    : <span className="text-muted-foreground">{EMPTY_VALUE}</span>;
};

const RecognitionCell: FunctionComponent<{ recognized: boolean }> = ({ recognized }) => (
  <span className="text-muted-foreground">{recognized ? t`Recognized` : t`Not recognized`}</span>
);

const ConcernFilter: FunctionComponent<{ concerningYouOnly: boolean, allLabel: string, onChange: (concerningYouOnly: boolean) => void }> = ({
  concerningYouOnly,
  allLabel,
  onChange,
}) => (
  <Select value={concerningYouOnly ? 'concerns-you' : 'all'} onValueChange={(value) => onChange(value === 'concerns-you')}>
    <SelectTrigger className="w-56" aria-label={t`Filter on what concerns you`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">{allLabel}</SelectItem>
      <SelectItem value="concerns-you"><Trans>Concerning you</Trans></SelectItem>
    </SelectContent>
  </Select>
);

const openCtiColumn = <T extends { openctiStixRelationId: string | null }>(openctiUrl: string | null): ColumnDefWithOptionsHeader<T, unknown> => ({
  id: 'opencti',
  header: t`OpenCTI`,
  size: 100,
  enableSorting: false,
  cell: ({ row }): ReactElement => (
    <OpenCtiLink
      href={buildOpenCtiObjectLink(openctiUrl, row.original.openctiStixRelationId)}
      label={t`Open this relationship in OpenCTI`}
      iconOnly
    />
  ),
});

/**
 * The rows built from `source`, kept as the same array until `source` or `key` changes:
 * `DataPageLayout` goes back to its first page whenever its rows change identity.
 */
const useHeldRows = <S, R>(source: S, key: string, build: () => Array<R>): Array<R> => {
  const [held, setHeld] = useState(() => ({ source, key, rows: build() }));
  if (held.source === source && held.key === key) {
    return held.rows;
  }
  const next = { source, key, rows: build() };
  setHeld(next);
  return next.rows;
};

/** A threat's targeted countries on a map, and its targeted locations and sectors as searchable tables. */
export const ThreatTargetsTab: FunctionComponent<{ detail: ThreatAnalysisDetailData }> = ({ detail }) => {
  const { locations, sectors } = detail;
  const openctiUrl = useOpenCtiBaseUrl();
  const { filters, setFilters } = useUrlListFilters(threatLocationsSectorsListSearchSchema);

  const countryId = resolveOptionFilter(filters.country, targetedCountryIds(locations), '');
  const { locale } = i18n;
  const countryName = countryId === '' ? null : targetedCountryName(locations, countryId, locale);

  const locationFilters = { search: filters.locationSearch, concerningYouOnly: filters.locationsConcerningYou, countryId };
  const locationRows = useHeldRows(
    locations,
    JSON.stringify([locationFilters, locale]),
    () => filterAndOrderLocations(locations, locationFilters, locale),
  );
  const sectorFilters = { search: filters.sectorSearch, concerningYouOnly: filters.sectorsConcerningYou };
  const sectorRows = useHeldRows(sectors, JSON.stringify(sectorFilters), () => filterAndOrderSectors(sectors, sectorFilters));

  const locationColumns: Array<ColumnDefWithOptionsHeader<LocationRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'displayName',
      header: t`Name`,
      cell: ({ row }): ReactElement => (
        <span className="flex items-center gap-2">
          {row.original.countryIsoAlpha2 && (
            <span aria-hidden="true">{getCountryFlagEmoji(row.original.countryIsoAlpha2)}</span>
          )}
          <span>{row.original.displayName}</span>
        </span>
      ),
    },
    {
      id: 'concernsYou',
      accessorFn: (row) => row.matchesOrganization,
      header: t`This concerns you`,
      cell: ({ row }): ReactElement => <ConcernsYouCell concernsYou={row.original.matchesOrganization} />,
    },
    {
      id: 'status',
      accessorFn: (row) => row.countryId !== null,
      header: t`Status`,
      cell: ({ row }): ReactElement => <RecognitionCell recognized={row.original.countryId !== null} />,
    },
    ...(hasOpenCtiLink(openctiUrl, locations) ? [openCtiColumn<LocationRow>(openctiUrl)] : []),
  ];

  const sectorColumns: Array<ColumnDefWithOptionsHeader<SectorRow, unknown>> = [
    { id: 'name', accessorKey: 'displayName', header: t`Name` },
    {
      id: 'concernsYou',
      accessorFn: (row) => row.matchesOrganization,
      header: t`This concerns you`,
      cell: ({ row }): ReactElement => <ConcernsYouCell concernsYou={row.original.matchesOrganization} />,
    },
    {
      id: 'status',
      accessorFn: (row) => row.sectorId !== null,
      header: t`Status`,
      cell: ({ row }): ReactElement => <RecognitionCell recognized={row.original.sectorId !== null} />,
    },
    ...(hasOpenCtiLink(openctiUrl, sectors) ? [openCtiColumn<SectorRow>(openctiUrl)] : []),
  ];

  const locationsCard = (
    <SectionCard title={t`Locations`} className="min-w-0" cardClassName="flex-1">
      {locations.length === 0 ? (
        <EmptyRow>{t`No location targeted.`}</EmptyRow>
      ) : (
        <DataPageLayout
          data={locationRows}
          columns={locationColumns}
          storageKey="threat-locations"
          initialPageSize={LOCATIONS_PAGE_SIZE}
          leftHeaderContent={(
            <div className="flex flex-wrap items-center gap-3">
              <DebouncedSearchField
                placeholder={t`Search locations...`}
                value={filters.locationSearch}
                onCommit={(locationSearch) => setFilters({ locationSearch })}
                clearLabel={t`Clear search`}
                className="w-72"
              />
              {countryName !== null && (
                <Chip
                  label={i18n._({ id: 'Country: {countryName}', message: 'Country: {countryName}', values: { countryName } })}
                  onDelete={() => setFilters({ country: '' })}
                  deleteLabel={t`Remove the country filter`}
                />
              )}
              <ConcernFilter
                concerningYouOnly={filters.locationsConcerningYou}
                allLabel={t`All locations`}
                onChange={(locationsConcerningYou) => setFilters({ locationsConcerningYou })}
              />
            </div>
          )}
        />
      )}
    </SectionCard>
  );

  return (
    <div className="@container flex flex-col gap-6">
      {targetedCountryIds(locations).length > 0 ? (
        <div className="grid grid-cols-1 gap-6 @min-[60rem]:grid-cols-2">
          <SectionCard
            title={t`Targeted countries`}
            className="min-w-0"
            cardClassName="relative min-h-[480px] flex-1 overflow-hidden p-0"
            contentClassName="absolute inset-0"
          >
            <TargetedCountriesMap
              locations={locations}
              selectedCountryId={countryId === '' ? null : countryId}
              onSelect={(selected) => setFilters({ country: selected ?? '' })}
            />
          </SectionCard>
          {locationsCard}
        </div>
      ) : locationsCard}

      <SectionCard title={t`Sectors`}>
        {sectors.length === 0 ? (
          <EmptyRow>{t`No sector targeted.`}</EmptyRow>
        ) : (
          <DataPageLayout
            data={sectorRows}
            columns={sectorColumns}
            storageKey="threat-sectors"
            initialPageSize={SECTORS_PAGE_SIZE}
            leftHeaderContent={(
              <div className="flex flex-wrap items-center gap-3">
                <DebouncedSearchField
                  placeholder={t`Search sectors...`}
                  value={filters.sectorSearch}
                  onCommit={(sectorSearch) => setFilters({ sectorSearch })}
                  clearLabel={t`Clear search`}
                  className="w-72"
                />
                <ConcernFilter
                  concerningYouOnly={filters.sectorsConcerningYou}
                  allLabel={t`All sectors`}
                  onChange={(sectorsConcerningYou) => setFilters({ sectorsConcerningYou })}
                />
              </div>
            )}
          />
        )}
      </SectionCard>
    </div>
  );
};
