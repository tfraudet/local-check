import { useTranslation } from 'react-i18next';

import { SidebarGroup } from './ui/sidebar';
import { Separator } from './ui/separator';

import { useFlightStore } from '@/state/useFlightStore';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { REACHABLE_ZONE_CELL_CAP, REACHABLE_ZONE_GRID_SIZES, REACHABLE_ZONE_MAX_DIAMETER_KM, REACHABLE_ZONE_MIN_DIAMETER_KM, type ReachableZoneGridSizeM } from '@/domain/reachableZone';
import { LandingZonesPanel } from './LandingZonesPanel';

interface ParamRowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function ParamRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: ParamRowProps) {
  return (
    <div >
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium" title={hint}>
          {label}
        </label>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          className="w-16 rounded border border-border bg-background px-1 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={label}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer accent-primary"
        aria-label={label}
      />
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

export function SettingsPanel() {
  const { t } = useTranslation();
  const settings = useFlightStore((s) => s.settings);
  const setSettings = useFlightStore((s) => s.setSettings);
  const enabledSources = useFlightStore((s) => s.settings.enabledSources);
  const setSourceEnabled = useFlightStore((s) => s.setSourceEnabled);
  const result = useFlightStore((s) => s.reachableZoneResult);

  const update = (patch: Parameters<typeof setSettings>[0]) => {
    setSettings(patch);
  };

  return (
    <>
      {/* parameters for the local check algorithm */}
      <SidebarGroup className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          {t('settings.subTitle')}
        </p>

        <ParamRow
            label={t('settings.workingLD')}
            hint={t('settings.workingLDHint')}
            value={settings.workingLD}
            min={5}
            max={60}
            step={1}
            onChange={(v) => update({ workingLD: v })}
        />
        <ParamRow
            label={t('settings.arrivalHeight')}
            hint={t('settings.arrivalHeightHint')}
            value={settings.arrivalHeightM}
            min={0}
            max={1000}
            step={50}
            onChange={(v) => update({ arrivalHeightM: v })}
        />
        <ParamRow
            label={t('settings.groundClearance')}
            hint={t('settings.groundClearanceHint')}
            value={settings.groundClearanceM}
            min={0}
            max={500}
            step={25}
            onChange={(v) => update({ groundClearanceM: v })}
        />
        <ParamRow
            label={t('settings.timeStep')}
            hint={t('settings.timeStepHint')}
            value={settings.timeStepS}
            min={1}
            max={120}
            step={10}
            onChange={(v) => update({ timeStepS: v })}
        />
        <ParamRow
            label={t('settings.enlThreshold')}
            hint={t('settings.enlThresholdHint')}
            value={settings.enlThreshold}
            min={0}
            max={1000}
            step={50}
            onChange={(v) => update({ enlThreshold: v })}
        />
         <ToggleRow
          id="detect-final-glide"
          label={t('settings.detectFinalGlide')}
          hint={t('settings.detectFinalGlidedHint')}
          checked={settings.detectFinalGlide}
          onChange={(v) => update({ detectFinalGlide: v })}
        />
        <QnhRecalibrationRow />
      </SidebarGroup>

      <Separator />

      {/* oulanding fields sources */}
      <SidebarGroup className="space-y-3">
         <p className="text-xs font-medium text-muted-foreground">
          {t('settings.lzData')}
        </p>
        <ToggleRow
          id="show-outlanding-fields"
          label={t('settings.showOutlandingFields')}
          hint={t('settings.showOutlandingFieldsHint')}
          checked={enabledSources['outlanding-alps']}
          onChange={(v) => setSourceEnabled('outlanding-alps', v)}
        />
        <ToggleRow
          id="show-auvergne-fields"
          label={t('settings.showAuvergneFields')}
          hint={t('settings.showAuvergneFieldsHint')}
          checked={enabledSources['outlanding-auvergne']}
          onChange={(v) => setSourceEnabled('outlanding-auvergne', v)}
        />
      </SidebarGroup>
      <LandingZonesPanel />
      
      {/* <Separator /> */}
      
      {/* Hide/show on the map: Escape path,reachable zones & arrival height labels */}
      <SidebarGroup className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          {t('escapePath.title')} &amp; {t('reachableZone.title')}
        </p>
        <ToggleRow
          id="show-arrival-heights"
          label={t('arrivalHeights.toggle')}
          hint={t('arrivalHeights.toggleHint')}
          checked={settings.showArrivalHeights}
          onChange={(v) => update({ showArrivalHeights: v })}
        />
        <ToggleRow
          id="show-escape-path"
          label={t('escapePath.toggle')}
          hint={t('escapePath.toggleHint')}
          checked={settings.showEscapePath}
          onChange={(v) => update({ showEscapePath: v })}
        />
      </SidebarGroup>

      <SidebarGroup>
        <ToggleRow
          id="show-reachable-zone"
          label={t('reachableZone.toggle')}
          hint={t('reachableZone.toggleHint')}
          checked={settings.showReachableZone}
          onChange={(v) => update({ showReachableZone: v })}
        />
        {settings.showReachableZone && (
          <div className="space-y-2 pl-3 border-l">
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
                      update({
                        reachableZoneParams: {
                          ...settings.reachableZoneParams,
                          gridSizeM: size as ReachableZoneGridSizeM,
                        },
                      })
                    }
                    className={
                      'flex-1 rounded border px-2 py-1 text-xs transition ' +
                      (settings.reachableZoneParams.gridSizeM === size
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
                title={t('reachableZone.diameterHint')}
              >
                {t('reachableZone.diameter')}
              </label>
              <input
                type="number"
                min={REACHABLE_ZONE_MIN_DIAMETER_KM}
                max={REACHABLE_ZONE_MAX_DIAMETER_KM}
                step={10}
                value={settings.reachableZoneParams.diameterKm}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n)) {
                    update({
                      reachableZoneParams: {
                        ...settings.reachableZoneParams,
                        diameterKm: Math.max(
                          REACHABLE_ZONE_MIN_DIAMETER_KM,
                          Math.min(REACHABLE_ZONE_MAX_DIAMETER_KM, n),
                        ),
                      },
                    });
                  }
                }}
                className="w-16 rounded border border-border bg-background px-1 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label={t('reachableZone.diameter')}
              />
              </div>
              <input
                type="range"
                min={REACHABLE_ZONE_MIN_DIAMETER_KM}
                max={REACHABLE_ZONE_MAX_DIAMETER_KM}
                step={10}
                value={settings.reachableZoneParams.diameterKm}
                onChange={(e) =>
                  update({
                    reachableZoneParams: {
                      ...settings.reachableZoneParams,
                      diameterKm: parseFloat(e.target.value),
                    },
                  })
                }
                className="h-1 w-full cursor-pointer accent-primary"
                aria-label={t('reachableZone.diameter')}
              />

            </div>

            {result?.degraded && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                {t('reachableZone.degradedHint', {
                  cellCap: REACHABLE_ZONE_CELL_CAP.toLocaleString(),
                  gridSizeM: result.params.gridSizeM,
                  diameterKm: result.params.diameterKm,
                })}
              </p>
            )}

          </div>  
      )}

      </SidebarGroup>
     
      <Separator />

      <SidebarGroup>
        <ResetSettingsButton />
      </SidebarGroup>
    </>
  )
}

