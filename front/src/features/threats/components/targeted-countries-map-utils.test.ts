import { describe, expect, it } from 'vitest';
import type { CountriesCollection, CountryGeometry, MapPalette, TargetedCountry } from './targeted-countries-map-utils';
import {
  buildHighlightedCountries,
  clearanceRightOf,
  computeFramingBounds,
  constrainViewToWorld,
  countryDisplayName,
  countryFillColor,
  countryLabelPoint,
  coveringLongitudeSpan,
  framedOutPolygons,
  frameLongitudesNear,
  frameShiftIntoView,
  highlightedPolygons,
  nearestWorldCopyLongitude,
  polygonsUnderRect,
  roomRightOfFrame,
  toTargetedCountries,
  zoomFillingHeight,
} from './targeted-countries-map-utils';

const palette: MapPalette = {
  water: 'water',
  land: 'land',
  border: 'border',
  targeted: 'threat-orange',
  concernsYou: 'light-amber',
  outline: 'outline',
  focus: 'focus',
};

const square = (west: number, south: number, east: number, north: number): Array<Array<[number, number]>> => [[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]];

const polygon = (west: number, south: number, east: number, north: number): CountryGeometry => ({
  type: 'Polygon',
  coordinates: square(west, south, east, north),
});

const location = (overrides: Partial<{ country: string | null, countryId: string | null, countryIsoAlpha2: string | null, matchesOrganization: boolean }>) => ({
  country: 'France',
  countryId: 'country-fr',
  countryIsoAlpha2: 'FR',
  matchesOrganization: false,
  ...overrides,
});

describe('toTargetedCountries', () => {
  it('leaves out regions and locations outside the reference data, which have no country to draw', () => {
    const countries = toTargetedCountries([
      location({}),
      location({ country: null, countryId: null, countryIsoAlpha2: null }),
      location({ country: 'Atlantis', countryId: null, countryIsoAlpha2: 'AT' }),
    ], 'en', null);

    expect(countries.map((country) => country.countryId)).toEqual(['country-fr']);
  });

  it('keeps one entry per country, concerning the tenant when either location does', () => {
    const countries = toTargetedCountries([
      location({ matchesOrganization: false }),
      location({ matchesOrganization: true }),
    ], 'en', null);

    expect(countries).toEqual([{ countryId: 'country-fr', isoAlpha2: 'FR', name: 'France', status: 'concerns-you' }]);
  });

  it('orders the countries by their name in the application language, the order the keyboard walks them', () => {
    const countries = toTargetedCountries([
      location({ country: 'Spain', countryId: 'country-es', countryIsoAlpha2: 'ES' }),
      location({ country: 'Egypt', countryId: 'country-eg', countryIsoAlpha2: 'EG' }),
      location({ country: 'Belgium', countryId: 'country-be', countryIsoAlpha2: 'BE' }),
    ], 'fr', null);

    expect(countries.map((country) => country.name)).toEqual(['Belgique', 'Égypte', 'Espagne']);
  });

  it('names a country by its code rather than by the spelling a location carries', () => {
    const countries = toTargetedCountries([
      location({ country: 'French Republic', countryIsoAlpha2: 'fr' }),
    ], 'en', null);

    expect(countries[0]?.name).toBe('France');
  });

  it('falls back to the polygon name when the code has no name in the application language', () => {
    const collection: CountriesCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { ISO3: 'SOL', ISO2: 'QZ', NAME: 'Somaliland' }, geometry: polygon(43, 8, 49, 11) }],
    };

    const countries = toTargetedCountries([location({ country: 'Somaliland (reference)', countryIsoAlpha2: 'QZ' })], 'en', collection);

    expect(countries[0]?.name).toBe('Somaliland');
  });
});

describe('countryDisplayName', () => {
  it('names a country in the application language', () => {
    expect(countryDisplayName('JP', 'en', [])).toBe('Japan');
    expect(countryDisplayName('JP', 'fr', [])).toBe('Japon');
  });

  it('reads English when no application language is set yet', () => {
    expect(countryDisplayName('JP', '', [])).toBe('Japan');
  });

  it('falls back to the polygon name, then the country field, for a code it has no name for', () => {
    expect(countryDisplayName('QZ', 'en', ['Somaliland', 'Somaliland (reference)'])).toBe('Somaliland');
    expect(countryDisplayName('QZ', 'en', [undefined, 'Somaliland (reference)'])).toBe('Somaliland (reference)');
    expect(countryDisplayName('QZ', 'en', [undefined, null])).toBe('QZ');
  });
});

