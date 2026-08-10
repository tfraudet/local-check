import { useEffect, useRef, type RefObject } from 'react';
import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { useLatestRef } from '@/hooks/useLatestRef';

export interface GeoJsonLayerOptions {
  sourceId: string;
  /** Data for the source. Rebuild it with `useMemo` so the effect only
   * re-runs when the content actually changes. */
  data: FeatureCollection;
  /**
   * Called exactly once, right after the source is added, to register the
   * layers and any event handlers that belong to it.
   */
  addLayers: (map: MaplibreMap) => void;
  /** Skip entirely while false (e.g. until the icon sprites are ready). */
  enabled?: boolean;
}

/**
 * Attach a GeoJSON source (plus its layers) to a MapLibre map and keep it
 * in sync with `data`.
 *
 * Every overlay needs the same three-step dance, so it lives here once:
 *
 *  1. If the source already exists, call `setData` **directly** — never
 *     defer to `map.once('load')`, which fires only once per map lifecycle
 *     and would silently drop later updates.
 *  2. Otherwise add the source/layers as soon as the style is loaded.
 *  3. When the style is not loaded yet, retry on `idle` rather than
 *     `load`: `isStyleLoaded()` can transiently return false after the
 *     initial load, and a `once('load')` fallback would then never fire.
 */
export function useGeoJsonLayer(
  mapRef: RefObject<MaplibreMap | null>,
  { sourceId, data, addLayers, enabled = true }: GeoJsonLayerOptions,
): void {
  // Kept in a ref so callers can pass an inline callback without forcing
  // the effect to re-run on every render.
  const addLayersRef = useLatestRef(addLayers);
  const dataRef = useLatestRef(data);
  const updateFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enabled) return;

    const addSourceAndLayers = () => {
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (source) return;

      map.addSource(sourceId, { type: 'geojson', data: dataRef.current });
      addLayersRef.current(map);
    };

    const applyAfterStyleLoad = () => {
      addSourceAndLayers();
    };

    const onStyleLoad = () => {
      map.once('idle', applyAfterStyleLoad);
    };

    map.on('style.load', onStyleLoad);

    if (map.isStyleLoaded()) {
      addSourceAndLayers();
    } else {
      const onIdle = () => {
        map.off('idle', onIdle);
        addSourceAndLayers();
      };
      map.on('idle', onIdle);

      return () => {
        map.off('style.load', onStyleLoad);
        map.off('idle', onIdle);
        map.off('idle', applyAfterStyleLoad);
      };
    }

    return () => {
      map.off('style.load', onStyleLoad);
      map.off('idle', applyAfterStyleLoad);
    };
  }, [mapRef, sourceId, enabled, addLayersRef, dataRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enabled) return;

    if (updateFrameRef.current !== null) return;

    updateFrameRef.current = requestAnimationFrame(() => {
      updateFrameRef.current = null;
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      source?.setData(dataRef.current);
    });
  }, [mapRef, sourceId, data, enabled, dataRef]);

  useEffect(() => {
    return () => {
      if (updateFrameRef.current !== null) {
        cancelAnimationFrame(updateFrameRef.current);
        updateFrameRef.current = null;
      }
    };
  }, []);
}
