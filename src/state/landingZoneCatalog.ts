/**
 * Landing-zone catalog bookkeeping for the flight store.
 *
 * The store keeps zones twice: a per-source cache (so toggling a source
 * off and back on doesn't re-fetch) and the flattened, deduplicated
 * "active" list the UI renders. The merge rules live here so the store
 * action stays a thin setter.
 */

import {
  createProximityIndex,
  CROSS_SOURCE_DEDUP_THRESHOLD_M,
  type LandingZone,
  type LandingZoneSource,
} from '../domain/landingZone';

export type ZonesBySource = Partial<Record<LandingZoneSource, LandingZone[]>>;

/** Sources the user can switch off. Anything not listed is always on. */
export const TOGGLEABLE_SOURCES = [
  'outlanding-alps',
  'outlanding-auvergne',
] as const satisfies readonly LandingZoneSource[];

export type ToggleableSource = (typeof TOGGLEABLE_SOURCES)[number];

export type SourceToggles = Record<ToggleableSource, boolean>;

export const DEFAULT_SOURCE_TOGGLES: SourceToggles = {
  'outlanding-alps': false,
  'outlanding-auvergne': false,
};

function isSourceEnabled(
  source: LandingZoneSource,
  toggles: SourceToggles,
): boolean {
  return source in toggles ? toggles[source as ToggleableSource] : true; // 'user' imports and OpenAIP are always on
}

/** Merge `incoming` into the per-source cache, replacing entries with the
 * same id. Returns a new object; the input is not mutated. */
export function mergeZonesBySource(
  bySource: ZonesBySource,
  incoming: readonly LandingZone[],
): ZonesBySource {
  const next: ZonesBySource = {};
  for (const [src, arr] of Object.entries(bySource)) {
    if (arr) next[src as LandingZoneSource] = [...arr];
  }

  for (const zone of incoming) {
    const bucket = (next[zone.source] ??= []);
    const idx = bucket.findIndex((b) => b.id === zone.id);
    if (idx >= 0) bucket[idx] = zone;
    else bucket.push(zone);
  }
  return next;
}

/**
 * Flatten the per-source cache into the active list.
 *
 * OpenAIP entries are authoritative: any zone from another source within
 * `CROSS_SOURCE_DEDUP_THRESHOLD_M` of an OpenAIP zone is dropped, so
 * imported .cup airfields don't shadow the canonical OpenAIP record.
 */
export function computeActiveZones(
  bySource: ZonesBySource,
  toggles: SourceToggles,
): LandingZone[] {
  const openaipZones = bySource['openaip'] ?? [];
  const openaipIndex = createProximityIndex(
    openaipZones,
    CROSS_SOURCE_DEDUP_THRESHOLD_M,
  );

  const active: LandingZone[] = [...openaipZones];
  for (const [src, zones] of Object.entries(bySource)) {
    if (!zones || src === 'openaip') continue;
    if (!isSourceEnabled(src as LandingZoneSource, toggles)) continue;
    for (const zone of zones) {
      if (!openaipIndex.findNear(zone.latitude, zone.longitude)) {
        active.push(zone);
      }
    }
  }
  return active;
}