describe('nearestWorldCopyLongitude', () => {
  it('moves a point to the world copy the map is centred on', () => {
    // The United States framed with Japan, across the Pacific: the map centres east of 180.
    expect(nearestWorldCopyLongitude(-96, 212)).toBe(264);
  });

  it('keeps a point already on the copy in view', () => {
    expect(nearestWorldCopyLongitude(2, 10)).toBe(2);
  });

  it('moves a point west when the map is centred west of the antimeridian', () => {
    expect(nearestWorldCopyLongitude(170, -170)).toBe(-190);
  });
});

describe('countryFillColor', () => {
  it('paints a targeted country in the threat colour', () => {
    expect(countryFillColor('targeted', palette)).toBe('threat-orange');
  });

  it('paints a country that concerns the tenant in light amber', () => {
    expect(countryFillColor('concerns-you', palette)).toBe('light-amber');
  });
});

describe('buildHighlightedCountries', () => {
  const collection: CountriesCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { ISO3: 'FRA', ISO2: 'FR', NAME: 'France' }, geometry: polygon(-5, 42, 8, 51) },
      { type: 'Feature', properties: { ISO3: 'AUS', ISO2: 'AU', NAME: 'Australia' }, geometry: polygon(113, -39, 154, -10) },
      { type: 'Feature', properties: { ISO3: 'AUS', ISO2: 'AU', NAME: 'Indian Ocean Ter.' }, geometry: polygon(105, -11, 106, -10) },
      { type: 'Feature', properties: { ISO3: 'DEU', ISO2: 'DE', NAME: 'Germany' }, geometry: polygon(6, 47, 15, 55) },
    ],
  };
  const countries: Array<TargetedCountry> = [
    { countryId: 'country-fr', isoAlpha2: 'FR', name: 'France', status: 'concerns-you' },
    { countryId: 'country-au', isoAlpha2: 'AU', name: 'Australia', status: 'targeted' },
  ];

  it('keeps the polygons of the targeted countries only, each with the id it emits and its fill', () => {
    const highlighted = buildHighlightedCountries(collection, countries, palette);

    expect(highlighted.features.map((feature) => feature.properties)).toEqual([
      { countryId: 'country-fr', fill: 'light-amber' },
      { countryId: 'country-au', fill: 'threat-orange' },
      { countryId: 'country-au', fill: 'threat-orange' },
    ]);
  });
});

describe('coveringLongitudeSpan', () => {
  it('spans from the westmost to the eastmost interval when that is the narrowest way', () => {
    expect(coveringLongitudeSpan([[-5, 8], [6, 15], [20, 30]])).toEqual([-5, 30]);
  });

  it('crosses the antimeridian when the widest gap lies elsewhere', () => {
    // The United States and Japan: across the Pacific is narrower than across the Atlantic.
    expect(coveringLongitudeSpan([[-125, -67], [129, 146]])).toEqual([129, 293]);
  });

  it('has nothing to span without an interval', () => {
    expect(coveringLongitudeSpan([])).toBeNull();
  });
});

describe('computeFramingBounds', () => {
  const feature = (countryId: string, geometry: CountryGeometry) => ({ properties: { countryId }, geometry });

  it('frames the countries drawn', () => {
    const bounds = computeFramingBounds([
      feature('country-fr', polygon(-5, 42, 8, 51)),
      feature('country-de', polygon(6, 47, 15, 55)),
    ]);

    expect(bounds).toEqual([[-5, 42], [15, 55]]);
  });

  it('frames a country astride the antimeridian on its side of the world, not across it', () => {
    const russia: CountryGeometry = {
      type: 'MultiPolygon',
      coordinates: [square(27, 41, 180, 78), square(-180, 64, -169, 70)],
    };

    const bounds = computeFramingBounds([feature('country-ru', russia)]);

    expect(bounds).toEqual([[27, 41], [180, 78]]);
  });

  it('leaves far-flung small islands of a country out of the frame', () => {
    const france: CountryGeometry = {
      type: 'MultiPolygon',
      coordinates: [square(-5, 42, 8, 51), square(55, -21.4, 55.8, -20.9)],
    };

    const bounds = computeFramingBounds([feature('country-fr', france)]);

    expect(bounds).toEqual([[-5, 42], [8, 51]]);
  });

  it('frames nothing when no country is drawn', () => {
    expect(computeFramingBounds([])).toBeNull();
  });

  it('takes back into the frame a left-out polygon it is given', () => {
    const alaska = square(-168, 54, -141, 71);
    const unitedStates: CountryGeometry = { type: 'MultiPolygon', coordinates: [square(-125, 25, -67, 49), alaska] };

    expect(computeFramingBounds([feature('country-us', unitedStates)])).toEqual([[-125, 25], [-67, 49]]);
    expect(computeFramingBounds([feature('country-us', unitedStates)], [alaska])).toEqual([[-168, 25], [-67, 71]]);
  });
});

