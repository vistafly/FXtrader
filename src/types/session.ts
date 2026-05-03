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
  instrument: string;
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
}
