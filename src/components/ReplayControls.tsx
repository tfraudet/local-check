import { useTranslation } from 'react-i18next';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useFlightStore, type PlaybackSpeed } from '../state/useFlightStore';
import { formatDuration } from '../domain/units';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8, 16];

/**
 * Transport controls: play/pause, reset, speed selector, and a scrub
 * slider bound to the flight's time range (FR-M-14, FR-M-15, FR-M-16).
 */
export function ReplayControls() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);
  const isPlaying = useFlightStore((s) => s.isPlaying);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const playbackSpeed = useFlightStore((s) => s.playbackSpeed);
  const play = useFlightStore((s) => s.play);
  const pause = useFlightStore((s) => s.pause);
  const reset = useFlightStore((s) => s.reset);
  const seek = useFlightStore((s) => s.seek);
  const setSpeed = useFlightStore((s) => s.setSpeed);

  if (!flight) return null;

  const firstFixTime = flight.fixes[0].timeMs;
  const lastFixTime = flight.fixes[flight.fixes.length - 1].timeMs;
  const elapsedMs = currentTimeMs - firstFixTime;
  const totalMs = lastFixTime - firstFixTime;

  return (
    <div className="flex items-center gap-3 border-t bg-background p-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => (isPlaying ? pause() : play())}
        aria-label={isPlaying ? t('controls.pause') : t('controls.play')}
        title={isPlaying ? t('controls.pause') : t('controls.play')}
      >
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => reset()}
        aria-label={t('controls.reset')}
        title={t('controls.reset')}
      >
        <RotateCcw className="size-4" />
      </Button>

      <Select
        value={String(playbackSpeed)}
        onValueChange={(v) => setSpeed(Number(v) as PlaybackSpeed)}
      >
        <SelectTrigger className="w-24" aria-label={t('controls.speed')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPEEDS.map((speed) => (
            <SelectItem key={speed} value={String(speed)}>
              {speed}×
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-0 flex-1 px-2">
        <Slider
          min={firstFixTime}
          max={lastFixTime}
          step={1000}
          value={[currentTimeMs]}
          onValueChange={(v) => seek(Array.isArray(v) ? v[0] : v)}
          aria-label="Timeline scrub"
        />
      </div>

      <span className="font-mono text-sm tabular-nums">
        {formatDuration(elapsedMs)} / {formatDuration(totalMs)}
      </span>
    </div>
  );
}
