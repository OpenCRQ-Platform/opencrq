import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import type { FunctionComponent } from 'react';
import type { PointedCountryLabel } from './targeted-countries-map-overlay';
import type {
  CanvasRect,
  CountriesCollection,
  CountryPolygon,
  FramingBounds,
  HighlightedCountries,
  MapPalette,
  TargetedCountryLocation,
} from './targeted-countries-map-utils';
import { Text } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { addProtocol, LngLat, Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useTheme } from '../../../providers';
import { clientReportQueue } from '../../../stores/client-report-queue';
import { TargetedCountriesMapOverlay } from './targeted-countries-map-overlay';
import {
  buildBaseMapStyle,
  buildHighlightedCountries,
  clearanceRightOf,
  computeFramingBounds,
  constrainViewToWorld,
  countryLabelPoint,
  framedOutPolygons,
  frameLongitudesNear,
  frameShiftIntoView,
  highlightedPolygons,
  MAP_PALETTE_TOKENS,
  nearestWorldCopyLongitude,
  polygonsUnderRect,
  roomRightOfFrame,
  TARGETED_COUNTRIES_SOURCE,
  toTargetedCountries,
  zoomFillingHeight,
} from './targeted-countries-map-utils';

// The page's content security policy refuses the blob worker MapLibre builds by default.
setWorkerUrl(maplibreWorkerUrl);
addProtocol('pmtiles', new Protocol().tile);

const MAPS_PATH = '/api/maps/';
const FILL_LAYER = 'targeted-countries-fill';
const POINTED_LAYER = 'targeted-countries-pointed';
const SELECTED_LAYER = 'targeted-countries-selected';

const WORLD_BOUNDS: FramingBounds = [[-170, -58], [190, 78]];
// The bundled tiles stop at zoom 5: a closer frame would only magnify them.
const FRAME_MAX_ZOOM = 5;
const MIN_ZOOM = -2;
const MAX_ZOOM = 7;
// Room for the zoom buttons on the left and the legend at the bottom.
const FRAME_PADDING = { top: 24, right: 24, bottom: 72, left: 64 };
// Each pass can only widen the frame, which may bring another left-out polygon under the buttons.
const MAX_FRAMING_PASSES = 3;
const RESIZE_REFRAME_DELAY_MS = 150;
const ZOOM_CONTROLS_MARGIN = 8;

const countriesCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({ ISO3: z.string(), ISO2: z.string(), NAME: z.string() }),
    geometry: z.discriminatedUnion('type', [
      z.object({ type: z.literal('Polygon'), coordinates: z.custom<CountryPolygon>(Array.isArray) }),
      z.object({ type: z.literal('MultiPolygon'), coordinates: z.custom<Array<CountryPolygon>>(Array.isArray) }),
    ]),
  })),
});

let countriesRequest: Promise<CountriesCollection> | null = null;

