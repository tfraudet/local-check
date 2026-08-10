/**
 * Pure GeoJSON builders for every map overlay. Kept free of MapLibre and
 * React imports so they stay trivially testable.
 */

import type { NormalizedFlight } from '../../domain/flight';
import { STATUS_COLORS, getSegmentColor } from '../../domain/phaseColors';
import type { SampledPoint } from '../../domain/localCheck';
import type { LandingZone } from '../../domain/landingZone';
import { DIFFICULTY_LEVEL_COLOR } from '../../domain/landingZone';

import type { LocalStatus } from '../../domain/arrival';
import type { EscapePath } from '@/domain/escapePath';
// import type { ReachableZoneResult } from '../../domain/reachableZone';

const EMPTY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Build a FeatureCollection of colored line segments from the fixes and
 * local-check samples. Consecutive fixes with the same color are merged
 * into a single LineString feature.
 */
export function buildColoredTrackGeoJSON(
  flight: NormalizedFlight,
  samples: SampledPoint[] | null,
): GeoJSON.FeatureCollection {
  const fixes = flight.fixes;
  if (!samples || samples.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { color: STATUS_COLORS['default'] },
          geometry: {
            type: 'LineString',
            coordinates: fixes.map((f) => [f.longitude, f.latitude]),
          },
        },
      ],
    };
  }

  // Assign each fix the color of the latest sample at or before it, using a
  // sliding pointer for efficiency. This keeps a status transition at the
  // exact sample fix instead of moving it to the midpoint between samples.
  const colors: string[] = new Array(fixes.length).fill(
    STATUS_COLORS['default'],
  );
  let sampleIdx = 0;
  for (let i = 0; i < fixes.length; i++) {
    while (
      sampleIdx < samples.length - 1 &&
      samples[sampleIdx + 1].timeMs <= fixes[i].timeMs
    ) {
      sampleIdx++;
    }
    const s = samples[sampleIdx];
    colors[i] = getSegmentColor(s.phase, s.status);
  }

  // Group consecutive fixes with the same color into segments.
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  let segStart = 0;
  let segColor = colors[0];

  for (let i = 1; i < fixes.length; i++) {
    const color = colors[i];
    if (color !== segColor || i === fixes.length - 1) {
      const end = i === fixes.length - 1 && color === segColor ? i : i - 1;
      if (end >= segStart) {
        features.push({
          type: 'Feature',
          properties: { color: segColor },
          geometry: {
            type: 'LineString',
            coordinates: fixes
              .slice(segStart, end + 2)
              .map((f) => [f.longitude, f.latitude]),
          },
        });
      }
      segStart = i;
      segColor = color;
    }
  }

  if (segStart < fixes.length - 1) {
    features.push({
      type: 'Feature',
      properties: { color: segColor },
      geometry: {
        type: 'LineString',
        coordinates: fixes
          .slice(segStart)
          .map((f) => [f.longitude, f.latitude]),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function buildLzGeoJSON(
  zones: LandingZone[],
  visibleIds: Set<string>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones
      .filter((z) => visibleIds.has(z.id))
      .map((z) => ({
        type: 'Feature' as const,
        properties: {
          id: z.id,
          name: z.name,
          code: z.code ?? '',
          isAirfield: z.isAirfield,
          difficulty_level: z.difficulty_level,
          elevationM: z.elevationM ?? '',
          style: z.style ?? '',
          description: z.description ?? '',
          source: z.source,
          latitude: z.latitude,
          longitude: z.longitude,
          runwayHeading: z.runwayHeading,
          color: DIFFICULTY_LEVEL_COLOR[z.difficulty_level],
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [z.longitude, z.latitude],
        },
      })),
  };
}

export interface ArrivalHeightFeature {
  id: string;
  latitude: number;
  longitude: number;
  arrivalHeightM: number;
  status: LocalStatus;
}

export function buildArrivalHeightsGeoJSON(
  features: ArrivalHeightFeature[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => {
      const rounded = Math.round(f.arrivalHeightM);
      return {
        type: 'Feature',
        properties: {
          id: f.id,
          arrivalHeightM: rounded,
          label: `${rounded >= 0 ? '+' : ''}${rounded} m`,
          status: f.status,
        },
        geometry: {
          type: 'Point',
          coordinates: [f.longitude, f.latitude],
        },
      };
    }),
  };
}

export function buildEscapePathGeoJSON(
  escapePath: EscapePath | null,
): GeoJSON.FeatureCollection {
  if (!escapePath) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          color: STATUS_COLORS[escapePath.status],
          status: escapePath.status,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [escapePath.sourceLon, escapePath.sourceLat],
            [escapePath.lzLon, escapePath.lzLat],
          ],
        },
      },
    ],
  };
}

/*


export function buildReachableZoneGeoJSON(
  result: ReachableZoneResult | null,
): GeoJSON.FeatureCollection {
  if (!result) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: result.cellPolygons.map((ring) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [ring],
      },
    })),
  };
}


*/