describe('framedOutPolygons', () => {
  const feature = (countryId: string, geometry: CountryGeometry) => ({ properties: { countryId }, geometry });

  it('lists the small far-off polygons of each country, weighed against that country alone', () => {
    const reunion = square(55, -21.4, 55.8, -20.9);
    const france: CountryGeometry = { type: 'MultiPolygon', coordinates: [square(-5, 42, 8, 51), reunion] };
    const luxembourg = polygon(5.7, 49.4, 6.5, 50.2);

    expect(framedOutPolygons([feature('country-fr', france), feature('country-lu', luxembourg)])).toEqual([reunion]);
  });
});

describe('polygonsUnderRect', () => {
  // One pixel per degree, the map's top-left corner at longitude -180 and latitude 90.
  const project = ([lng, lat]: [number, number]) => ({ x: lng + 180, y: 90 - lat });
  const zoomButtons = { left: 12, top: 12, right: 44, bottom: 50 };

  it('finds a polygon drawn under the rectangle', () => {
    const alaska = square(-168, 54, -141, 71);

    expect(polygonsUnderRect([alaska], project, 0, zoomButtons)).toEqual([alaska]);
  });

  it('leaves a polygon drawn beside the rectangle', () => {
    const hawaii = square(-160, 19, -154, 22);

    expect(polygonsUnderRect([hawaii], project, 0, zoomButtons)).toEqual([]);
  });

  it('finds a polygon drawn under the rectangle on a world copy other than the one nearest the centre', () => {
    const aleutians = square(172, 52, 179, 53);

    expect(polygonsUnderRect([aleutians], project, -90, { left: 350, top: 30, right: 360, bottom: 40 })).toEqual([aleutians]);
  });
});

describe('countryLabelPoint', () => {
  it('names a country at the centre of its largest polygon', () => {
    const point = countryLabelPoint([{ geometry: { type: 'MultiPolygon', coordinates: [square(55, -21, 56, -20), square(-4, 42, 8, 50)] } }]);

    expect(point).toEqual([2, 46]);
  });
});

describe('clearanceRightOf', () => {
  // Russia framed in a 1280 x 280 map, so short that it shows more than one world.
  const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const project = ([lng, lat]: [number, number]) => ({
    x: 660 + (lng - 103.9) * 2.23,
    y: 24 + ((mercator(77.73) - mercator(lat)) * 184) / (mercator(77.73) - mercator(41.2)),
  });
  const zoomControls = { left: 12, top: 12, right: 44, bottom: 80 };
  const mainland: Array<Array<[number, number]>> = [[[27.35, 41.2], [180, 62], [180, 68], [140, 77.73], [27.35, 70], [27.35, 41.2]]];
  const wrangelWest = square(-180, 70.92, -177.5, 71.6);
  const wrangelEast = square(178.63, 70.82, 180, 71.54);
  const russia = { properties: { countryId: 'country-ru' }, geometry: { type: 'MultiPolygon', coordinates: [mainland, square(-180, 64.28, -169.73, 68.98), wrangelWest, wrangelEast] } as CountryGeometry };

  it('still finds an island taken back into the frame under the buttons, on the world copy west of the frame', () => {
    expect(computeFramingBounds([russia], [wrangelWest, wrangelEast])).toEqual([[27.35, 41.2], [182.5, 77.73]]);
    expect(polygonsUnderRect(highlightedPolygons([russia]), project, 103.9, zoomControls)).toEqual([wrangelWest, wrangelEast]);
  });

  it('measures how far right the drawing has to move for that copy to clear the buttons', () => {
    const westmostCopyLeft = project([178.63 - 360, 71.54]).x;

    expect(clearanceRightOf(highlightedPolygons([russia]), project, 103.9, zoomControls, 8)).toBeCloseTo(44 + 8 - westmostCopyLeft);
  });

  it('needs no move when nothing is drawn under the buttons', () => {
    expect(clearanceRightOf(highlightedPolygons([{ geometry: polygon(-5, 42, 8, 51) }]), project, 103.9, zoomControls, 8)).toBe(0);
  });
});

