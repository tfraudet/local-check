import { useTranslation } from 'react-i18next';

import { SidebarGroup } from './ui/sidebar';
import { Separator } from './ui/separator';

import { useFlightStore } from '@/state/useFlightStore';
import { Switch } from './ui/switch';
import { Button } from './ui/button';

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

  const showEscapePath = useFlightStore((s) => s.showEscapePath);
  const setShowEscapePath = useFlightStore((s) => s.setShowEscapePath);
  const showReachableZone = useFlightStore((s) => s.showReachableZone);
  const setShowReachableZone = useFlightStore((s) => s.setShowReachableZone);
  const showArrivalHeights = useFlightStore((s) => s.showArrivalHeights);
  const setShowArrivalHeights = useFlightStore((s) => s.setShowArrivalHeights);


  // const runLocalCheck = useFlightStore((s) => s.runLocalCheck);

  const update = (patch: Parameters<typeof setSettings>[0]) => {
    setSettings(patch);

    // Debounce: use a small timeout so rapid slider drags don't thrash the worker.
    // The timeout ref lives outside this render; a simple approach is to just
    // let runLocalCheck guard on preconditions internally.
    //void runLocalCheck();
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
      
      <Separator />
      
      {/* Hide/show on the map: Escape path,reachable zones & arrival height labels */}
      <SidebarGroup className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          {t('escapePath.title')} &amp; {t('reachableZone.title')}
        </p>
        <ToggleRow
          id="show-arrival-heights"
          label={t('arrivalHeights.toggle')}
          hint={t('arrivalHeights.toggleHint')}
          checked={showArrivalHeights}
          onChange={setShowArrivalHeights}
        />
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
      </SidebarGroup>

      <SidebarGroup>
        <ResetSettingsButton />
      </SidebarGroup>
    </>
  )
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