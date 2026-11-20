import type { StyleSpecification } from 'maplibre-gl';
import { compareText } from '@app/utils/text-fold';

/** A location a threat targets, as the threat detail carries it. */
export interface TargetedCountryLocation {
  country: string | null,
  countryId: string | null,
  countryIsoAlpha2: string | null,
  matchesOrganization: boolean,
}

export type TargetedCountryStatus = 'targeted' | 'concerns-you';

export interface TargetedCountry {
  countryId: string,
  isoAlpha2: string,
  name: string,
  status: TargetedCountryStatus,
}

type Position = [number, number];
export type CountryPolygon = Array<Array<Position>>;

export type CountryGeometry =
  | { type: 'Polygon', coordinates: CountryPolygon }
  | { type: 'MultiPolygon', coordinates: Array<CountryPolygon> };

export interface CountryFeature {
  type: 'Feature',
  properties: { ISO3: string, ISO2: string, NAME: string },
  geometry: CountryGeometry,
}

export interface CountriesCollection {
  type: 'FeatureCollection',
  features: Array<CountryFeature>,
}

export interface HighlightedCountryProperties {
  countryId: string,
  fill: string,
}

export interface HighlightedCountries {
  type: 'FeatureCollection',
  features: Array<{ type: 'Feature', properties: HighlightedCountryProperties, geometry: CountryGeometry }>,
}

export interface MapPalette {
  water: string,
  land: string,
  border: string,
  targeted: string,
  concernsYou: string,
  outline: string,
  focus: string,
}

export const TARGETED_COLOR_TOKEN = '--fds-color-entities-all-threats';
/** What marks a target that concerns the tenant, on the map and wherever the page lists it. */
export const CONCERNS_YOU_COLOR_TOKEN = '--fds-yellow-200';

/**
 * The design system custom properties each map colour reads, per theme. Targeted and concerning
 * countries differ in lightness as well as hue, so the legend still reads without colour vision.
 */
export const MAP_PALETTE_TOKENS: Record<'light' | 'dark', Record<keyof MapPalette, string>> = {
  dark: {
    water: '--fds-grayblue-1000',
    land: '--fds-grayblue-700',
    border: '--fds-grayblue-500',
    targeted: TARGETED_COLOR_TOKEN,
    concernsYou: CONCERNS_YOU_COLOR_TOKEN,
    outline: '--fds-grayblue-1000',
    focus: '--fds-text-default-primary',
  },
  light: {
    water: '--fds-grayblue-100',
    land: '--fds-white-1000',
    border: '--fds-gray-300',
    targeted: TARGETED_COLOR_TOKEN,
    concernsYou: CONCERNS_YOU_COLOR_TOKEN,
    outline: TARGETED_COLOR_TOKEN,
    focus: '--fds-text-default-primary',
  },
};

/**
 * A country's name in the application language, from its ISO alpha-2 code: a targeted location may
 * be a city of the country, so its own name is not the country's. Without a name for the code, the
 * polygon's name, then the location's country field, then the code itself.
 */
export const countryDisplayName = (
  isoAlpha2: string,
  locale: string,
  fallbacks: ReadonlyArray<string | null | undefined>,
): string => {
  let localized: string | undefined;
  try {
    localized = new Intl.DisplayNames([locale || 'en'], { type: 'region', fallback: 'none' }).of(isoAlpha2);
  } catch {
    localized = undefined;
  }
  return localized ?? fallbacks.find((fallback): fallback is string => Boolean(fallback)) ?? isoAlpha2;
};

/**
 * The countries a threat targets, one per country: a region has no country to draw, and a location
 * outside the reference data has no id to emit. A country named twice concerns the tenant when
 * either location does.
 */
