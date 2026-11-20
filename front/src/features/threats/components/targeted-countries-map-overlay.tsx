import { IconButton, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Minus, Plus } from 'lucide-react';
import type { FunctionComponent, Ref } from 'react';
import type { TargetedCountry } from './targeted-countries-map-utils';
import { CONCERNS_YOU_COLOR_TOKEN, TARGETED_COLOR_TOKEN } from './targeted-countries-map-utils';

export interface PointedCountryLabel {
  name: string,
  x: number,
  y: number,
}

interface TargetedCountriesMapOverlayProps {
  countries: ReadonlyArray<TargetedCountry>,
  selectedCountryId: string | null,
  /** Left out, the countries are listed for a screen reader but offer nothing to press. */
  onSelect?: (countryId: string | null) => void,
  /** The country a keyboard user is on, null once the focus leaves it. */
  onPointCountry: (countryId: string | null) => void,
  pointedLabel: PointedCountryLabel | null,
  onZoomIn: () => void,
  onZoomOut: () => void,
  zoomControlsRef?: Ref<HTMLDivElement>,
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- the attribution OpenStreetMap's licence requires, never translated
const OPENSTREETMAP_ATTRIBUTION = '© OpenStreetMap';

const LegendItem: FunctionComponent<{ colorToken: string, label: string }> = ({ colorToken, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden="true" className="size-3 shrink-0 rounded-[2px]" style={{ backgroundColor: `var(${colorToken})` }} />
    <Text variant="content-caption" className="text-default-primary">{label}</Text>
  </span>
);

/**
 * What sits over the map canvas: zoom, legend, attribution, the name of the country pointed at,
 * and one button per country, which is how a keyboard or a screen reader reaches a country the
 * canvas only paints.
 */
export const TargetedCountriesMapOverlay: FunctionComponent<TargetedCountriesMapOverlayProps> = ({
  countries,
  selectedCountryId,
  onSelect,
  onPointCountry,
  pointedLabel,
  onZoomIn,
  onZoomOut,
  zoomControlsRef,
}) => (
  <>
    <div ref={zoomControlsRef} className="absolute top-3 left-3 flex flex-col gap-1">
      <IconButton type="button" priority="secondary" size="sm" aria-label={t`Zoom in`} icon={<Plus className="size-4" />} onClick={onZoomIn} />
      <IconButton type="button" priority="secondary" size="sm" aria-label={t`Zoom out`} icon={<Minus className="size-4" />} onClick={onZoomOut} />
    </div>

    <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 rounded border border-[color:var(--fds-border-elevation-subtle-layer-1)] bg-[var(--fds-bg-elevation-default-layer-1)] px-2.5 py-2">
      <LegendItem colorToken={TARGETED_COLOR_TOKEN} label={t`Targeted countries`} />
      <LegendItem colorToken={CONCERNS_YOU_COLOR_TOKEN} label={t`This concerns you`} />
    </div>

    <a
      href="https://www.openstreetmap.org/copyright"
      target="_blank"
      rel="noreferrer"
      className="absolute right-0 bottom-0 rounded-tl bg-[var(--fds-bg-elevation-default-layer-1)] px-1.5 hover:underline"
    >
      <Text variant="content-caption" className="text-default-secondary">{OPENSTREETMAP_ATTRIBUTION}</Text>
    </a>

    {pointedLabel && (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded border border-[color:var(--fds-border-elevation-subtle-layer-1)] bg-[var(--fds-bg-elevation-default-layer-1)] px-2 py-1 shadow"
        style={{ left: pointedLabel.x, top: pointedLabel.y - 8 }}
      >
        <Text variant="content-compact" className="whitespace-nowrap text-default-primary">{pointedLabel.name}</Text>
      </div>
    )}

    <ul aria-label={t`Targeted countries`} className="sr-only">
      {countries.map((country) => {
        const { name } = country;
        const selected = country.countryId === selectedCountryId;
        const label = country.status === 'concerns-you' ? t`${name} (this concerns you)` : name;
        return (
          <li key={country.countryId}>
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selected}
                onFocus={() => onPointCountry(country.countryId)}
                onBlur={() => onPointCountry(null)}
                onClick={() => onSelect(selected ? null : country.countryId)}
              >
                {label}
              </button>
            ) : label}
          </li>
        );
      })}
    </ul>
  </>
);
