import {
  AttributionControl,
  type IControl,
  type LngLat,
  type StyleSpecification,
  Map as MaplibreMap,
  NavigationControl,
  setWorkerUrl,
  type MapLayerMouseEvent,
  LngLatBounds,
  Marker,
  Popup,
  type ExpressionSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers } from 'lucide-react';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGeoJsonLayer } from './map/useGeoJsonLayer';
import { buildArrivalHeightsGeoJSON, buildColoredTrackGeoJSON, buildLzGeoJSON } from './map/geojson';
import { useFlightStore } from '@/state/useFlightStore';
import { ARRIVAL_LABEL_LAYER, ARRIVAL_SOURCE_ID, LZ_LAYER_ICON, LZ_SOURCE_ID, TRACK_LAYER_ID, TRACK_SOURCE_ID } from './map/layerIds';
import { interpolateTrackState, nearestFixTimeMs } from './map/trackGeometry';
import { boundingBoxOf, bufferBboxProportionally } from '@/domain/bbox';
import throttle from 'lodash/throttle';
import { buildLzPopupHtml } from './map/lzPopup';
import { ARRIVAL_PILL_ICON, LZ_ICON_GRASS, LZ_ICON_RECT, LZ_ICON_SOLID, preloadMapIcons } from './map/icons';
import { useLatestRef } from '@/hooks/useLatestRef';
import { useTranslation } from 'react-i18next';
import { useArrivalHeightFeatures } from '@/hooks/useEscapeTargets';
import { STATUS_COLORS } from '@/domain/phaseColors';


setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());

const DEFAULT_CENTER: [number, number] = [3.2489, 45.5401];
const DEFAULT_ZOOM = 11;
const THROTLLE_DELAY_MS = 50; 

/**
 * Margin (in kilometres) added around the flight track's bounding box when
 * the map first fits the viewport to a newly-loaded flight, so the whole
 * trace is visible with breathing room on every side.
 */
const TRACE_FIT_MARGIN_KM_PERCENTAGE = 0.10; // 10% margin on each side

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** `style` codes rendered with the dedicated airfield icons. */
const AIRFIELD_STYLE_MATCH: ExpressionSpecification = [
  'any',
  ['==', ['get', 'style'], 5],
  ['==', ['get', 'style'], 2],
];


const GLIDER_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" class="h-full w-full">
  <g fill="currentColor" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke">
    <path d="M32 15.5c1.1 0 1.7 3.5 2 7.5.3 4-.4 10.5-1.25 14v13h-1.5V37c-.85-3.5-1.55-10-1.25-14 .3-4 .9-7.5 2-7.5Z"/>
    <path d="M32 26.2 59.5 28.7c2.1.2 2.1 3.4 0 3.6L32 33Zm0 0L4.5 28.7c-2.1.2-2.1 3.4 0 3.6L32 33Z"/>
    <path d="M32 44.2 42.4 45.5c1.6.2 1.6 2.6 0 2.8L32 49.4Zm0 0L21.6 45.5c-1.6.2-1.6 2.6 0 2.8L32 49.4Z"/>
  </g>