export const toTargetedCountries = (
  locations: ReadonlyArray<TargetedCountryLocation>,
  locale: string,
  collection: CountriesCollection | null,
): Array<TargetedCountry> => {
  const byId = new Map<string, TargetedCountry>();
  for (const location of locations) {
    if (location.countryId === null || location.countryIsoAlpha2 === null) {
      continue;
    }
    const status: TargetedCountryStatus = location.matchesOrganization ? 'concerns-you' : 'targeted';
    const known = byId.get(location.countryId);
    if (!known) {
      const isoAlpha2 = location.countryIsoAlpha2.toUpperCase();
      const featureName = collection?.features.find((feature) => feature.properties.ISO2 === isoAlpha2)?.properties.NAME;
      byId.set(location.countryId, {
        countryId: location.countryId,
        isoAlpha2,
        name: countryDisplayName(isoAlpha2, locale, [featureName, location.country]),
        status,
      });
    } else if (status === 'concerns-you') {
      known.status = status;
    }
  }
  return [...byId.values()].sort((a, b) => compareText(a.name, b.name));
};

export const countryFillColor = (status: TargetedCountryStatus, palette: MapPalette): string =>
  status === 'concerns-you' ? palette.concernsYou : palette.targeted;

/** The polygons of each targeted country, each carrying the id it emits and its fill. */
export const buildHighlightedCountries = (
  collection: CountriesCollection,
  countries: ReadonlyArray<TargetedCountry>,
  palette: MapPalette,
): HighlightedCountries => {
  const byIso = new Map(countries.map((country) => [country.isoAlpha2, country]));
  return {
    type: 'FeatureCollection',
    features: collection.features.flatMap((feature) => {
      const country = byIso.get(feature.properties.ISO2);
      if (!country) {
        return [];
      }
      return [{
        type: 'Feature' as const,
        properties: { countryId: country.countryId, fill: countryFillColor(country.status, palette) },
        geometry: feature.geometry,
      }];
    }),
  };
};

interface Box {
  west: number,
  south: number,
  east: number,
  north: number,
}

const polygonsOf = (geometry: CountryGeometry): Array<CountryPolygon> =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

const outerRingBox = (polygon: CountryPolygon): Box => {
  const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const [lng, lat] of polygon[0] ?? []) {
    box.west = Math.min(box.west, lng);
    box.east = Math.max(box.east, lng);
    box.south = Math.min(box.south, lat);
    box.north = Math.max(box.north, lat);
  }
  return box;
};

// Shoelace area in square degrees, narrowed by the cosine of the latitude so that a polar island
// does not outweigh a mainland.
const approximateArea = (polygon: CountryPolygon): number => {
  const ring = polygon[0] ?? [];
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  const { south, north } = outerRingBox(polygon);
  return Math.abs(twiceArea / 2) * Math.cos(((south + north) / 2) * (Math.PI / 180));
};

// Overseas departments and far islands would otherwise stretch the frame across an ocean.
const MAIN_POLYGON_SHARE = 0.25;

const isMainPolygon = (features: ReadonlyArray<{ geometry: CountryGeometry }>): ((polygon: CountryPolygon) => boolean) => {
  const areas = new Map(features.flatMap((feature) => polygonsOf(feature.geometry)).map((polygon) => [polygon, approximateArea(polygon)]));
  const largest = Math.max(0, ...areas.values());
  return (polygon) => (areas.get(polygon) ?? 0) >= largest * MAIN_POLYGON_SHARE;
};

const byCountry = <Feature extends { properties: { countryId: string } }>(features: ReadonlyArray<Feature>): Array<Array<Feature>> => {
  const grouped = new Map<string, Array<Feature>>();
  for (const feature of features) {
    grouped.set(feature.properties.countryId, [...grouped.get(feature.properties.countryId) ?? [], feature]);
  }
  return [...grouped.values()];
};

const countryPolygons = (
  features: ReadonlyArray<{ properties: { countryId: string }, geometry: CountryGeometry }>,
  main: boolean,
): Array<CountryPolygon> => byCountry(features).flatMap((countryFeatures) => {
  const isMain = isMainPolygon(countryFeatures);
  return countryFeatures.flatMap((feature) => polygonsOf(feature.geometry)).filter((polygon) => isMain(polygon) === main);
});

