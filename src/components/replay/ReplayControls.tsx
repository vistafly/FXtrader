"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useReplayStore } from "@/stores/replayStore";

interface Props {
  /**
   * Current chart timeframe in minutes. Used to translate the user's chosen
   * step amount (also in minutes) into a bar count for the engine.
   * E.g. on a 5m chart with a 15m step, advance 3 bars.
   */
  timeframeMinutes: number;
  className?: string;
}

const STEP_OPTIONS: { label: string; minutes: number }[] = [
  { label: "1m", minutes: 1 },
  { label: "3m", minutes: 3 },
  { label: "5m", minutes: 5 },
  { label: "10m", minutes: 10 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
];

const SPEED_MIN = 1;
const SPEED_MAX = 16;

export function ReplayControls({ timeframeMinutes, className }: Props) {
  const isPlaying = useReplayStore((s) => s.isPlaying);
  const speed = useReplayStore((s) => s.speed);
  const stepMinutes = useReplayStore((s) => s.stepMinutes);
  const currentBarIndex = useReplayStore((s) => s.currentBarIndex);
  const totalBars = useReplayStore((s) => s.totalBars);
  const play = useReplayStore((s) => s.play);
  const pause = useReplayStore((s) => s.pause);
  const step = useReplayStore((s) => s.step);
  const setSpeed = useReplayStore((s) => s.setSpeed);
  const setStepMinutes = useReplayStore((s) => s.setStepMinutes);

  // Bars per step click. Floor-min-1 so the user can't get stuck at 0 if they
  // pick a step finer than the chart's timeframe.
  const stepCount = Math.max(1, Math.floor(stepMinutes / Math.max(1, timeframeMinutes)));

  const onStepBack = () => step("back", stepCount);
  const onStepForward = () => step("forward", stepCount);

  const currentStepLabel =
    STEP_OPTIONS.find((o) => o.minutes === stepMinutes)?.label ?? `${stepMinutes}m`;

  return (
    <div className={cn("flex items-center gap-3 py-1.5", className)}>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={onStepBack}
          disabled={currentBarIndex <= 0}
          aria-label={`Step back ${currentStepLabel}`}
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="default"
          onClick={() => (isPlaying ? pause() : play())}
          disabled={totalBars === 0 || currentBarIndex >= totalBars - 1}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onStepForward}
          disabled={currentBarIndex >= totalBars - 1}
          aria-label={`Step forward ${currentStepLabel}`}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      {/* Speed slider */}
      <div className="flex min-w-[140px] items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          spd
        </span>
        <Slider
          value={[speed]}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={1}
          onValueChange={(v) => setSpeed(v[0])}
          className="w-[100px]"
          aria-label="Replay speed"
        />
        <span className="w-8 font-mono text-xs tabular-nums text-foreground">
          {speed.toFixed(0)}×
        </span>
      </div>

      {/* Step-amount dropdown */}
      <Select
        value={String(stepMinutes)}
        onValueChange={(v) => setStepMinutes(Number(v))}
      >
        <SelectTrigger
          className="h-8 w-[78px] font-mono text-xs"
          aria-label="Step amount per ⏮/⏭ click"
        >
          <SelectValue>{currentStepLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STEP_OPTIONS.map((opt) => (
            <SelectItem key={opt.minutes} value={String(opt.minutes)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
