import { getInstrument } from "./instruments";

/**
 * v2.2.6b: weekly session-hours rules for the closed-market overlay.
 *
 * All times are evaluated in UTC. Daylight-savings shifts are NOT modeled —
 * the simulator uses UTC throughout and the overlay treats the window as
 * fixed year-round. This drifts by ±1 hour vs. the real exchange clock
 * during DST changeovers; acceptable trade-off for a replay simulator
 * (the bar dataset is already the source of truth for actual trading
 * activity; this overlay is purely a calendar hint).
 *
 * Returns `undefined` when the instrument has no `sessionHours` preset —
 * defensive fallback so the overlay never falsely shows "closed" on an
 * instrument the metadata doesn't cover.
 */

interface WeeklyWindow {
  /** Day-of-week (0=Sun … 6=Sat) the market opens. */
  openDow: number;
  /** UTC hour the market opens on `openDow`. */
  openHour: number;
  /** Day-of-week the market closes. */
  closeDow: number;
  /** UTC hour the market closes on `closeDow`. */
  closeHour: number;
}

const PRESETS: Record<string, WeeklyWindow> = {
  // Sun 22:00 UTC → Fri 22:00 UTC.
  forex: { openDow: 0, openHour: 22, closeDow: 5, closeHour: 22 },
  // Sun 23:00 UTC → Fri 22:00 UTC. (CME daily 22:00–23:00 UTC weekday
  // maintenance break is intentionally not modeled.)
  "cme-futures": { openDow: 0, openHour: 23, closeDow: 5, closeHour: 22 },
};

/**
 * Returns true/false if the instrument's market is open at the given UTC
 * unix-second timestamp; returns `undefined` when no session-hours preset
 * is configured for the instrument.
 */
export function isMarketOpen(
  symbol: string,
  timeSec: number,
): boolean | undefined {
  const preset = getPreset(symbol);
  if (!preset) return undefined;
  return inWindow(timeSec, preset);
}

/**
 * Returns the next open-time as a UTC unix-second timestamp, or
 * `undefined` if the market is currently open (no waiting required) or
 * the instrument has no preset.
 */
export function nextMarketOpen(
  symbol: string,
  timeSec: number,
): number | undefined {
  const preset = getPreset(symbol);
  if (!preset) return undefined;
  if (inWindow(timeSec, preset)) return undefined;

  // Walk forward at most 7 days to find the next open boundary.
  const date = new Date(timeSec * 1000);
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const probe = new Date(date);
    probe.setUTCDate(date.getUTCDate() + dayOffset);
    if (probe.getUTCDay() !== preset.openDow) continue;
    probe.setUTCHours(preset.openHour, 0, 0, 0);
    const probeSec = Math.floor(probe.getTime() / 1000);
    if (probeSec > timeSec) return probeSec;
  }
  return undefined;
}

function getPreset(symbol: string): WeeklyWindow | undefined {
  // getInstrument throws on unknown symbols; the overlay path may run
  // before instrument metadata is wired (early renders), so swallow.
  let inst;
  try {
    inst = getInstrument(symbol);
  } catch {
    return undefined;
  }
  if (!inst.sessionHours) return undefined;
  return PRESETS[inst.sessionHours];
}

/**
 * Window-membership check for a single weekly open→close interval that
 * may wrap past Saturday. Encoded as "minutes since Sunday 00:00 UTC".
 */
function inWindow(timeSec: number, w: WeeklyWindow): boolean {
  const date = new Date(timeSec * 1000);
  const minutesIntoWeek =
    date.getUTCDay() * 24 * 60 +
    date.getUTCHours() * 60 +
    date.getUTCMinutes();
  const openMinutes = w.openDow * 24 * 60 + w.openHour * 60;
  const closeMinutes = w.closeDow * 24 * 60 + w.closeHour * 60;
  if (openMinutes <= closeMinutes) {
    // Non-wrapping window: e.g. Mon 00:00 → Fri 22:00.
    return minutesIntoWeek >= openMinutes && minutesIntoWeek < closeMinutes;
  }
  // Wrapping window (forex/CME): open Sun → close Fri across the week
  // boundary. With openDow=0 and closeDow=5 the window does NOT wrap;
  // this branch is here for completeness in case future presets do.
  return minutesIntoWeek >= openMinutes || minutesIntoWeek < closeMinutes;
}
