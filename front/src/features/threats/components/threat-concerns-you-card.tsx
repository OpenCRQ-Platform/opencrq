import { plural, t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { createElement } from 'react';
import type { TargetedCountryLocation } from './targeted-countries-map-utils';
import type { OverviewSector } from './threat-overview-utils';
import { SectionCard } from '../../../components/shared';
import { cn } from '../../../utils';
import { sectorIcon } from './sector-icon-utils';
import { TargetedCountriesMap } from './targeted-countries-map';
import { pickSectorTiles } from './threat-overview-utils';

const MAP_HEIGHT = 280;
const MAX_SECTOR_TILES = 8;

const tileClassName = 'flex min-w-0 items-center gap-2 rounded border px-2.5 py-2 txt-sub-content';

const SectorTile: FunctionComponent<{ sector: OverviewSector }> = ({ sector }) => {
  const { name } = sector;
  return (
    <li
      className={cn(
        tileClassName,
        sector.matchesOrganization
          ? 'border-[color:var(--fds-yellow-200)] bg-[color-mix(in_srgb,var(--fds-yellow-200)_8%,transparent)]'
          : 'border-[color:var(--fds-border-elevation-subtle-layer-1)]',
      )}
      title={name}
    >
      {createElement(sectorIcon(name), {
        'aria-hidden': true,
        size: 16,
        className: cn('shrink-0', sector.matchesOrganization ? 'text-icon-alert' : 'text-default-secondary'),
      })}
      <span className="truncate">{name}</span>
      {sector.matchesOrganization && <span className="sr-only">{t`(this concerns you)`}</span>}
    </li>
  );
};

interface ThreatConcernsYouCardProps {
  locations: ReadonlyArray<TargetedCountryLocation>,
  sectors: ReadonlyArray<OverviewSector>,
}

/**
 * The targeted countries on a display-only map and the targeted sectors as tiles, what concerns
 * the tenant told apart; the names of the countries live in the Locations tab.
 */
export const ThreatConcernsYouCard: FunctionComponent<ThreatConcernsYouCardProps> = ({ locations, sectors }) => {
  const total = locations.length + sectors.length;
  const hasKnownCountry = locations.some((location) => location.countryId !== null);
  const { shown, hiddenCount } = pickSectorTiles(sectors, MAX_SECTOR_TILES);

  return (
    <SectionCard
      title={t`This concerns you`}
      className="h-full"
      cardClassName="flex-1"
      headerAction={total > 0 && (
        <Link
          from="/$tenantId/{-$organizationId}/threat-center/threats/$threatId"
          to="locations-sectors"
          className="txt-sub-content text-filigran-brand-primary hover:underline"
        >
          {plural(total, { one: 'See the # location or sector', other: 'See the # locations and sectors' })}
        </Link>
      )}
    >
      {hasKnownCountry
        ? <TargetedCountriesMap locations={locations} height={MAP_HEIGHT} />
        : (
          <p className="txt-sub-content text-muted-foreground">
            {locations.length === 0 ? t`No location targeted.` : t`None of the locations this threat targets is a known country.`}
          </p>
        )}
      <div className="flex flex-col gap-2">
        <p className="txt-sub-content text-muted-foreground">{t`Sectors`}</p>
        {sectors.length === 0
          ? <p className="txt-sub-content text-muted-foreground">{t`No sector targeted.`}</p>
          : (
            <ul aria-label={t`Targeted sectors`} className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
              {shown.map((sector) => <SectorTile key={sector.id} sector={sector} />)}
              {hiddenCount > 0 && (
                <li className="flex">
                  <Link
                    from="/$tenantId/{-$organizationId}/threat-center/threats/$threatId"
                    to="locations-sectors"
                    className={cn(tileClassName, 'w-full justify-center border-dashed border-[color:var(--fds-border-elevation-subtle-layer-1)] text-filigran-brand-primary hover:underline')}
                  >
                    {plural(hiddenCount, { one: '# more sector', other: '# more sectors' })}
                  </Link>
                </li>
              )}
            </ul>
          )}
      </div>
    </SectionCard>
  );
};