/** The polygons of the highlighted countries that the frame leaves out, as too small and too far. */
export const framedOutPolygons = (
  features: ReadonlyArray<{ properties: { countryId: string }, geometry: CountryGeometry }>,
): Array<CountryPolygon> => countryPolygons(features, false);

/**
 * The narrowest longitude span covering every interval, crossing the antimeridian when that is
 * narrower: its east may then exceed 180, which MapLibre frames as the continuation eastwards.
 */
export const coveringLongitudeSpan = (intervals: ReadonlyArray<[number, number]>): [number, number] | null => {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [west, east] of sorted) {
    const last = merged.at(-1);
    if (last && west <= last[1]) {
      last[1] = Math.max(last[1], east);
    } else {
      merged.push([west, east]);
    }
  }
  if (merged.length === 0) {
    return null;
  }
  const first = merged[0];
  const last = merged.at(-1)!;
  let span: [number, number] = [first[0], last[1]];
  let widestGap = first[0] + 360 - last[1];
  for (let index = 0; index < merged.length - 1; index += 1) {
    const gap = merged[index + 1][0] - merged[index][1];
    if (gap > widestGap) {
      widestGap = gap;
      span = [merged[index + 1][0], merged[index][1] + 360];
    }
  }
  return span;
};

/** West-south then east-north corners; the east may exceed 180, the frame then crossing the antimeridian. */
export type FramingBounds = [[number, number], [number, number]];

/**
 * The bounds framing the main land of every highlighted country and the left-out polygons the frame
 * has to take back, or null when none is drawn.
 */
export const computeFramingBounds = (
  features: ReadonlyArray<{ properties: { countryId: string }, geometry: CountryGeometry }>,
  joined: ReadonlyArray<CountryPolygon> = [],
): FramingBounds | null => {
  const boxes = [...countryPolygons(features, true), ...joined].map(outerRingBox);
  const span = coveringLongitudeSpan(boxes.map((box) => [box.west, box.east]));
  if (!span) {
    return null;
  }
  const south = Math.min(...boxes.map((box) => box.south));
  const north = Math.max(...boxes.map((box) => box.north));
  return [[span[0], south], [span[1], north]];
};

/**
 * The longitude of the world copy nearest the map's centre: a frame across the antimeridian shows
 * a country east of 180, where its polygons' own longitude would project off the map.
 */
export const nearestWorldCopyLongitude = (longitude: number, centerLongitude: number): number =>
  longitude + 360 * Math.round((centerLongitude - longitude) / 360);

/** A rectangle of the map's canvas, in pixels from its top-left corner. */
export interface CanvasRect {
  left: number,
  top: number,
  right: number,
  bottom: number,
}

type Projection = (lngLat: [number, number]) => { x: number, y: number };
type Point = { x: number, y: number };

// A short map at a low zoom shows more than one world: the copies either side of the nearest one count.
const projectedCopies = (polygon: CountryPolygon, project: Projection, centerLongitude: number): Array<Array<Point>> => {
  const box = outerRingBox(polygon);
  const middle = (box.west + box.east) / 2;
  const nearestShift = nearestWorldCopyLongitude(middle, centerLongitude) - middle;
  return [nearestShift - 360, nearestShift, nearestShift + 360].map((shift) =>
    (polygon[0] ?? []).map(([lng, lat]) => project([lng + shift, lat])));
};

// The horizontal extent of each ring edge within the rectangle's rows.
const edgeSpansInRows = (ring: ReadonlyArray<Point>, rect: CanvasRect): Array<[number, number]> => {
  const spans: Array<[number, number]> = [];
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    if (Math.max(a.y, b.y) < rect.top || Math.min(a.y, b.y) > rect.bottom) {
      continue;
    }
    const xAt = (y: number): number => (a.y === b.y ? a.x : a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
    const x1 = xAt(Math.min(Math.max(a.y, rect.top), rect.bottom));
    const x2 = xAt(Math.min(Math.max(b.y, rect.top), rect.bottom));
    spans.push([Math.min(x1, x2), Math.max(x1, x2)]);
  }
  return spans;
};

