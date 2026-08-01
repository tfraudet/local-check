import { useTranslation } from 'react-i18next';
import { MapPin, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import type { DifficultyLevel } from '../domain/landingZone';
import { useFlightStore } from '../state/useFlightStore';
import { Badge } from './ui/badge';

const LEVEL_TEXT_CLASS: Record<DifficultyLevel, string> = {
  green: 'text-green-500',
  orange: 'text-orange-500',
  red: 'text-red-500',
  black: 'text-slate-900 dark:text-slate-100',
};

export function LandingZonesPanel() {
  const { t } = useTranslation();

  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const toggleVisibility = useFlightStore((s) => s.toggleLandingZoneVisibility);

  const airfieldCount = landingZones.filter((z) => z.isAirfield).length;
  const outlandingCount = landingZones.length - airfieldCount;

  return (
    <div className="space-y-2 max-w-56">
      {landingZones.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('landingZones.empty')}
        </p>
      ) : (
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            {t('landingZones.count_other', { count: landingZones.length })}
          </span>
          <div className="flex shrink-0 gap-1">
            {airfieldCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {airfieldCount} {t('landingZones.airfield')}
              </Badge>
            )}
            {outlandingCount > 0 && (
              <Badge variant="outline" className="text-xs">
                {outlandingCount} {t('landingZones.outlanding')}
              </Badge>
            )}
          </div>

          <ul className="max-h-64 overflow-y-scroll w-[calc(100%-10px)]">
            {landingZones.map((lz) => {
              const visible = visibleIds.has(lz.id);
              return (
                <li
                  key={lz.id}
                  className="flex min-w-0 items-center gap-1.5 rounded py-0.5 hover:bg-accent/30"
                >
                  <MapPin
                    className={cn(
                      'size-3 shrink-0',
                      LEVEL_TEXT_CLASS[lz.difficulty_level],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {lz.name}
                  </span>
                  <button
                    onClick={() => toggleVisibility(lz.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={visible ? 'Hide' : 'Show'}
                  >
                    {visible ? (
                      <Eye className="size-3" />
                    ) : (
                      <EyeOff className="size-3" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