</svg>`;

const MAP_STYLES: Record<
  string,
  { label: string; style: StyleSpecification | string; attribution?: string }
> = {
  osm: {
    label: 'OpenStreetMap',
    style: {
      version: 8,
      sources: {
        openstreetmap: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'openstreetmap',
          type: 'raster',
          source: 'openstreetmap',
        },
      ],
    },
  },
  'liberty': {
    label: 'Liberty',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    attribution:
      '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  'Positron': {
    label: 'Positron',
    style: 'https://tiles.openfreemap.org/styles/positron',
    attribution:
      '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  'Dark': {
    label: 'Dark',
    style: 'https://tiles.openfreemap.org/styles/dark',
    attribution:
      '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  'esri-world-imagery': {
    label: 'Satellite (Esri)',
    style: {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Tiles &copy; Esri',
        },
      },
      layers: [
        {
          id: 'esri-world-imagery',
          type: 'raster',
          source: 'esri',
        },
      ],
    },
  }
};

type MapStyleKey = keyof typeof MAP_STYLES;

async function resolveMapStyle(
  style: StyleSpecification | string,
  attribution?: string,
): Promise<StyleSpecification> {
  if (typeof style !== 'string') {
    return style;
  }

  const styleResponse = await fetch(style);
  if (!styleResponse.ok) {
    throw new Error(`Unable to load map style (${styleResponse.status})`);
  }

  const resolvedStyle = (await styleResponse.json()) as StyleSpecification;
  const sourceEntries = Object.entries(resolvedStyle.sources);

  await Promise.all(
    sourceEntries.map(async ([, source]) => {
      if (!('url' in source) || typeof source.url !== 'string') {
        return;
      }

      const sourceResponse = await fetch(source.url);
      if (!sourceResponse.ok) {
        throw new Error(`Unable to load map source (${sourceResponse.status})`);
      }

      const tileJson = (await sourceResponse.json()) as { tiles?: string[] };
      const sourceWithTiles = source as typeof source & {
        tiles?: string[];
        url?: string;
        attribution?: string;
      };
      sourceWithTiles.tiles = tileJson.tiles;
      delete sourceWithTiles.url;
      if (attribution && !sourceWithTiles.attribution) {
        sourceWithTiles.attribution = attribution;
      }
    }),
  );

  return resolvedStyle;
}

function MapStyleMenu({ map }: { map: MaplibreMap }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="map-style-menu">
      <button
        type="button"
        className="map-style-button"
        title="Map style"
        aria-label="Map style"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Layers size={18} strokeWidth={2} />
      </button>
      {isOpen && (
        <div className="map-style-options" role="menu" aria-label="Map styles">
          {(Object.entries(MAP_STYLES) as [MapStyleKey, (typeof MAP_STYLES)[MapStyleKey]][]).map(
            ([key, { label }]) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                onClick={async () => {
                  try {
                    const styleConfig = MAP_STYLES[key];
                    const style = await resolveMapStyle(styleConfig.style, styleConfig.attribution);
                    map.setStyle(style);
                  } catch (error) {
                    console.error('Failed to load map style', error);
                  }
                  setIsOpen(false);
                }}
              >
                {label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

class MapStyleControl implements IControl {
  private container?: HTMLDivElement;
  private root?: Root;

  onAdd(map: MaplibreMap): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-style-control';
    this.container.addEventListener('click', (event) => event.stopPropagation());
    this.root = createRoot(this.container);
    this.root.render(<MapStyleMenu map={map} />);

    return this.container;
  }

  onRemove(): void {
    const root = this.root;
    const container = this.container;
    this.root = undefined;
    this.container = undefined;

    queueMicrotask(() => {
      root?.unmount();
      container?.remove();
    });
  }
}

export function MapView() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const mapReadyRef = useRef(false);
  const markerRef = useRef<Marker | null>(null);
  const [iconsReady, setIconsReady] = useState(false);

  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  // const isPlaying = useFlightStore((s) => s.isPlaying);
  const seek = useFlightStore((s) => s.seek);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);

  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const setVisibleBounds = useFlightStore((s) => s.setVisibleBounds);

  const arrivalHeightFeatures = useArrivalHeightFeatures();
  const showArrivalHeights = useFlightStore((s) => s.showArrivalHeights);

  // ---- Map lifecycle ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: MAP_STYLES.osm.style,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new NavigationControl(), 'top-right');
    map.addControl(new MapStyleControl(), 'top-right');

    const closeAttribution = () => {
      const attribution = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      attribution?.classList.remove('maplibregl-compact-show');
      attribution?.querySelector('details')?.removeAttribute('open');
    };

    const publishBounds = () => {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      setVisibleBounds([sw.lng, sw.lat, ne.lng, ne.lat]);
    };

    map.once('load', () => {
      mapReadyRef.current = true;
      publishBounds();
      closeAttribution();
      void preloadMapIcons(map)
        .then(() => setIconsReady(true))
        .catch((err) => console.warn('[map] icon preload failed:', err));

      if (!map.hasImage('square')) {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 16, 16);
        
        map.addImage('square', ctx.getImageData(0, 0, 16, 16), { sdf: true });
      }

    });

    const restoreStyleAssets = () => {
      setIconsReady(false);
      void preloadMapIcons(map)
        .then(() => setIconsReady(true))
        .catch((err) => console.warn('[map] icon preload failed:', err));
    };
    map.on('style.load', restoreStyleAssets);
    map.on('moveend', publishBounds);

    return () => {
      map.off('style.load', restoreStyleAssets);
      map.off('moveend', publishBounds);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      mapReadyRef.current = false;
      setIconsReady(false);
    };
  }, [setVisibleBounds]);

  // ---- Overlays Track ----

    const trackGeoJSON = useMemo(
    () =>
      flight
        ? buildColoredTrackGeoJSON(flight, localCheckResult?.samples ?? null)
        : EMPTY_FEATURE_COLLECTION,
    [flight, localCheckResult],
  );

  const executeSeek = useCallback((lngLat: LngLat) => {
    const current = useFlightStore.getState().flight;
    if (!current) return;
    seek(nearestFixTimeMs(current, lngLat.lng, lngLat.lat));
  }, [seek]);

  const throttledHoverSeek = useMemo(
    () =>
      throttle((lngLat: LngLat) => {
        executeSeek(lngLat);
      }, THROTLLE_DELAY_MS),
    [executeSeek],
  );

  useEffect(() => {
    return () => {
      throttledHoverSeek.cancel();
    };
  }, [throttledHoverSeek]);

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

      map.on('click', TRACK_LAYER_ID, (e) => {
        if (e.lngLat) {
          executeSeek(e.lngLat);
        }
      }) ;

      map.on('mousemove', TRACK_LAYER_ID, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.lngLat) {
          throttledHoverSeek(e.lngLat);
        }
      }) ;
    },
  });

  // --- Overlay landing zones ---
  
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
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 0.5,  // À zoom 4 -> petite taille
            14, 2.5  // À zoom 14 -> plus grande
          ],
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
      // map.addLayer({
      //   id: LZ_LAYER_LABEL,
      //   type: 'symbol',
      //   source: LZ_SOURCE_ID,
      //   // Only show labels once zoomed in enough — with 100+ LZs, drawing
      //   // every name at low zoom is unreadable and 404s glyph ranges.
      //   minzoom: 10,
      //   layout: {
      //     'text-field': ['get', 'name'],
      //     // Pin the font stack to one the OpenFreeMap tile server actually
      //     // ships (otherwise MapLibre falls back to
      //     // "Open Sans Regular,Arial Unicode MS Regular" and 404s).
      //     'text-font': ['Noto Sans Regular'],
      //     'text-size': 10,
      //     'text-offset': [0, 1.8],
      //     'text-anchor': 'top',
      //     'text-optional': true,
      //     'text-allow-overlap': false,
      //   },
      //   paint: {
      //     'text-color': '#1e293b',
      //     'text-halo-color': '#ffffff',
      //     'text-halo-width': 1,
      //   },
      // });

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

  // --- Overlay arrival height ---

  const arrivalGeoJSON = useMemo(
    () => buildArrivalHeightsGeoJSON(arrivalHeightFeatures),   
    [showArrivalHeights, arrivalHeightFeatures],
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
        
        // Example text de couleur
        // layout: {                                                                                                                                             
        //   'text-field': ['get', 'label'],                                                                                                                     
        //   'text-font': ['Noto Sans Bold'],                                                                        
        //   'text-size': 11,                                                                                                                                    
        //   'text-offset': [0, -1.6],                                                                               
        //   'text-anchor': 'bottom',                                                                                                                            
        //   'text-allow-overlap': true,
        // },                                                                                                                                                    
        // paint: {                                                                                                  
        //   'text-color': [                    
        //     'match',                                                                                                                                          
        //     ['get', 'status'],
        //     'in-local', STATUS_COLORS['in-local'],                                                                                                            
        //     'in-local-marginal', STATUS_COLORS['in-local-marginal'],                                              
        //     'out-of-local', STATUS_COLORS['out-of-local'],                                                                                                    
        //     STATUS_COLORS['out-of-local'],
        //   ],                                                                                                                                                  
        //   'text-halo-color': '#ffffff',                                                                           
        //   'text-halo-width': 1.5,                                                                                                                             
        // },

        // Example rectangle as icon
        // layout: {
        //   // 1. Utilisation de l'icône comme fond sous le texte
        //   'icon-image': 'square', // Nom de l'image ajoutée à votre style/map
        //   'icon-text-fit': 'both', // Force l'icône à s'adapter à la taille du texte
        //   'icon-text-fit-padding': [4, 8, 4, 8], // Padding autour du texte [Haut, Droite, Bas, Gauche]
          
        //   // 2. Texte
        //   'text-field': ['get', 'label'],
        //   'text-font': ['Noto Sans Bold'],
        //   'text-size': 11,
        //   'text-anchor': 'bottom',
        //   'text-offset': [0, -1.6],  
        //   'text-allow-overlap': true,
        //   'text-ignore-placement': true,
        //   'icon-allow-overlap': true,
        //   'icon-ignore-placement': true,
        // },
        // paint: {
        //   // Couleur du fond via l'icône
        //   'icon-color': [
        //     'match',                                                                                                                                          
        //     ['get', 'status'],
        //     'in-local', STATUS_COLORS['in-local'],                                                                                                            
        //     'in-local-marginal', STATUS_COLORS['in-local-marginal'],                                              
        //     'out-of-local', STATUS_COLORS['out-of-local'],                                                                                                    
        //     STATUS_COLORS['out-of-local'],
        //   ],
        //   'text-color': '#ffffff' // Couleur du texte
        // }       

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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flight || flight.fixes.length === 0) return;

    const first = flight.fixes[0];
    const trackBbox = bufferBboxProportionally(boundingBoxOf(flight.fixes), TRACE_FIT_MARGIN_KM_PERCENTAGE);  
    const bounds = new LngLatBounds(
      [trackBbox[0], trackBbox[1]],
      [trackBbox[2], trackBbox[3]],
    );

    const centerMap = () => {
      map.fitBounds(bounds, { padding: 0, duration: 0 });
      if (!markerRef.current) {
        const el = document.createElement('div');
        el.className = 'glider-marker'; // 'h-16 w-16 text-blue-600';
        el.innerHTML = GLIDER_MARKER_SVG;
        el.style.cursor = 'pointer';

        markerRef.current = new Marker({ element: el, anchor: 'center' });
      }
      markerRef.current.setLngLat([first.longitude, first.latitude]).addTo(map);
    };

    if (map.isStyleLoaded() || mapReadyRef.current) {
      centerMap();
      return;
    }

    map.once('load', centerMap);

    return () => {
      map.off('load', centerMap);
    };
  }, [flight]);

    // Move the glider marker on every currentTimeMs change.
  useEffect(() => {
      if (!flight || !markerRef.current) return;
      const state = interpolateTrackState(flight, currentTimeMs);
      if (!state) return;

      //Update the coordinate of te glider mrker 
      markerRef.current.setLngLat(state.position);

      // and rotate it according to the heading
      // if (markerRef.current) {
      //   markerRef.current.style.transform = `rotate(${state.headingDeg}deg)`;
      markerRef.current.setRotation(state.headingDeg);
   
    }, [flight, currentTimeMs]);

  return (
    <>
        <div ref={containerRef} className="flex-1 min-h-0 w-full" />
    </>
  )
}

