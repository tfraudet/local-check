import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Upload, X, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseCup } from '../domain/parseCup';
import type { DifficultyLevel } from '../domain/landingZone';
import { useFlightStore } from '../state/useFlightStore';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';

const LEVEL_TEXT_CLASS: Record<DifficultyLevel, string> = {
  green: 'text-green-500',
  orange: 'text-orange-500',
  red: 'text-red-500',
  black: 'text-slate-900 dark:text-slate-100',
};

export function LandingZonesPanel() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [parseErrors, setParseErrors] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const addLandingZones = useFlightStore((s) => s.addLandingZones);
  const clearLandingZones = useFlightStore((s) => s.clearLandingZones);
  const toggleVisibility = useFlightStore((s) => s.toggleLandingZoneVisibility);
  const runLocalCheck = useFlightStore((s) => s.runLocalCheck);

  const loadCupFile = async (file: File) => {
    setParseErrors(null);
    const text = await file.text();
    const result = parseCup(text);
    addLandingZones(result.zones);
    if (!result.ok && result.errors.length > 0) {
      setParseErrors(t('landingZones.errorLines', { count: result.errors.length }));
    }
    if (result.zones.length > 0) {
      void runLocalCheck();
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadCupFile(file);
    e.target.value = '';
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadCupFile(file);
  };

  const airfieldCount = landingZones.filter((z) => z.isAirfield).length;
  const outlandingCount = landingZones.length - airfieldCount;

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t('landingZones.dragHint')}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center transition-colors',
          isDragActive
            ? 'border-primary bg-accent/50'
            : 'border-border hover:bg-accent/30',
        )}
      >
        <Upload className="size-3.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{t('landingZones.dragHint')}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".cup"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Error */}
      {parseErrors && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>{t('landingZones.errorTitle')}</AlertTitle>
          <AlertDescription>{parseErrors}</AlertDescription>
        </Alert>
      )}

      {/* Zone list */}
      {landingZones.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('landingZones.empty')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t('landingZones.count_other', { count: landingZones.length })}
            </span>
            <div className="flex gap-1">
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
          </div>

          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {landingZones.map((lz) => {
              const visible = visibleIds.has(lz.id);
              return (
                <li
                  key={lz.id}
                  className="flex items-center justify-between gap-1 rounded px-1 py-0.5 hover:bg-accent/30"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <MapPin
                      className={cn(
                        'size-3 shrink-0',
                        LEVEL_TEXT_CLASS[lz.difficulty_level],
                      )}
                    />
                    <span className="truncate text-xs">{lz.name}</span>
                  </div>
                  <button
                    onClick={() => toggleVisibility(lz.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={visible ? 'Hide' : 'Show'}
                  >
                    {visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => clearLandingZones()}
            className="flex w-full items-center justify-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <X className="size-3" />
            {t('landingZones.clear')}
          </button>
        </>
      )}
    </div>
  );
}
