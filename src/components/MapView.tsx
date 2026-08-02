import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type IControl,
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  Popup,
  LngLatBounds,
  type ExpressionSpecification,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import { STATUS_COLORS } from '../domain/phaseColors';
import { boundingBoxOf, bufferBboxByKm } from '../domain/bbox';
import {
  useArrivalHeightFeatures,
  useCurrentEscapePath,
} from '../hooks/useEscapeTargets';
import {
  ARRIVAL_LABEL_LAYER,
  ARRIVAL_SOURCE_ID,
  ESCAPE_HALO_LAYER,
  ESCAPE_LINE_LAYER,
  ESCAPE_SOURCE_ID,
  LZ_LAYER_ICON,
  LZ_LAYER_LABEL,
  LZ_SOURCE_ID,
  RZ_FILL_LAYER,
  RZ_OUTLINE_LAYER,
  RZ_SOURCE_ID,
  TRACK_LAYER_ID,
  TRACK_SOURCE_ID,
} from './map/layerIds';
import {
  ARRIVAL_PILL_ICON,
  LZ_ICON_GRASS,
  LZ_ICON_RECT,
  LZ_ICON_SOLID,
  preloadMapIcons,
} from './map/icons';
import {
  buildArrivalHeightsGeoJSON,
  buildColoredTrackGeoJSON,
  buildEscapePathGeoJSON,
  buildLzGeoJSON,
  buildReachableZoneGeoJSON,
} from './map/geojson';
import { buildLzPopupHtml } from './map/lzPopup';
import { useGeoJsonLayer } from './map/useGeoJsonLayer';
import { useLatestRef } from '@/hooks/useLatestRef';
import {
  interpolatePosition,
  interpolateTrackState,
  nearestFixTimeMs,
} from './map/trackGeometry';

type MapStyleId = 'liberty' | 'satellite';