describe('roomRightOfFrame', () => {
  // Australia eastwards across the Pacific to Turkey, framed by its width in a 600 x 700 map: the
  // map holds its centre at 259 as -101.
  const bounds: [[number, number], [number, number]] = [[113, -44], [405, 72]];
  const pixelsPerDegree = 512 / (405 - 113);
  const project = ([lng]: [number, number]) => ({ x: 64 + (lng - (113 - 360)) * pixelsPerDegree, y: 0 });

  it('reads the east edge of a frame across the antimeridian on the copy beside the wrapped centre', () => {
    expect(roomRightOfFrame(bounds, project, -101, 600, 8)).toBeCloseTo(600 - 8 - (64 + 512));
  });

  it('reads the east edge of a frame over 180 degrees wide on the same copy as its west edge', () => {
    const wideProject = ([lng]: [number, number]) => ({ x: 64 + lng * (400 / 350), y: 0 });

    expect(roomRightOfFrame([[0, -40], [350, 70]], wideProject, 165, 600, 8)).toBeCloseTo(600 - 8 - (64 + 400));
  });

  it('leaves no room once that edge reaches the margin', () => {
    const shifted = ([lng, lat]: [number, number]) => ({ x: project([lng, lat]).x + 16, y: 0 });

    expect(roomRightOfFrame(bounds, shifted, -101, 600, 8)).toBeCloseTo(0);
  });
});

describe('frameShiftIntoView', () => {
  const padding = { left: 64, right: 24 };

  it('brings back within the canvas a frame a tall, narrow card drew wider than its fit', () => {
    // A 590 x 673 card: the world has to fill its height, so the frame comes out 545 px wide, past the right edge.
    const shift = frameShiftIntoView(43, 588, 590, padding);

    expect(43 + shift).toBeCloseTo((45 * 64) / 88);
    expect(588 + shift).toBeLessThanOrEqual(590);
  });

  it('keeps a frame that fits inside the padding where the fit put it', () => {
    expect(frameShiftIntoView(64, 400, 590, padding)).toBe(0);
  });

  it('moves a frame that fits inside the padding back off its edges', () => {
    expect(frameShiftIntoView(100, 580, 590, padding)).toBe(-14);
  });

  it('centres a frame wider than the canvas', () => {
    expect(frameShiftIntoView(-30, 630, 600, padding)).toBe(0);
    expect(frameShiftIntoView(0, 660, 600, padding)).toBe(-30);
  });
});

describe('frameLongitudesNear', () => {
  it('keeps a frame over 180 degrees wide in its order around a centre inside it', () => {
    expect(frameLongitudesNear([[0, -40], [350, 70]], 165)).toEqual([0, 350]);
  });

  it('moves both edges of a frame over 180 degrees wide by the same turn', () => {
    expect(frameLongitudesNear([[0, -40], [350, 70]], -175)).toEqual([-360, -10]);
  });

  it('brings a frame across the antimeridian onto the copy of the wrapped centre', () => {
    expect(frameLongitudesNear([[113, -44], [405, 72]], -101)).toEqual([-247, 45]);
  });
});

describe('zoomFillingHeight', () => {
  it('is the zoom at which the 512 px world matches the height', () => {
    expect(zoomFillingHeight(512)).toBe(0);
    expect(zoomFillingHeight(1024)).toBe(1);
  });
});

describe('constrainViewToWorld', () => {
  it('lets a tall canvas show the whole world shorter than itself, at the zoom asked', () => {
    expect(constrainViewToWorld([120, 0], 0, 700, [-2, 7])).toEqual({ center: [120, 0], zoom: 0 });
  });

  it('keeps a world shorter than the canvas whole within it', () => {
    const view = constrainViewToWorld([120, 80], 0, 700, [-2, 7]);

    expect(view.center[0]).toBe(120);
    expect(view.center[1]).toBeCloseTo(54.98, 2);
  });

  it('keeps a canvas shorter than the world within it', () => {
    const view = constrainViewToWorld([10, 85], 1, 280, [-2, 7]);

    expect(view.center[1]).toBeCloseTo(78.35, 2);
  });

  it('holds the zoom within its range', () => {
    expect(constrainViewToWorld([0, 0], -3, 700, [-2, 7]).zoom).toBe(-2);
    expect(constrainViewToWorld([0, 0], 9, 700, [-2, 7]).zoom).toBe(7);
  });
});
