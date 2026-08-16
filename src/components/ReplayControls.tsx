// import { useState } from 'react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { formatDuration } from '@/domain/units';
import { useFlightStore, type PlaybackSpeed } from '@/state/useFlightStore';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { flightTimeBounds } from '@/domain/flight';
import throttle from 'lodash/throttle';
import { useEffect, useMemo, useState } from 'react';
import { track } from '@/lib/analytics';


const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8, 16, 32];
const MAX_SEEK_INTERVAL_MS = 50;

export function ReplayControls() {
  const flight = useFlightStore((s) => s.flight);
  const isPlaying = useFlightStore((s) => s.isPlaying);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const playbackSpeed = useFlightStore((s) => s.playbackSpeed);

  const play = useFlightStore((s) => s.play);
  const pause = useFlightStore((s) => s.pause);
  const reset = useFlightStore((s) => s.reset);
  const seek = useFlightStore((s) => s.seek);
  const setSpeed = useFlightStore((s) => s.setSpeed);

  const firstFixTime = flight ? flightTimeBounds(flight).firstFixTimeMs : 0;
  const lastFixTime = flight ? flightTimeBounds(flight).lastFixTimeMs : 0;
  const totalMs = lastFixTime - firstFixTime;
  // const elapsedMs = currentTimeMs - firstFixTime;
  const storeElapsedMs = currentTimeMs - firstFixTime;

  // Local state to keep slider dragging smooth without triggering store updates
  const [localElapsedMs, setLocalElapsedMs] = useState<number>(storeElapsedMs);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Sync store updates into local state when not dragging (e.g. during replay playback)
  useEffect(() => {
    return useFlightStore.subscribe((state, previousState) => {
      if (!isDragging && state.currentTimeMs !== previousState.currentTimeMs) {
        setLocalElapsedMs(state.currentTimeMs - firstFixTime);
      }
    });
  }, [firstFixTime, isDragging]);

  const throttledSeek = useMemo(
    () => throttle((targetTimeMs: number) => seek(targetTimeMs), MAX_SEEK_INTERVAL_MS, {
      leading: true,
      trailing: true,
    }),
    [seek],
  );

  useEffect(() => {
    return () => throttledSeek.cancel();
  }, [throttledSeek]);

  const handlePointerUp = () => {
    throttledSeek.flush();
    throttledSeek.cancel();
    setIsDragging(false);
  };

  // if (!flight) return null;

  return (
    <>
        <div className="h-12 flex items-center gap-2 p-2">
            <Button 
                variant="secondary" 
                size="icon"
                onClick={() => {
                    if (isPlaying) {
                        pause();
                    } else {
                        track('replay_play');
                        play();
                    }
                }}
            >
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>

            <Button variant="outline" size="icon" onClick={reset}>
                <RotateCcw />
            </Button>

            <Select value={String(playbackSpeed) + "x"} onValueChange={(value) => {
                const speed = Number(value) as PlaybackSpeed;
                track('replay_speed_change', { speed });
                setSpeed(speed);
            }}>
              <SelectTrigger>
                <SelectValue placeholder="select the playback speed" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SPEEDS.map((speed) => (
                    <SelectItem key={speed} value={String(speed)}>
                      {speed}x
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <div className="min-w-0 flex-1 px-2 flex items-center" onPointerUp={handlePointerUp}>
              <Slider
                  key={firstFixTime}
                  min={0}
                  max={totalMs}
                  step={1000}
                  value={[isDragging ? localElapsedMs : storeElapsedMs]}
                  onValueChange={(value) => {
                    const nextValue = Array.isArray(value) ? (value[0] ?? 0) : value;
                    setIsDragging(true);
                    setLocalElapsedMs(nextValue);
                    throttledSeek(firstFixTime + nextValue);
                    // console.log(`Slider value changed: ${nextValue}ms, ${formatDuration(nextValue)}`);
                  }}

                  className="min-w-0 flex-1 px-2"
              />
            </div>

            <span className="font-mono text-sm tabular-nums">
                {formatDuration(isDragging ? localElapsedMs : storeElapsedMs)} / {formatDuration(totalMs)}
            </span>
        </div>
    </>
  )
}
