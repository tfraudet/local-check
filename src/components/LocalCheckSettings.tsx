import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { useFlightStore } from '../state/useFlightStore';
import { DEFAULT_LOCAL_CHECK_PARAMS } from '../domain/localCheck';
import { LandingZonesPanel } from './LandingZonesPanel';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Switch } from './ui/switch';

interface ParamRowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function ParamRow({ label, hint, value, min, max, step, onChange }: ParamRowProps) {
  return (
    <div className="space-y-1">
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

export function LocalCheckSettings() {
  const { t } = useTranslation();
  const params = useFlightStore((s) => s.localCheckParams);
  const setLocalCheckParams = useFlightStore((s) => s.setLocalCheckParams);
  const runLocalCheck = useFlightStore((s) => s.runLocalCheck);
  const isComputing = useFlightStore((s) => s.isComputingLocalCheck);
  const showOutlandingFields = useFlightStore((s) => s.showOutlandingFields);
  const setShowOutlandingFields = useFlightStore((s) => s.setShowOutlandingFields);
  const showAuvergneFields = useFlightStore((s) => s.showAuvergneFields);
  const setShowAuvergneFields = useFlightStore((s) => s.setShowAuvergneFields);
  const flight = useFlightStore((s) => s.flight);
  const elevationLoadError = useFlightStore((s) => s.elevationLoadError);

  const update = (patch: Parameters<typeof setLocalCheckParams>[0]) => {
    setLocalCheckParams(patch);
    // Debounce: use a small timeout so rapid slider drags don't thrash the worker.
    // The timeout ref lives outside this render; a simple approach is to just
    // let runLocalCheck guard on preconditions internally.
    void runLocalCheck();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {t('localCheck.settings.title')}
        </p>
        {isComputing && (
          <span className="text-xs text-muted-foreground">{t('localCheck.computing')}</span>
        )}
      </div>

      <ParamRow
        label={t('localCheck.settings.workingLD')}
        hint={t('localCheck.settings.workingLDHint')}
        value={params.workingLD}
        min={5}
        max={60}
        step={1}
        onChange={(v) => update({ workingLD: v })}
      />
      <ParamRow
        label={t('localCheck.settings.arrivalHeight')}
        hint={t('localCheck.settings.arrivalHeightHint')}
        value={params.arrivalHeightM}
        min={0}
        max={1000}
        step={50}
        onChange={(v) => update({ arrivalHeightM: v })}
      />
      <ParamRow
        label={t('localCheck.settings.groundClearance')}
        hint={t('localCheck.settings.groundClearanceHint')}
        value={params.groundClearanceM}
        min={0}
        max={500}
        step={25}
        onChange={(v) => update({ groundClearanceM: v })}
      />
      <ParamRow
        label={t('localCheck.settings.timeStep')}
        hint={t('localCheck.settings.timeStepHint')}
        value={params.timeStepS}
        min={10}
        max={120}
        step={10}
        onChange={(v) => update({ timeStepS: v })}
      />
      <ParamRow
        label={t('localCheck.settings.enlThreshold')}
        hint={t('localCheck.settings.enlThresholdHint')}
        value={params.enlThreshold}
        min={0}
        max={1000}
        step={50}
        onChange={(v) => update({ enlThreshold: v })}
      />

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          setLocalCheckParams(DEFAULT_LOCAL_CHECK_PARAMS);
          void runLocalCheck();
        }}
      >
        Reset to defaults
      </Button>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t('localCheck.settings.dataGroup')}
        </p>
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="show-outlanding-fields"
            className="text-xs font-medium"
            title={t('localCheck.settings.showOutlandingFieldsHint')}
          >
            {t('localCheck.settings.showOutlandingFields')}
          </label>
          <Switch
            id="show-outlanding-fields"
            checked={showOutlandingFields}
            onCheckedChange={setShowOutlandingFields}
            aria-label={t('localCheck.settings.showOutlandingFields')}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="show-auvergne-fields"
            className="text-xs font-medium"
            title={t('localCheck.settings.showAuvergneFieldsHint')}
          >
            {t('localCheck.settings.showAuvergneFields')}
          </label>
          <Switch
            id="show-auvergne-fields"
            checked={showAuvergneFields}
            onCheckedChange={setShowAuvergneFields}
            aria-label={t('localCheck.settings.showAuvergneFields')}
          />
        </div>

        {flight && elevationLoadError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t('errors.title')}</AlertTitle>
            <AlertDescription>{t('errors.elevation.fetchFailed')}</AlertDescription>
          </Alert>
        )}

        <LandingZonesPanel />
      </div>
    </div>
  );
}