const DEFAULT_LIBERTY_STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://tiles.openfreemap.org/styles/liberty';
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [
    {
      id: 'esri-world-imagery',
      type: 'raster',
      source: 'esri-world-imagery',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

const MAP_STYLES: Record<MapStyleId, string | StyleSpecification> = {
  liberty: DEFAULT_LIBERTY_STYLE_URL,
  satellite: SATELLITE_STYLE,
};

const LAYERS_BUTTON_SVG = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M10 2 2.5 5.75 10 9.5l7.5-3.75Zm0 8.85L2.5 7.1V10L10 13.75 17.5 10V7.1Zm0 4.25L2.5 11.35V14.25L10 18l7.5-3.75v-2.9Z"/>
</svg>`;
const CHECK_SVG = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M10.3 3.2 5 8.5 1.7 5.2l.9-.9L5 6.7l4.4-4.4Z"/>
</svg>`;

const DEFAULT_CENTER: [number, number] = [3.2489, 45.5401];
const DEFAULT_ZOOM = 11;

/**
 * Margin (in kilometres) added around the flight track's bounding box when
 * the map first fits the viewport to a newly-loaded flight, so the whole
 * trace is visible with breathing room on every side.
 */
const TRACE_FIT_MARGIN_KM = 20;

/**
 * Auto-pan trigger: fraction of the viewport width/height that acts as a
 * "safe band" margin. When the glider's projected screen position enters
 * this outer band on any side, the map centre is nudged by the same
 * fraction of the corresponding dimension to re-centre the glider.
 */
const AUTO_PAN_MARGIN_FRACTION = 0.2;

/** `style` codes rendered with the dedicated airfield icons. */
const AIRFIELD_STYLE_MATCH: ExpressionSpecification = [
  'any',
  ['==', ['get', 'style'], 5],
  ['==', ['get', 'style'], 2],
];

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const GLIDER_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" class="h-full w-full">
  <g fill="currentColor" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke">
    <path d="M32 15.5c1.1 0 1.7 3.5 2 7.5.3 4-.4 10.5-1.25 14v13h-1.5V37c-.85-3.5-1.55-10-1.25-14 .3-4 .9-7.5 2-7.5Z"/>
    <path d="M32 26.2 59.5 28.7c2.1.2 2.1 3.4 0 3.6L32 33Zm0 0L4.5 28.7c-2.1.2-2.1 3.4 0 3.6L32 33Z"/>
    <path d="M32 44.2 42.4 45.5c1.6.2 1.6 2.6 0 2.8L32 49.4Zm0 0L21.6 45.5c-1.6.2-1.6 2.6 0 2.8L32 49.4Z"/>
  </g>
</svg>`;

export function MapView() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const markerGlyphRef = useRef<HTMLDivElement | null>(null);
  const mapReadyRef = useRef(false);
  const styleControlRef = useRef<{
    button: HTMLButtonElement;
    menu: HTMLDivElement;
    optionButtons: Record<MapStyleId, HTMLButtonElement>;
    optionLabels: Record<MapStyleId, HTMLSpanElement>;
    optionChecks: Record<MapStyleId, HTMLSpanElement>;
    setOpen: (open: boolean) => void;
  } | null>(null);
  const styleControlCleanupRef = useRef<(() => void) | null>(null);

  const [iconsReady, setIconsReady] = useState(false);
  const [mapStyleId, setMapStyleId] = useState<MapStyleId>('liberty');

  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const seek = useFlightStore((s) => s.seek);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const setVisibleBounds = useFlightStore((s) => s.setVisibleBounds);
  const showReachableZone = useFlightStore((s) => s.showReachableZone);
  const reachableZoneResult = useFlightStore((s) => s.reachableZoneResult);

  const escapePath = useCurrentEscapePath();
  const arrivalHeightFeatures = useArrivalHeightFeatures();

  const syncStyleControlUi = () => {
    const control = styleControlRef.current;
    if (!control) return;
    const openLabel = t('map.baseLayer.openSelector');
    control.button.title = openLabel;
    control.button.setAttribute('aria-label', openLabel);
    for (const styleId of Object.keys(control.optionButtons) as MapStyleId[]) {
      const isActive = styleId === mapStyleId;
      const optionButton = control.optionButtons[styleId];
      optionButton.setAttribute('aria-checked', String(isActive));
      optionButton.classList.toggle('bg-accent', isActive);
      optionButton.classList.toggle('font-medium', isActive);
      optionButton.style.borderTop = 'none';
      control.optionChecks[styleId].classList.toggle('bg-primary', isActive);
      control.optionChecks[styleId].classList.toggle(
        'border-primary',
        isActive,
      );
      control.optionChecks[styleId].classList.toggle('text-primary-foreground', isActive);
      control.optionChecks[styleId].classList.toggle('text-transparent', !isActive);
      control.optionLabels[styleId].textContent = t(`map.baseLayer.${styleId}`);
    }
  };

  const setBaseLayer = (styleId: MapStyleId) => {
    setMapStyleId(styleId);
    const map = mapRef.current;
    if (!map) return;
    setIconsReady(false);
    map.setStyle(MAP_STYLES[styleId]);
    map.once('styledata', () => {
      void preloadMapIcons(map)
        .then(() => setIconsReady(true))
        .catch((err) => console.warn('[map] icon preload failed:', err));
    });
  };

  // ---- Map lifecycle ----

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: MAP_STYLES.liberty,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl(), 'top-right');

    const styleControl: IControl = {
      onAdd: () => {
        const root = document.createElement('div');
        root.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        root.style.position = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'maplibregl-ctrl-icon';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        // Keep the same fixed icon contrast as built-in MapLibre controls.
        button.style.color = '#333';
        button.innerHTML = LAYERS_BUTTON_SVG;

        const menu = document.createElement('div');
        menu.className =
          'absolute right-0 top-9 z-20 hidden min-w-40 overflow-hidden rounded-md border border-border bg-background p-1 shadow-md';

        const optionButtons = {
          liberty: document.createElement('button'),
          satellite: document.createElement('button'),
        } as Record<MapStyleId, HTMLButtonElement>;
        const optionLabels = {
          liberty: document.createElement('span'),
          satellite: document.createElement('span'),
        } as Record<MapStyleId, HTMLSpanElement>;
        const optionChecks = {
          liberty: document.createElement('span'),
          satellite: document.createElement('span'),
        } as Record<MapStyleId, HTMLSpanElement>;
        const optionClass =
          'flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs transition-colors hover:bg-accent';
        for (const styleId of Object.keys(optionButtons) as MapStyleId[]) {
          const optionButton = optionButtons[styleId];
          optionButton.type = 'button';
          optionButton.setAttribute('role', 'menuitemcheckbox');
          optionButton.className = optionClass;
          optionButton.style.display = 'flex';
          optionButton.style.alignItems = 'center';
          optionButton.style.width = '100%';
          optionButton.style.lineHeight = '1.1';

          const checkbox = optionChecks[styleId];
          checkbox.className =
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-muted-foreground/40 text-transparent';
          checkbox.style.alignSelf = 'center';
          checkbox.innerHTML = CHECK_SVG;

          const label = optionLabels[styleId];
          label.className = 'text-foreground';
          label.style.display = 'block';
          label.style.lineHeight = '1.1';

          optionButton.append(checkbox, label);
          optionButton.addEventListener('click', () => {
            setBaseLayer(styleId);
            setOpen(false);
          });
          menu.appendChild(optionButton);
        }

        const setOpen = (open: boolean) => {
          menu.classList.toggle('hidden', !open);
        };

        const onToggleClick = (event: MouseEvent) => {
          event.stopPropagation();
          setOpen(menu.classList.contains('hidden'));
        };
        const onDocumentPointerDown = (event: PointerEvent) => {
          if (!(event.target instanceof Node) || root.contains(event.target)) return;
          setOpen(false);
        };

        button.addEventListener('click', onToggleClick);
        document.addEventListener('pointerdown', onDocumentPointerDown);

        root.append(button, menu);
        styleControlRef.current = {
          button,
          menu,
          optionButtons,
          optionLabels,
          optionChecks,
          setOpen,
        };
        styleControlCleanupRef.current = () => {
          button.removeEventListener('click', onToggleClick);
          document.removeEventListener('pointerdown', onDocumentPointerDown);
        };
        syncStyleControlUi();

        return root;
      },
      onRemove: () => {
        styleControlCleanupRef.current?.();
        styleControlCleanupRef.current = null;
        const container = styleControlRef.current?.button.parentElement;
        container?.remove();
        styleControlRef.current = null;
      },
    };
    map.addControl(styleControl, 'top-right');
    mapRef.current = map;

    const publishBounds = () => {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      setVisibleBounds([sw.lng, sw.lat, ne.lng, ne.lat]);
    };

    map.once('load', () => {
      mapReadyRef.current = true;
      publishBounds();
      void preloadMapIcons(map)
        .then(() => setIconsReady(true))
        .catch((err) => console.warn('[map] icon preload failed:', err));
    });
    map.on('moveend', publishBounds);

    return () => {
      map.off('moveend', publishBounds);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      markerGlyphRef.current = null;
      mapReadyRef.current = false;
      styleControlCleanupRef.current = null;
      styleControlRef.current = null;
      setIconsReady(false);
    };
  }, [setVisibleBounds]);

  useEffect(() => {
    syncStyleControlUi();
  }, [mapStyleId, t]);

  // ---- Overlays ----

  const trackGeoJSON = useMemo(
    () =>
      flight
        ? buildColoredTrackGeoJSON(flight, localCheckResult?.samples ?? null)
        : EMPTY_FEATURE_COLLECTION,
    [flight, localCheckResult],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: TRACK_SOURCE_ID,
    data: trackGeoJSON,
    enabled: flight !== null,
    addLayers: (map) => {
      map.addLayer({
        id: TRACK_LAYER_ID,
        type: 'line',
        source: TRACK_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
        },
      });
      map.on('mouseleave', TRACK_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
      });
      const seekToPointer = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const current = useFlightStore.getState().flight;
        if (!current || !e.lngLat) return;
        seek(nearestFixTimeMs(current, e.lngLat.lng, e.lngLat.lat));
      };
      map.on('click', TRACK_LAYER_ID, seekToPointer);
      map.on('mousemove', TRACK_LAYER_ID, seekToPointer);
    },
  });

  const lzGeoJSON = useMemo(
    () => buildLzGeoJSON(landingZones, visibleLandingZoneIds),
    [landingZones, visibleLandingZoneIds],
  );

  // `t` is read through a ref inside the popup handlers so changing the
  // language doesn't force the layer to be rebuilt.
  const translateRef = useLatestRef(t);

  useGeoJsonLayer(mapRef, {
    sourceId: LZ_SOURCE_ID,
    data: lzGeoJSON,
    enabled: iconsReady,
    addLayers: (map) => {
      map.addLayer({
        id: LZ_LAYER_ICON,
        type: 'symbol',
        source: LZ_SOURCE_ID,
        layout: {
          // style 5 → solid disc-and-bar; style 2 → grass ring-and-bar;
          // everything else → a colored rectangle per difficulty.
          'icon-image': [
            'case',
            ['==', ['get', 'style'], 5],
            LZ_ICON_SOLID,
            ['==', ['get', 'style'], 2],
            LZ_ICON_GRASS,
            [
              'match',
              ['get', 'difficulty_level'],
              'green',
              LZ_ICON_RECT.green,
              'orange',
              LZ_ICON_RECT.orange,
              'red',
              LZ_ICON_RECT.red,
              'black',
              LZ_ICON_RECT.black,
              LZ_ICON_RECT.green,
            ],
          ],
          'icon-anchor': 'center',
          // Airfields render bigger than the other icons so they read as
          // the primary landing options at a glance.
          'icon-size': ['case', AIRFIELD_STYLE_MATCH, 2, 1.6],
          // Rotate only the airfield icons so the bar aligns with the
          // runway. Rectangles stay upright.
          'icon-rotate': [
            'case',
            AIRFIELD_STYLE_MATCH,
            ['get', 'runwayHeading'],
            0,
          ],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      map.addLayer({
        id: LZ_LAYER_LABEL,
        type: 'symbol',
        source: LZ_SOURCE_ID,
        // Only show labels once zoomed in enough — with 100+ LZs, drawing
        // every name at low zoom is unreadable and 404s glyph ranges.
        minzoom: 10,
        layout: {
          'text-field': ['get', 'name'],
          // Pin the font stack to one the OpenFreeMap tile server actually
          // ships (otherwise MapLibre falls back to
          // "Open Sans Regular,Arial Unicode MS Regular" and 404s).
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      });

      const popup = new Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'lz-popup',
        maxWidth: '280px',
      });

      const showPopup = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features?.[0];
        if (!feature) return;
        const coords = (
          feature.geometry as GeoJSON.Point
        ).coordinates.slice() as [number, number];
        popup
          .setLngLat(coords)
          .setHTML(buildLzPopupHtml(feature.properties, translateRef.current))
          .addTo(map);
      };

      map.on('mouseenter', LZ_LAYER_ICON, showPopup);
      map.on('mousemove', LZ_LAYER_ICON, showPopup);
      map.on('mouseleave', LZ_LAYER_ICON, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
    },
  });

  const escapeGeoJSON = useMemo(
    () => buildEscapePathGeoJSON(escapePath),
    [escapePath],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: ESCAPE_SOURCE_ID,
    data: escapeGeoJSON,
    addLayers: (map) => {
      map.addLayer({
        id: ESCAPE_HALO_LAYER,
        type: 'line',
        source: ESCAPE_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 8,
          'line-opacity': 0.25,
        },
      });
      map.addLayer({
        id: ESCAPE_LINE_LAYER,
        type: 'line',
        source: ESCAPE_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-dasharray': [2, 1.5],
        },
      });
    },
  });

  const reachableZoneGeoJSON = useMemo(
    () =>
      buildReachableZoneGeoJSON(showReachableZone ? reachableZoneResult : null),
    [showReachableZone, reachableZoneResult],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: RZ_SOURCE_ID,
    data: reachableZoneGeoJSON,
    addLayers: (map) => {
      // Insert the reachable-zone layers UNDER the track so the
      // interactive layers stay on top.
      const beforeId = map.getLayer(TRACK_LAYER_ID)
        ? TRACK_LAYER_ID
        : undefined;
      map.addLayer(
        {
          id: RZ_FILL_LAYER,
          type: 'fill',
          source: RZ_SOURCE_ID,
          paint: {
            'fill-color': STATUS_COLORS['in-local'],
            'fill-opacity': 0.18,
            'fill-antialias': false,
          },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: RZ_OUTLINE_LAYER,
          type: 'line',
          source: RZ_SOURCE_ID,
          paint: {
            'line-color': STATUS_COLORS['in-local'],
            'line-opacity': 0.35,
            'line-width': 0.5,
          },
        },
        beforeId,
      );
    },
  });

  const arrivalGeoJSON = useMemo(
    () => buildArrivalHeightsGeoJSON(arrivalHeightFeatures),
    [arrivalHeightFeatures],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: ARRIVAL_SOURCE_ID,
    data: arrivalGeoJSON,
    enabled: iconsReady,
    addLayers: (map) => {
      map.addLayer({
        id: ARRIVAL_LABEL_LAYER,
        type: 'symbol',
        source: ARRIVAL_SOURCE_ID,
        layout: {
          'icon-image': ARRIVAL_PILL_ICON,
          // Stretch the SDF pill around the label. `icon-text-fit: 'both'`
          // makes the icon grow with the text; the padding [top, right,
          // bottom, left] leaves room around the glyphs.
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [2, 6, 2, 6],
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-offset': [0, -1.6],
          'text-anchor': 'bottom',
          'text-allow-overlap': true,
        },
        paint: {
          'icon-color': [
            'match',
            ['get', 'status'],
            'in-local',
            STATUS_COLORS['in-local'],
            'in-local-marginal',
            STATUS_COLORS['in-local-marginal'],
            'out-of-local',
            STATUS_COLORS['out-of-local'],
            STATUS_COLORS['out-of-local'],
          ],
          'text-color': '#ffffff',
        },
      });
    },
  });

  // ---- Glider marker & camera ----

  // Fit the viewport to the whole track whenever a new flight is loaded,
  // and (re)create the glider marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flight || flight.fixes.length === 0) return;

    const first = flight.fixes[0];
    const trackBbox = bufferBboxByKm(
      boundingBoxOf(flight.fixes),
      TRACE_FIT_MARGIN_KM,
    );
    const bounds = new LngLatBounds(
      [trackBbox[0], trackBbox[1]],
      [trackBbox[2], trackBbox[3]],
    );

    const apply = () => {
      map.fitBounds(bounds, { padding: 0, duration: 0 });
      if (!markerRef.current) {
        const markerRoot = document.createElement('div');
        markerRoot.className = 'h-16 w-16';
        const markerGlyph = document.createElement('div');
        markerGlyph.className = 'h-full w-full text-blue-600 dark:text-blue-400';
        markerGlyph.style.transformOrigin = 'center center';
        markerGlyph.innerHTML = GLIDER_MARKER_SVG;
        markerRoot.appendChild(markerGlyph);
        markerGlyphRef.current = markerGlyph;
        markerRef.current = new Marker({ element: markerRoot, anchor: 'center' });
      }
      markerRef.current.setLngLat([first.longitude, first.latitude]).addTo(map);
    };

    if (mapReadyRef.current) {
      apply();
      return;
    }
    map.once('load', apply);
    return () => {
      map.off('load', apply);
    };
  }, [flight]);

  // Move the glider marker on every currentTimeMs change.
  useEffect(() => {
    if (!flight || !markerRef.current) return;
    const state = interpolateTrackState(flight, currentTimeMs);
    if (!state) return;
    markerRef.current.setLngLat(state.position);
    if (markerGlyphRef.current) {
      markerGlyphRef.current.style.transform = `rotate(${state.headingDeg}deg)`;
    }
  }, [flight, currentTimeMs]);

  // Auto-pan: when the glider enters the outer AUTO_PAN_MARGIN_FRACTION
  // margin of the viewport, nudge the map centre so the glider marker is
  // re-centred on screen. The glider's world position is unchanged; only
  // the camera centre moves. Skipped while the map is already animating to
  // avoid stacking pans.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flight || !mapReadyRef.current) return;
    if (map.isMoving()) return;

    const position = interpolatePosition(flight, currentTimeMs);
    if (!position) return;

    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    const p = map.project(position);
    const marginX = w * AUTO_PAN_MARGIN_FRACTION;
    const marginY = h * AUTO_PAN_MARGIN_FRACTION;
    const outsideSafeBandX = p.x < marginX || p.x > w - marginX;
    const outsideSafeBandY = p.y < marginY || p.y > h - marginY;

    if (outsideSafeBandX || outsideSafeBandY) {
      const dx = p.x - w / 2;
      const dy = p.y - h / 2;
      map.panBy([dx, dy], { duration: 300 });
    }
  }, [flight, currentTimeMs]);

  return <div ref={containerRef} className="h-full w-full" />;
}
