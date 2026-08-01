/**
 * HTML content for the landing-zone map popup.
 *
 * MapLibre popups take raw HTML rather than React nodes, so this builds a
 * string — but all user-facing text goes through i18n and all styling
 * lives in `index.css` (`.lz-popup__*`), so the popup follows the app
 * theme like every other surface.
 */

import type { TFunction } from 'i18next';
import { DIFFICULTY_LEVEL_COLOR } from '../../domain/landingZone';

/** SeeYou waypoint style codes → i18n key suffix. */
const LZ_STYLE_KEY: Record<number, string> = {
  0: 'unknown',
  1: 'waypoint',
  2: 'grassAirfield',
  3: 'outlandingField',
  4: 'glidingAirfield',
  5: 'solidAirfield',
  6: 'mountainPass',
  7: 'mountainTop',
  8: 'transmitterMast',
  9: 'vor',
  10: 'ndb',
  11: 'coolingTower',
  12: 'dam',
  13: 'tunnel',
  14: 'bridge',
  15: 'powerPlant',
  16: 'castle',
  17: 'intersection',
};

const AIRFIELD_CHIP_COLOR = '#3b82f6';
const OUTLANDING_CHIP_COLOR = '#64748b';

/** Escape a value for safe inclusion in an HTML string. */
function escHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const chip = (bg: string, text: string) =>
  `<span class="lz-popup__chip" style="background:${bg};">${escHtml(text)}</span>`;

const row = (label: string, value: string) =>
  `<b class="lz-popup__label">${escHtml(label)}</b><span>${escHtml(value)}</span>`;

export function buildLzPopupHtml(
  props: GeoJSON.GeoJsonProperties | null | undefined,
  t: TFunction,
): string {
  if (!props) return '';
  const p = props as Record<string, unknown>;

  const level = String(p.difficulty_level ?? 'green');
  const levelColor =
    DIFFICULTY_LEVEL_COLOR[level as keyof typeof DIFFICULTY_LEVEL_COLOR] ??
    DIFFICULTY_LEVEL_COLOR.green;
  const isAirfield = p.isAirfield === true || p.isAirfield === 'true';

  const chips = [
    chip(
      levelColor,
      t(`landingZones.difficulty.${level}`, level.toUpperCase()),
    ),
    isAirfield
      ? chip(AIRFIELD_CHIP_COLOR, t('landingZones.airfield'))
      : chip(OUTLANDING_CHIP_COLOR, t('landingZones.outlanding')),
  ];

  const rows: string[] = [];
  if (p.code) rows.push(row(t('landingZones.popup.code'), String(p.code)));

  if (typeof p.style === 'number') {
    const key = LZ_STYLE_KEY[p.style];
    rows.push(
      row(
        t('landingZones.popup.type'),
        key
          ? t(`landingZones.style.${key}`)
          : t('landingZones.popup.styleFallback', { style: p.style }),
      ),
    );
  }
  if (typeof p.elevationM === 'number') {
    rows.push(
      row(t('landingZones.popup.elevation'), `${Math.round(p.elevationM)} m`),
    );
  }
  if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
    rows.push(
      row(
        t('landingZones.popup.position'),
        `${p.latitude.toFixed(4)}°, ${p.longitude.toFixed(4)}°`,
      ),
    );
  }
  rows.push(
    row(
      t('landingZones.popup.source'),
      t(`landingZones.source.${String(p.source)}`, String(p.source)),
    ),
  );

  const description = p.description
    ? `<div class="lz-popup__description">${escHtml(p.description)}</div>`
    : '';

  return `
    <div class="lz-popup__body">
      <div class="lz-popup__title">${escHtml(p.name)}</div>
      <div class="lz-popup__chips">${chips.join('')}</div>
      <div class="lz-popup__rows">${rows.join('')}</div>
      ${description}
    </div>
  `;
}
