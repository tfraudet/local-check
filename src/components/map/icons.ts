/**
 * Inline SVG icon assets registered on the map via `map.addImage`, and
 * their registration helper.
 */

import type { Map as MaplibreMap } from 'maplibre-gl';
import { DIFFICULTY_LEVEL_COLOR } from '../../domain/landingZone';

export const LZ_ICON_SOLID = 'lz-icon-solid'; // SeeYou style 5 — solid airfield
export const LZ_ICON_GRASS = 'lz-icon-grass'; // SeeYou style 2 — grass airfield
export const LZ_ICON_RECT: Record<string, string> = {
  green: 'lz-icon-rect-green',
  orange: 'lz-icon-rect-orange',
  red: 'lz-icon-rect-red',
  black: 'lz-icon-rect-black',
};

/**
 * SDF pill used as the background for arrival-height labels. Because it
 * is SDF, `icon-color` recolors it at paint time — one image, all three
 * status variants driven by the `status` feature property.
 */
export const ARRIVAL_PILL_ICON = 'arrival-height-pill';

const SOLID_AIRFIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <circle cx="16" cy="16" r="11" fill="#3E6FC4"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#fff" stroke-width="8" transform="rotate(0 16 16)"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#3E6FC4" stroke-width="5" transform="rotate(0 16 16)"/>
</svg>`;

const GRASS_AIRFIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <circle cx="16" cy="16" r="9" fill="#fff" stroke="#5B6470" stroke-width="3.6"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#fff" stroke-width="6" transform="rotate(0 16 16)"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#5B6470" stroke-width="4" transform="rotate(0 16 16)"/>
</svg>`;

function squareSvg(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="20">
    <rect x="2" y="2" width="28" height="28" rx="2.5" ry="2.5" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
  </svg>`;
}

/**
 * Solid-white rounded rectangle used as the SDF background for
 * arrival-height labels. Only the alpha channel matters for SDF images;
 * `icon-color` recolours it at paint time. `viewBox` is deliberately small
 * so the border-radius stays visible after MapLibre stretches the icon to
 * fit its text via `icon-text-fit: 'both'`.
 */
const ARRIVAL_PILL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" width="60" height="20">
  <rect x="0" y="0" width="60" height="20" rx="6" ry="6" fill="#ffffff"/>
</svg>`;

async function svgToImage(svg: string): Promise<HTMLImageElement> {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * Register a single image, guarding against both a prior registration and
 * a concurrent one that completed while we were decoding.
 */
async function addImageOnce(
  map: MaplibreMap,
  id: string,
  svg: string,
  sdf = false,
): Promise<void> {
  if (map.hasImage(id)) return;
  const img = await svgToImage(svg);
  if (map.hasImage(id)) return;
  // pixelRatio 2 → the 32-unit SVG lands at ~16 CSS pixels on screen and
  // stays crisp on hi-DPI displays.
  map.addImage(id, img, { pixelRatio: 2, sdf });
}

/** Register all map icons. Idempotent — safe to call multiple times. */
export async function preloadMapIcons(map: MaplibreMap): Promise<void> {
  await Promise.all([
    addImageOnce(map, LZ_ICON_SOLID, SOLID_AIRFIELD_SVG),
    addImageOnce(map, LZ_ICON_GRASS, GRASS_AIRFIELD_SVG),
    ...Object.entries(LZ_ICON_RECT).map(([level, id]) =>
      addImageOnce(
        map,
        id,
        squareSvg(
          DIFFICULTY_LEVEL_COLOR[level as keyof typeof DIFFICULTY_LEVEL_COLOR],
        ),
      ),
    ),
    addImageOnce(map, ARRIVAL_PILL_ICON, ARRIVAL_PILL_SVG, true),
  ]);
}