function QnhRecalibrationRow() {
  const { t } = useTranslation();
  const settings = useFlightStore((s) => s.settings);
  const setSettings = useFlightStore((s) => s.setSettings);
  const qnhOffsetM = useFlightStore((s) => s.flight?.qnhOffsetM ?? null);
  const qnhWarning = useFlightStore((s) => s.qnhWarning);

  return (
    <div className="space-y-1">
      <ToggleRow
        id="recalibrate-altitude"
        label={t('settings.recalibrateAltitude')}
        hint={t('settings.recalibrateAltitudeHint')}
        checked={settings.recalibrateAltitude}
        onChange={(v) => setSettings({ recalibrateAltitude: v })}
      />
      {settings.recalibrateAltitude && qnhOffsetM !== null && (
        <div
          className="flex items-center justify-between pl-3 text-[10px] text-muted-foreground"
          title={t('settings.qnhOffsetHint')}
        >
          <span>{t('settings.qnhOffsetLabel')}</span>
          <span className="font-mono tabular-nums">
            {qnhOffsetM >= 0 ? '+' : ''}
            {qnhOffsetM.toFixed(1)} m
          </span>
        </div>
      )}
      {settings.recalibrateAltitude && qnhWarning && (
        <p className="pl-3 text-[10px] text-amber-600 dark:text-amber-400">
          {qnhWarning}
        </p>
      )}
    </div>
  );
}

function ResetSettingsButton() {
  const { t } = useTranslation();
  const resetSettingsToDefaults = useFlightStore((s) => s.resetSettingsToDefaults);
  return (
    <Button
      // variant="outline"
      // size="sm"
      className="self-center"
      onClick={resetSettingsToDefaults}
    >
     {t('settings.resetToDefaults')}
    </Button>
  );
}