export type SessionStatus = "active" | "paused" | "ended";
/**
 * Multiplier on the base 1-bar-per-second tick rate. The slider in
 * ReplayControls allows continuous values 1–16; the engine accepts any
 * positive number.
 */
export type SpeedSetting = number;

export interface Session {
  id: string;
  name: string;
  /** v1: single-instrument session. v2.2.5+: legacy "primary" instrument
   *  (= instruments[0] when multi-asset). Trade view uses `instruments` if
   *  present and falls back to `[instrument]` otherwise. */
  instrument: string;
  /** v2.2.5α: multi-asset session — the full list of instruments the user can
   *  trade. Present when `battleId` is set and the battle has multi-asset
   *  configuration. Absent for v1 sessions. */
  instruments?: string[];
  startBarTime: number;
  currentBarTime: number;
  endBarTime?: number;
  startingBalance: number;
  currentBalance: number;
  createdAt: number;
  lastPlayedAt: number;
  status: SessionStatus;
  speedSetting: SpeedSetting;
  /** When set, this session is an attempt of the named battle. Battle rules
   *  apply to all order submissions in this session (Phase 7). */
  battleId?: string;
  /** v2.2: where the battle data lives. "local" → IndexedDB (v1 model);
   *  "server" → Convex (multiplayer). When undefined, treat as "local"
   *  for backwards compat. Used by sessionStore.endSession to dispatch
   *  attempt persistence. */
  battleSource?: "local" | "server";
  /** v2.2.5α: persisted layout state (selected layout + per-pane state +
   *  active pane index). Saved on every layout/instrument/timeframe/focus
   *  change so reload restores the workspace. Optional — sessions started
   *  before v2.2.5 don't have one and the app defaults from battle.instruments. */
  layoutState?: SessionLayoutState;
  /**
   * v2.2.5α: snapshot of the battle this session attaches to. Stored at
   * startSession time so loadSession can restore the rules + starting
   * balance without a fetch — critical for SERVER battles, whose row
   * lives on Convex (battleRepository, which is Dexie-backed, returns
   * null for them, leaving activeBattle === null and silently disabling
   * the drawdown rule). Type-erased to `unknown` to keep the import
   * surface tight; sessionStore.loadSession casts to Battle on read.
   */
  battleSnapshot?: unknown;
  /**
   * v2.2.5α: open positions + pending orders persisted on the session row.
   * Phase 5 D2 originally treated these as in-memory only; multi-asset
   * battles + the user-blocking liquidation flow made the gap conspicuous
   * (reload would erase positions and reset the engine to startBarTime,
   * letting the user dodge a drawdown breach by reloading). Saved on a
   * 2s throttle from the trade page; restored on boot.
   *
   * Stored as `unknown[]` here so the Session type doesn't pull in the
   * full Order/OpenPosition shapes (those live on the orderStore types).
   * The trade page casts to the right shape on read.
   */
  openPositions?: unknown[];
  pendingOrders?: unknown[];
}

/**
 * v2.2.5α: per-session UI state for the multi-pane workspace.
 *
 * 5α surface is hardcoded: layout is auto-derived from session.instruments
 * length (1 → "1pane", 2-4 → "4quad", 5 → "6pane"). The full LayoutSelector
 * + per-pane controls land in 5β. The schema is forward-compatible — 5β just
 * starts honoring the explicit `layout` field instead of auto-deriving.
 */
export interface SessionLayoutState {
  /** Persisted layout choice. 5α hardcodes this from instruments.length. */
  layout: "1pane" | "2vertical" | "2horizontal" | "4quad" | "6pane";
  /** Per-pane state, indexed by pane position. */
  panes: SessionPaneState[];
  /** Index into `panes` of the focused pane. */
  activePaneIndex: number;
}

export interface SessionPaneState {
  /** Symbol shown in this pane. */
  instrument: string;
  /** Resolution string ("1", "5", "60", "1D"). 5α hardcodes "1". */
  timeframe: string;
}