const loadCountries = (): Promise<CountriesCollection> => {
  countriesRequest ??= fetch(`${MAPS_PATH}countries.json`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Country polygons unavailable (${response.status})`);
      }
      return countriesCollectionSchema.parse(await response.json());
    })
    .catch((error: unknown) => {
      countriesRequest = null;
      throw error;
    });
  return countriesRequest;
};

const isWebGl2Supported = (): boolean => {
  const context = document.createElement('canvas').getContext('webgl2');
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a WebGL extension name
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  return context !== null;
};

// The probe carries the theme class itself: the theme provider switches the root class only after
// this component's effects have run.
const readPalette = (probe: HTMLElement, theme: 'light' | 'dark'): MapPalette => {
  const style = getComputedStyle(probe);
  const tokens = MAP_PALETTE_TOKENS[theme];
  const read = (key: keyof MapPalette): string => style.getPropertyValue(tokens[key]).trim() || 'gray';
  return {
    water: read('water'),
    land: read('land'),
    border: read('border'),
    targeted: read('targeted'),
    concernsYou: read('concernsYou'),
    outline: read('outline'),
    focus: read('focus'),
  };
};

const reportLoadFailure = (error: unknown): void => {
  clientReportQueue.reportClientError(error instanceof Error ? error : new Error(String(error)), 'transport');
};

interface FocusTarget {
  name: string,
  lngLat: [number, number],
}

const projectLabel = (map: MapLibreMap, target: FocusTarget | null): PointedCountryLabel | null => {
  if (!target) {
    return null;
  }
  const [longitude, latitude] = target.lngLat;
  const { x, y } = map.project([nearestWorldCopyLongitude(longitude, map.getCenter().lng), latitude]);
  return { name: target.name, x, y };
};

const relativeRect = (element: HTMLElement, container: HTMLElement): CanvasRect => {
  const rect = element.getBoundingClientRect();
  const origin = container.getBoundingClientRect();
  return { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top };
};

const fitTakingBackCoveredParts = (map: MapLibreMap, highlighted: HighlightedCountries, zoomControls: CanvasRect | null): FramingBounds => {
  const leftOut = framedOutPolygons(highlighted.features);
  const joined: Array<CountryPolygon> = [];
  for (let pass = 1; ; pass += 1) {
    const bounds = computeFramingBounds(highlighted.features, joined) ?? WORLD_BOUNDS;
    map.fitBounds(bounds, { padding: FRAME_PADDING, maxZoom: FRAME_MAX_ZOOM, animate: false });
    if (!zoomControls || pass === MAX_FRAMING_PASSES) {
      return bounds;
    }
    const covered = polygonsUnderRect(
      leftOut.filter((polygon) => !joined.includes(polygon)),
      (lngLat) => map.project(lngLat),
      map.getCenter().lng,
      zoomControls,
    );
    if (covered.length === 0) {
      return bounds;
    }
    joined.push(...covered);
  }
};

// A frame wider than the world draws another copy of a framed polygon at its left edge, which no
// bounds can take back: the drawing moves right instead, as far as the frame's east edge allows.
const panClearOfZoomControls = (map: MapLibreMap, highlighted: HighlightedCountries, bounds: FramingBounds, zoomControls: CanvasRect): void => {
  const polygons = highlightedPolygons(highlighted.features);
  const project = (lngLat: [number, number]) => map.project(lngLat);
  for (let pass = 1; pass <= MAX_FRAMING_PASSES; pass += 1) {
    const centerLongitude = map.getCenter().lng;
    const clearance = clearanceRightOf(polygons, project, centerLongitude, zoomControls, ZOOM_CONTROLS_MARGIN);
    const room = roomRightOfFrame(bounds, project, centerLongitude, map.getContainer().clientWidth, ZOOM_CONTROLS_MARGIN);
    const shift = Math.min(clearance, room);
    if (shift <= 0) {
      return;
    }
    map.panBy([-shift, 0], { animate: false });
  }
};

const keepFrameInView = (map: MapLibreMap, bounds: FramingBounds): void => {
  const [west, east] = frameLongitudesNear(bounds, map.getCenter().lng);
  const westX = map.project([west, 0]).x;
  const eastX = map.project([east, 0]).x;
  const shift = frameShiftIntoView(westX, eastX, map.getContainer().clientWidth, FRAME_PADDING);
  if (Math.abs(shift) >= 1) {
    map.panBy([-shift, 0], { animate: false });
  }
};

const frameCountries = (map: MapLibreMap, highlighted: HighlightedCountries, zoomControls: CanvasRect | null): void => {
  const bounds = fitTakingBackCoveredParts(map, highlighted, zoomControls);
  keepFrameInView(map, bounds);
  if (zoomControls) {
    panClearOfZoomControls(map, highlighted, bounds, zoomControls);
  }
};

interface LoadedMap {
  map: MapLibreMap,
  palette: MapPalette,
}

const MapMessage: FunctionComponent<{ children: string }> = ({ children }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-[var(--fds-bg-elevation-default-layer-1)] p-4">
    <Text variant="content-compact" className="text-default-secondary">{children}</Text>
  </div>
);

export interface TargetedCountriesMapCanvasProps {
  locations: ReadonlyArray<TargetedCountryLocation>,
  selectedCountryId: string | null,
  /** Left out, a country can be pointed at for its name but not selected. */
  onSelect?: (countryId: string | null) => void,
  /** Left out, the map fills its parent's height. */
  height?: number,
}

export const TargetedCountriesMapCanvas: FunctionComponent<TargetedCountriesMapCanvasProps> = ({
  locations,
  selectedCountryId,
  onSelect,
  height,
}) => {
  const { effectiveTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomControlsRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const framedKeyRef = useRef<string | null>(null);
  const movedByReaderRef = useRef(false);
  // The reader zooms out no further than the frame or the world filling the canvas's height.
  const frameZoomRef = useRef(Number.NEGATIVE_INFINITY);
  const focusTargetRef = useRef<FocusTarget | null>(null);
  const [webGlSupported] = useState(isWebGl2Supported);
  const [loaded, setLoaded] = useState<LoadedMap | null>(null);
  const [collection, setCollection] = useState<CountriesCollection | null>(null);
  const [hovered, setHovered] = useState<{ countryId: string, x: number, y: number } | null>(null);
  const [focusedCountryId, setFocusedCountryId] = useState<string | null>(null);
  const [focusLabel, setFocusLabel] = useState<PointedCountryLabel | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [resizeCount, setResizeCount] = useState(0);
  // Read by the map's own mouse handler, which is bound once per map.
  const selectableRef = useRef(onSelect !== undefined);
  useEffect(() => {
    selectableRef.current = onSelect !== undefined;
  });

  const countries = toTargetedCountries(locations, i18n.locale, collection);
  const countriesKey = countries.map((country) => `${country.countryId}:${country.status}`).join('|');
  const highlighted = loaded && collection ? buildHighlightedCountries(collection, countries, loaded.palette) : null;

  useEffect(() => {
    let active = true;
    loadCountries()
      .then((loadedCollection) => {
        if (active) {
          setCollection(loadedCollection);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadFailed(true);
          reportLoadFailure(error);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const probe = probeRef.current;
    if (!webGlSupported || !container || !probe) {
      return undefined;
    }
    const palette = readPalette(probe, effectiveTheme);
    const map = new MapLibreMap({
      container,
      style: buildBaseMapStyle(`pmtiles://${window.location.origin}${MAPS_PATH}world.pmtiles`, palette),
      bounds: WORLD_BOUNDS,
      attributionControl: false,
      // A wheel over the map would otherwise stop scrolling the page it sits in.
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      transformConstrain: (lngLat, zoom) => {
        const lowestZoom = Math.max(MIN_ZOOM, Math.min(frameZoomRef.current, zoomFillingHeight(container.clientHeight)));
        const view = constrainViewToWorld([lngLat.lng, lngLat.lat], zoom, container.clientHeight, [lowestZoom, MAX_ZOOM]);
        return { center: new LngLat(...view.center), zoom: view.zoom };
      },
      locale: { 'Map.Title': t`Map of the targeted countries` },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    map.on('load', () => setLoaded({ map, palette }));
    // A missing tiles file is answered by the web app's index page, which no tile parses.
    map.on('error', (event) => {
      setLoadFailed(true);
      reportLoadFailure(event.error);
    });
    map.on('move', () => setFocusLabel(projectLabel(map, focusTargetRef.current)));
    map.on('movestart', (event: { originalEvent?: Event }) => {
      if (event.originalEvent) {
        movedByReaderRef.current = true;
      }
    });
    map.on('mousemove', FILL_LAYER, (event: MapLayerMouseEvent) => {
      const countryId = event.features?.[0]?.properties['countryId'];
      if (typeof countryId === 'string') {
        map.getCanvas().style.cursor = selectableRef.current ? 'pointer' : '';
        setHovered({ countryId, x: event.point.x, y: event.point.y });
      }
    });
    map.on('mouseleave', FILL_LAYER, () => {
      map.getCanvas().style.cursor = '';
      setHovered(null);
    });

    return () => {
      framedKeyRef.current = null;
      frameZoomRef.current = Number.NEGATIVE_INFINITY;
      setLoaded(null);
      map.remove();
    };
  }, [effectiveTheme, webGlSupported]);

  // A resize keeps the map's centre and zoom, which can slide a far-off part under the zoom buttons.
  useEffect(() => {
    const container = containerRef.current;
    if (!loaded || !container) {
      return undefined;
    }
    const sizeOf = () => `${container.clientWidth}x${container.clientHeight}`;
    let framedSize = sizeOf();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (sizeOf() === framedSize) {
          return;
        }
        framedSize = sizeOf();
        loaded.map.resize();
        if (!movedByReaderRef.current) {
          framedKeyRef.current = null;
          setResizeCount((count) => count + 1);
        }
      }, RESIZE_REFRAME_DELAY_MS);
    });
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !highlighted) {
      return;
    }
    loaded.map.getSource<GeoJSONSource>(TARGETED_COUNTRIES_SOURCE)?.setData(highlighted);
    if (framedKeyRef.current !== countriesKey) {
      framedKeyRef.current = countriesKey;
      const container = containerRef.current;
      const zoomControls = zoomControlsRef.current;
      frameZoomRef.current = Number.NEGATIVE_INFINITY;
      frameCountries(loaded.map, highlighted, container && zoomControls ? relativeRect(zoomControls, container) : null);
      frameZoomRef.current = loaded.map.getZoom();
      movedByReaderRef.current = false;
    }
  }, [loaded, highlighted, countriesKey, resizeCount]);

  const pointedCountryId = focusedCountryId ?? hovered?.countryId ?? null;

  useEffect(() => {
    if (!loaded) {
      return;
    }
    loaded.map.setFilter(POINTED_LAYER, ['==', ['get', 'countryId'], pointedCountryId ?? '']);
    loaded.map.setFilter(SELECTED_LAYER, ['==', ['get', 'countryId'], selectedCountryId ?? '']);
  }, [loaded, pointedCountryId, selectedCountryId]);

  useEffect(() => {
    if (!loaded || !onSelect) {
      return undefined;
    }
    const { map } = loaded;
    const handleClick = (event: MapLayerMouseEvent) => {
      const countryId = event.features?.[0]?.properties['countryId'];
      if (typeof countryId === 'string') {
        onSelect(countryId === selectedCountryId ? null : countryId);
      }
    };
    map.on('click', FILL_LAYER, handleClick);
    return () => {
      map.off('click', FILL_LAYER, handleClick);
    };
  }, [loaded, selectedCountryId, onSelect]);

  const handlePointCountry = (countryId: string | null) => {
    setFocusedCountryId(countryId);
    const country = countries.find((candidate) => candidate.countryId === countryId);
    const lngLat = country && highlighted
      ? countryLabelPoint(highlighted.features.filter((feature) => feature.properties.countryId === country.countryId))
      : null;
    const target = country && lngLat ? { name: country.name, lngLat } : null;
    focusTargetRef.current = target;
    if (!loaded || !target) {
      setFocusLabel(null);
      return;
    }
    const [longitude, latitude] = target.lngLat;
    const visible: [number, number] = [nearestWorldCopyLongitude(longitude, loaded.map.getCenter().lng), latitude];
    if (!loaded.map.getBounds().contains(visible)) {
      movedByReaderRef.current = true;
      loaded.map.panTo(visible);
    }
    setFocusLabel(projectLabel(loaded.map, target));
  };

  const hoveredName = hovered ? countries.find((country) => country.countryId === hovered.countryId)?.name : undefined;
  const pointedLabel = focusLabel ?? (hovered && hoveredName ? { name: hoveredName, x: hovered.x, y: hovered.y } : null);

  return (
    <div className="relative h-full w-full overflow-hidden rounded" style={height === undefined ? undefined : { height }}>
      <span ref={probeRef} className={effectiveTheme} hidden />
      {webGlSupported ? (
        <>
          {/* The map paints its background on tiles only, which stop where a world shorter than the canvas ends. */}
          <div ref={containerRef} className="h-full w-full" style={loaded ? { backgroundColor: loaded.palette.water } : undefined} />
          {loadFailed ? (
            <MapMessage>{t`This map cannot be displayed: its map data could not be loaded.`}</MapMessage>
          ) : (
            <TargetedCountriesMapOverlay
              countries={countries}
              selectedCountryId={selectedCountryId}
              onSelect={onSelect}
              onPointCountry={handlePointCountry}
              pointedLabel={pointedLabel}
              onZoomIn={() => {
                movedByReaderRef.current = true;
                loaded?.map.zoomIn();
              }}
              onZoomOut={() => {
                movedByReaderRef.current = true;
                loaded?.map.zoomOut();
              }}
              zoomControlsRef={zoomControlsRef}
            />
          )}
        </>
      ) : (
        <MapMessage>{t`This map cannot be displayed: your browser does not support WebGL2 or has it disabled.`}</MapMessage>
      )}
    </div>
  );
};
