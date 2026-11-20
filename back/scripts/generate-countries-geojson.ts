/* eslint-disable no-console */
/**
 * Generates `static/maps/countries.json`, the country polygons the threat maps colour, from the
 * Natural Earth 1:50m admin-0 countries layer (public domain).
 *
 *   yarn tsx scripts/generate-countries-geojson.ts [path-to-ne_50m_admin_0_countries.geojson]
 *
 * Without a path, the pinned release below is downloaded. Each feature keeps `ISO3` (`ISO_A3_EH`,
 * else `ADM0_A3`), `ISO2` (`ISO_A2_EH`, empty when Natural Earth has none) and `NAME`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'maps', 'countries.json');

// Three decimals is about 100 m, finer than the 1:50m source.
const COORDINATE_PRECISION = 1000;

type Position = [number, number];
type Ring = Array<Position>;
type Geometry =
  | { type: 'Polygon', coordinates: Array<Ring> }
  | { type: 'MultiPolygon', coordinates: Array<Array<Ring>> };

interface SourceFeature {
  properties: Record<string, string | number | null>,
  geometry: Geometry | null,
}

const NO_CODE = '-99';

const code = (value: string | number | null | undefined): string => (
  typeof value === 'string' && value !== NO_CODE ? value : ''
);

const roundRing = (ring: Ring): Ring => {
  const rounded: Ring = [];
  for (const [lng, lat] of ring) {
    const point: Position = [Math.round(lng * COORDINATE_PRECISION) / COORDINATE_PRECISION, Math.round(lat * COORDINATE_PRECISION) / COORDINATE_PRECISION];
    const previous = rounded.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      rounded.push(point);
    }
  }
  return rounded;
};

// A ring rounded below four points is no longer a polygon.
const roundPolygon = (polygon: Array<Ring>): Array<Ring> => polygon.map(roundRing).filter((ring) => ring.length >= 4);

const roundGeometry = (geometry: Geometry): Geometry | null => {
  if (geometry.type === 'Polygon') {
    const coordinates = roundPolygon(geometry.coordinates);
    return coordinates.length > 0 ? { type: 'Polygon', coordinates } : null;
  }
  const coordinates = geometry.coordinates.map(roundPolygon).filter((polygon) => polygon.length > 0);
  return coordinates.length > 0 ? { type: 'MultiPolygon', coordinates } : null;
};

const readSource = async (path: string | undefined): Promise<{ features: Array<SourceFeature> }> => {
  if (path) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Natural Earth download failed: ${response.status}`);
  }
  return JSON.parse(await response.text());
};

const source = await readSource(process.argv[2]);

const features = source.features.flatMap((feature) => {
  const iso3 = code(feature.properties['ISO_A3_EH']) || code(feature.properties['ADM0_A3']);
  const geometry = feature.geometry ? roundGeometry(feature.geometry) : null;
  if (!iso3 || !geometry) {
    return [];
  }
  return [{
    type: 'Feature',
    properties: { ISO3: iso3, ISO2: code(feature.properties['ISO_A2_EH']), NAME: String(feature.properties['NAME'] ?? '') },
    geometry,
  }];
}).sort((a, b) => a.properties.ISO3.localeCompare(b.properties.ISO3));

// One feature per line keeps a regeneration's diff readable.
const lines = features.map((feature) => JSON.stringify(feature));
writeFileSync(OUTPUT, `{"type":"FeatureCollection","features":[\n${lines.join(',\n')}\n]}\n`);

console.log(`${features.length} countries written to ${OUTPUT}`);
