import { Skeleton } from '@filigran/ui';
import type { FunctionComponent } from 'react';
import { lazy, Suspense } from 'react';
import type { TargetedCountryLocation } from './targeted-countries-map-utils';

// MapLibre is heavy: only a page that shows a map loads it.
const LazyTargetedCountriesMapCanvas = lazy(() =>
  import('./targeted-countries-map-canvas').then((m) => ({ default: m.TargetedCountriesMapCanvas })));

interface TargetedCountriesMapProps {
  /** The threat's targeted locations: regions and locations outside the reference data are not drawn. */
  locations: ReadonlyArray<TargetedCountryLocation>,
  selectedCountryId?: string | null,
  /** Called with the country selected, or null when the selected one is selected again. Left out, the map is display only. */
  onSelect?: (countryId: string | null) => void,
  /** Left out, the map fills its parent's height, which must then be definite. */
  height?: number,
}

/** A threat's targeted countries on a world map, the ones that concern the tenant told apart. */
export const TargetedCountriesMap: FunctionComponent<TargetedCountriesMapProps> = ({ locations, selectedCountryId, onSelect, height }) => (
  <Suspense fallback={<Skeleton className="h-full w-full" style={height === undefined ? undefined : { height }} />}>
    <LazyTargetedCountriesMapCanvas
      locations={locations}
      selectedCountryId={selectedCountryId ?? null}
      onSelect={onSelect}
      height={height}
    />
  </Suspense>
);