const containsPoint = (ring: ReadonlyArray<Point>, { x, y }: Point): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if ((a.y > y) !== (b.y > y) && x < a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)) {
      inside = !inside;
    }
  }
  return inside;
};

const ringOverlaps = (ring: ReadonlyArray<Point>, rect: CanvasRect): boolean =>
  edgeSpansInRows(ring, rect).some(([left, right]) => left < rect.right && right > rect.left)
  || containsPoint(ring, { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });

/** The polygons drawn over the rectangle on any world copy in view. */
export const polygonsUnderRect = (
  polygons: ReadonlyArray<CountryPolygon>,
  project: Projection,
  centerLongitude: number,
  rect: CanvasRect,
): Array<CountryPolygon> => polygons.filter((polygon) =>
  projectedCopies(polygon, project, centerLongitude).some((ring) => ringOverlaps(ring, rect)));

export const highlightedPolygons = (features: ReadonlyArray<{ geometry: CountryGeometry }>): Array<CountryPolygon> =>
  features.flatMap((feature) => polygonsOf(feature.geometry));

/**
 * How many pixels the drawing has to move right for no polygon drawn over the rectangle, on any
 * world copy in view, to stay within its rows short of its right edge plus the margin: 0 when none
 * is drawn over it.
 */
export const clearanceRightOf = (
  polygons: ReadonlyArray<CountryPolygon>,
  project: Projection,
  centerLongitude: number,
  rect: CanvasRect,
  margin: number,
): number => Math.max(0, ...polygons.flatMap((polygon) => projectedCopies(polygon, project, centerLongitude)
  .filter((ring) => ringOverlaps(ring, rect))
  .map((ring) => rect.right + margin - Math.min(...edgeSpansInRows(ring, rect).map(([left]) => left)))));

/**
 * The frame's west and east longitudes on the world copy nearest the map's centre, which the map
 * wraps into -180..180. Both edges move by the same whole turn, picked from the frame's middle: each
 * edge wrapped on its own would reverse a frame wider than 180 degrees.
 */
export const frameLongitudesNear = (bounds: FramingBounds, centerLongitude: number): [number, number] => {
  const [[west], [east]] = bounds;
  const middle = (west + east) / 2;
  const shift = nearestWorldCopyLongitude(middle, centerLongitude) - middle;
  return [west + shift, east + shift];
};

/**
 * How many pixels the drawing can move right before the frame's east edge passes the canvas's right
 * edge less the margin.
 */
export const roomRightOfFrame = (
  bounds: FramingBounds,
  project: Projection,
  centerLongitude: number,
  canvasWidth: number,
  margin: number,
): number => {
  const [, [, north]] = bounds;
  const [, east] = frameLongitudesNear(bounds, centerLongitude);
  return canvasWidth - margin - project([east, north]).x;
};

/**
 * How many pixels the drawing has to move right for the frame, drawn from `westX` to `eastX`, to sit
 * within the canvas: inside the padding when it fits there, else sharing the spare width in the
 * padding's proportions, else overflowing both edges alike.
 */
export const frameShiftIntoView = (
  westX: number,
  eastX: number,
  canvasWidth: number,
  padding: { left: number, right: number },
): number => {
  const spare = canvasWidth - (eastX - westX);
  if (spare >= padding.left + padding.right) {
    return Math.min(Math.max(westX, padding.left), canvasWidth - padding.right - (eastX - westX)) - westX;
  }
  if (spare >= 0) {
    return (spare * padding.left) / (padding.left + padding.right) - westX;
  }
  return spare / 2 - westX;
};

const WORLD_TILE_SIZE = 512;

