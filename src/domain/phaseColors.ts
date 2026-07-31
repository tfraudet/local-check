/**
 * Phase/status → hex color mapping shared between MapView and Barogram
 * (must match ColorLegend).
 */

import type { FlightPhase } from './flightPhases';
import type { LocalStatus } from './localCheck';

export const STATUS_COLORS = {
  'initial-climb': '#22d3ee', // cyan-400
  motor: '#0891b2', // cyan-600
  'in-local': '#22c55e', // green-500
  'in-local-marginal': '#eab308', // yellow-400
  'out-of-local': '#ef4444', // red-500
  'return-glide': '#60a5fa', // blue-400
  'landing-circuit': '#3b82f6', // blue-500
  default: '#2563eb', // blue-600 (no local check result)
} as const;

export function getSegmentColor(phase: FlightPhase, status: LocalStatus): string {
  if (phase === 'initial-climb') return STATUS_COLORS['initial-climb'];
  if (phase === 'motor') return STATUS_COLORS['motor'];
  if (phase === 'return-glide') return STATUS_COLORS['return-glide'];
  if (phase === 'landing-circuit') return STATUS_COLORS['landing-circuit'];
  if (status === 'out-of-local') return STATUS_COLORS['out-of-local'];
  if (status === 'in-local-marginal') return STATUS_COLORS['in-local-marginal'];
  if (status === 'in-local') return STATUS_COLORS['in-local'];
  return STATUS_COLORS['default'];
}
