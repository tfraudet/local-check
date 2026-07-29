/**
 * ENL / MOP (Engine Noise Level / Means of Propulsion) motor-use detection.
 *
 * IGC files may include extension fields per the IGC B-record extensions
 * specification. igc-parser surfaces these as `extensions` on each fix.
 * This module extracts ENL/MOP values and applies a threshold.
 */

import type { Fix } from './flight';

/**
 * Returns a parallel array (same length as `fixes`) where each entry is
 * `true` if the motor is considered running at that fix.
 *
 * When the IGC file has no ENL/MOP extension, every entry is `false`.
 */
export function detectMotorUse(fixes: Fix[], enlThreshold: number): boolean[] {
  return fixes.map((fix) => {
    const enl = getEnlValue(fix);
    return enl !== null && enl >= enlThreshold;
  });
}

/**
 * Extract ENL or MOP value from a fix.
 *
 * igc-parser puts extension values on `fix.extensions` (if available).
 * We cast to any since the igc-parser types vary across versions.
 */
function getEnlValue(fix: Fix): number | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = (fix as any).extensions as Record<string, number> | undefined;
  if (!ext) return null;
  // Try common field names
  const enl = ext['ENL'] ?? ext['enl'] ?? ext['MOP'] ?? ext['mop'] ?? null;
  return typeof enl === 'number' ? enl : null;
}