const mercatorY = (latitude: number): number =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / (2 * Math.PI);

const latitudeOfMercatorY = (y: number): number =>
  (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;

/** The zoom at which the world's height fills the canvas's height. */
export const zoomFillingHeight = (canvasHeight: number): number => Math.log2(canvasHeight / WORLD_TILE_SIZE);

/**
 * The map's own constraint zooms in until the world fills the canvas's height, which leaves a wide
 * frame in a tall canvas no zoom to fit at. This one lets the world come out shorter than the canvas,
 * kept whole within it, and otherwise keeps the canvas within the world as the map does.
 */
export const constrainViewToWorld = (
  center: [number, number],
  zoom: number,
  canvasHeight: number,
  zoomRange: [number, number],
): { center: [number, number], zoom: number } => {
  const [minZoom, maxZoom] = zoomRange;
  const constrainedZoom = Math.min(Math.max(zoom, minZoom), maxZoom);
  const halfHeight = canvasHeight / 2 / (WORLD_TILE_SIZE * 2 ** constrainedZoom);
  const [longitude, latitude] = center;
  const y = Math.min(Math.max(mercatorY(latitude), Math.min(halfHeight, 1 - halfHeight)), Math.max(halfHeight, 1 - halfHeight));
  return { center: [longitude, latitudeOfMercatorY(y)], zoom: constrainedZoom };
};

/** Where a country's name shows on focus: the centre of its largest polygon's box. */
export const countryLabelPoint = (features: ReadonlyArray<{ geometry: CountryGeometry }>): [number, number] | null => {
  const polygons = features.flatMap((feature) => polygonsOf(feature.geometry));
  let largest: CountryPolygon | null = null;
  let largestArea = -1;
  for (const polygon of polygons) {
    const area = approximateArea(polygon);
    if (area > largestArea) {
      largest = polygon;
      largestArea = area;
    }
  }
  if (!largest) {
    return null;
  }
  const box = outerRingBox(largest);
  return [(box.west + box.east) / 2, (box.south + box.north) / 2];
};

export const TARGETED_COUNTRIES_SOURCE = 'targeted-countries';

/**
 * The base map drawn from the bundled vector tiles: land, water and country borders only, since
 * the tiles ship no glyphs for labels. The targeted countries are added above it.
 */
export const buildBaseMapStyle = (tilesUrl: string, palette: MapPalette): StyleSpecification => ({
  version: 8,
  sources: {
    basemap: { type: 'vector', url: tilesUrl },
    [TARGETED_COUNTRIES_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'countryId' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': palette.water } },
    { id: 'earth', type: 'fill', source: 'basemap', 'source-layer': 'earth', paint: { 'fill-color': palette.land } },
    { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', paint: { 'fill-color': palette.water } },
    { id: 'targeted-countries-fill', type: 'fill', source: TARGETED_COUNTRIES_SOURCE, paint: { 'fill-color': ['get', 'fill'] } },
    {
      id: 'boundaries',
      type: 'line',
      source: 'basemap',
      'source-layer': 'boundaries',
      filter: ['==', ['get', 'kind'], 'country'],
      paint: { 'line-color': palette.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.5] },
    },
    { id: 'targeted-countries-outline', type: 'line', source: TARGETED_COUNTRIES_SOURCE, paint: { 'line-color': palette.outline, 'line-width': 0.6 } },
    {
      id: 'targeted-countries-pointed',
      type: 'line',
      source: TARGETED_COUNTRIES_SOURCE,
      filter: ['==', ['get', 'countryId'], ''],
      paint: { 'line-color': palette.focus, 'line-width': 1.5 },
    },
    {
      id: 'targeted-countries-selected',
      type: 'line',
      source: TARGETED_COUNTRIES_SOURCE,
      filter: ['==', ['get', 'countryId'], ''],
      paint: { 'line-color': palette.focus, 'line-width': 3 },
    },
  ],
});
