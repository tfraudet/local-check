import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import {
  REACHABLE_ZONE_CELL_CAP,
  REACHABLE_ZONE_GRID_SIZES,
  REACHABLE_ZONE_MAX_EXTENT_KM,
  REACHABLE_ZONE_MIN_EXTENT_KM,
  type ReachableZoneGridSizeM,
} from '../domain/reachableZone';
import { Switch } from './ui/switch';

/**
 * Phase 3 sidebar section: toggles for escape-path / reachable-zone /
 * arrival-height overlays, plus grid-size and extent controls for the
 * reachable zone. Values persist via the store's persist middleware.
 */
export function ReachableZoneSettings() {
  const { t } = useTranslation();

  const showEscapePath = useFlightStore((s) => s.showEscapePath);
  const setShowEscapePath = useFlightStore((s) => s.setShowEscapePath);
  const showReachableZone = useFlightStore((s) => s.showReachableZone);
  const setShowReachableZone = useFlightStore((s) => s.setShowReachableZone);
  const showArrivalHeights = useFlightStore((s) => s.showArrivalHeights);
  const setShowArrivalHeights = useFlightStore((s) => s.setShowArrivalHeights);
  const reachableZoneParams = useFlightStore((s) => s.reachableZoneParams);
  const setReachableZoneParams = useFlightStore(
    (s) => s.setReachableZoneParams,
  );
  const result = useFlightStore((s) => s.reachableZoneResult);
  const isComputing = useFlightStore((s) => s.isComputingReachableZone);

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t('escapePath.title')} &amp; {t('reachableZone.title')}
      </p>

      <ToggleRow
        id="show-escape-path"
        label={t('escapePath.toggle')}
        hint={t('escapePath.toggleHint')}
        checked={showEscapePath}
        onChange={setShowEscapePath}
      />
      <ToggleRow
        id="show-reachable-zone"
        label={t('reachableZone.toggle')}
        hint={t('reachableZone.toggleHint')}
        checked={showReachableZone}
        onChange={setShowReachableZone}
      />
      <ToggleRow
        id="show-arrival-heights"
        label={t('arrivalHeights.toggle')}
        hint={t('arrivalHeights.toggleHint')}
        checked={showArrivalHeights}
        onChange={setShowArrivalHeights}
      />

      {showReachableZone && (
        <div className="space-y-2 border-l pl-2">
          <div className="space-y-1">
            <label
              className="text-xs font-medium"
              title={t('reachableZone.gridSizeHint')}
            >
              {t('reachableZone.gridSize')}
            </label>
            <div className="flex gap-1">
              {REACHABLE_ZONE_GRID_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() =>
                    setReachableZoneParams({
                      gridSizeM: size as ReachableZoneGridSizeM,
                    })
                  }
                  className={
                    'flex-1 rounded border px-2 py-1 text-xs transition ' +
                    (reachableZoneParams.gridSizeM === size
                      ? 'border-primary bg-primary/10 font-semibold'
                      : 'border-border hover:bg-accent/40')
                  }
                >
                  {size} m
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label
                className="text-xs font-medium"
                title={t('reachableZone.extentHint')}
              >
                {t('reachableZone.extent')}
              </label>
              <input
                type="number"
                min={REACHABLE_ZONE_MIN_EXTENT_KM}
                max={REACHABLE_ZONE_MAX_EXTENT_KM}
                step={5}
                value={reachableZoneParams.extentKm}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n)) {
                    setReachableZoneParams({
                      extentKm: Math.max(
                        REACHABLE_ZONE_MIN_EXTENT_KM,
                        Math.min(REACHABLE_ZONE_MAX_EXTENT_KM, n),
                      ),
                    });
                  }
                }}
                className="w-16 rounded border border-border bg-background px-1 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label={t('reachableZone.extent')}
              />
            </div>
            <input
              type="range"
              min={REACHABLE_ZONE_MIN_EXTENT_KM}
              max={REACHABLE_ZONE_MAX_EXTENT_KM}
              step={5}
              value={reachableZoneParams.extentKm}
              onChange={(e) =>
                setReachableZoneParams({ extentKm: parseFloat(e.target.value) })
              }
              className="h-1 w-full cursor-pointer accent-primary"
              aria-label={t('reachableZone.extent')}
            />
          </div>

          {isComputing && (
            <p className="text-[10px] text-muted-foreground">
              {t('reachableZone.computing')}
            </p>
          )}

          {result?.degraded && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              {t('reachableZone.degradedHint', {
                cellCap: REACHABLE_ZONE_CELL_CAP.toLocaleString(),
                gridSizeM: result.params.gridSizeM,
                extentKm: result.params.extentKm,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ id, label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-xs font-medium" title={hint}>
        {label}
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}
