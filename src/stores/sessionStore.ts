import { create } from "zustand";

import { checkMaxDrawdown } from "@/lib/battles/guards";
import { battleRepository } from "@/lib/repository/BattleRepository";
import { sessionRepository } from "@/lib/repository/SessionRepository";
import { tradeRepository } from "@/lib/repository/TradeRepository";
import type { Battle, BattleAttempt } from "@/types/battle";
import type { Instrument } from "@/types/instrument";
import type { Session } from "@/types/session";
import type { Trade } from "@/types/trade";

import type { OpenPosition } from "./orderStore";

let _sessionCounter = 0;
const nextSessionId = () =>
  `sess_${Date.now().toString(36)}_${(++_sessionCounter).toString(36)}`;

let _attemptCounter = 0;
const nextAttemptId = () =>
  `att_${Date.now().toString(36)}_${(++_attemptCounter).toString(36)}`;

export interface StartSessionParams {
  name: string;
  instrument: string;
  startBarTime: number;
  startingBalance: number;
  /** Optional battle to attach this session to. Battle rules apply to all
   *  order submissions for the duration of the session. */
  battle?: Battle;
  /** v2.2: where the battle data lives ("local" → Dexie, "server" → Convex).
   *  Determines where endSession persists the attempt. Defaults to "local". */
  battleSource?: "local" | "server";
}

/**
 * v2.2: shape of a computed attempt result, surfaced via the
 * `submitToServer` callback in EndSessionOptions for server battles.
 * Mirrors the args shape of convex/battles.ts:submitAttempt.
 */
export interface ServerAttemptData {
  battleId: string;
  finalBalance: number;
  pnlPct: number;
  trades: number;
  winRate: number;
  disqualified: boolean;
  disqualificationReason?: string;
  completedAt: number;
}

export interface EndSessionOptions {
  /** When true, the resulting BattleAttempt (if any) is marked as DQ. */
  disqualified?: boolean;
  /** Short reason string surfaced on the attempt detail UI. */
  reason?: string;
  /**
   * v2.2: when the active session is a server battle, this callback
   * is invoked with the computed attempt data so the caller can submit
   * it to Convex. The sessionStore stays decoupled from React/Convex
   * hooks via this indirection — callers inject the actual mutation.
   * If absent (or attempt is for a local battle), no server submission
   * happens; local Dexie persistence is unaffected.
   */
  submitToServer?: (data: ServerAttemptData) => Promise<void>;
}

export interface SessionState {
  activeSession: Session | null;
  /** When the active session belongs to a battle, the battle config is
   *  cached here. Used by providers.tsx to enforce mid-session rules
   *  (e.g. maxDrawdownPct) without an extra Dexie round-trip per bar. */
  activeBattle: Battle | null;
  balance: number;
  equity: number;
  marginUsed: number;

  startSession: (params: StartSessionParams) => Promise<Session>;
  endSession: (opts?: EndSessionOptions) => Promise<void>;
  loadSession: (id: string) => Promise<void>;

  /**
   * Per-bar settlement called from providers.tsx after orderStore.applyBarResult.
   * Adds realized P&L to balance, recomputes equity, and tells the caller
   * whether the battle's maxDrawdownPct rule has been breached so the
   * orchestrator can pause + DQ in a single response.
   */
  applyBarSettlement: (params: {
    closures: { realizedPnl: number; trade: Trade }[];
    openPositions: OpenPosition[];
    instrument: Instrument;
    currentPrice: number;
    currentBarTime: number;
  }) => { drawdownViolation: string | null };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeSession: null,
  activeBattle: null,
  balance: 0,
  equity: 0,
  marginUsed: 0,

  startSession: async (params) => {
    const now = Math.floor(Date.now() / 1000);
    const session: Session = {
      id: nextSessionId(),
      name: params.name,
      instrument: params.instrument,
      startBarTime: params.startBarTime,
      currentBarTime: params.startBarTime,
      startingBalance: params.startingBalance,
      currentBalance: params.startingBalance,
      createdAt: now,
      lastPlayedAt: now,
      status: "active",
      speedSetting: 1,
      battleId: params.battle?.id,
      battleSource: params.battle ? (params.battleSource ?? "local") : undefined,
    };

    await sessionRepository.put(session);
    set({
      activeSession: session,
      activeBattle: params.battle ?? null,
      balance: params.startingBalance,
      equity: params.startingBalance,
      marginUsed: 0,
    });
    return session;
  },

  endSession: async (opts) => {
    const session = get().activeSession;
    if (!session) return;
    const completedAt = Math.floor(Date.now() / 1000);
    const balance = get().balance;
    const updated: Session = {
      ...session,
      status: "ended",
      lastPlayedAt: completedAt,
      currentBalance: balance,
    };
    await sessionRepository.put(updated);

    // If this session was a battle attempt, persist a BattleAttempt record.
    // Computed lazily here from orderStore + this session's identity so the
    // sessionStore stays loosely coupled.
    const battle = get().activeBattle;
    if (battle && session.battleId === battle.id) {
      const { useOrderStore } = await import("@/stores/orderStore");
      const allClosed = useOrderStore.getState().closedTrades;
      const sessionTrades = allClosed.filter((t) => t.sessionId === session.id);
      const wins = sessionTrades.filter((t) => t.pnl > 0).length;
      const winRate =
        sessionTrades.length > 0 ? wins / sessionTrades.length : 0;

      // pnlPct ratio (e.g. 0.35 for +35%). Local Dexie attempts store
      // the raw ratio; server submissions store percentage (×100).
      // The split keeps v1 records unchanged while matching the Convex
      // schema's percentage-based pnlPct field (see convex/battles.ts
      // and lib/battles/serverValidation.ts).
      const pnlRatio = (balance - battle.startingBalance) / battle.startingBalance;
      const disqualified = opts?.disqualified ?? false;

      if (session.battleSource === "server") {
        if (opts?.submitToServer) {
          // Caller injected the Convex mutation; surface the attempt data.
          // Fail-soft: if submission throws (network, rate limit, validation),
          // we log + continue. v2.x should add a retry queue so users don't
          // silently lose attempts on transient failures.
          try {
            await opts.submitToServer({
              battleId: battle.id,
              finalBalance: balance,
              pnlPct: pnlRatio * 100,
              trades: sessionTrades.length,
              winRate,
              disqualified,
              disqualificationReason: opts?.reason,
              completedAt,
            });
          } catch (err) {
            console.error("Failed to submit server attempt:", err);
          }
        } else {
          console.warn(
            "Server-battle session ended without a submitToServer callback; attempt not persisted to Convex.",
          );
        }
      } else {
        // Local battle (or undefined for v1 backwards compat) → Dexie.
        const attempt: BattleAttempt = {
          id: nextAttemptId(),
          battleId: battle.id,
          sessionId: session.id,
          finalBalance: balance,
          pnlPct: pnlRatio,
          trades: sessionTrades.length,
          winRate,
          completedAt,
          disqualified,
          disqualificationReason: opts?.reason,
        };
        await battleRepository.putAttempt(attempt);
      }
    }

    set({ activeSession: updated });
  },

  loadSession: async (id) => {
    const session = await sessionRepository.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    let battle: Battle | null = null;
    if (session.battleId) {
      battle = (await battleRepository.getBattle(session.battleId)) ?? null;
    }
    set({
      activeSession: session,
      activeBattle: battle,
      balance: session.currentBalance,
      equity: session.currentBalance,
      marginUsed: 0,
    });
  },

  applyBarSettlement: ({
    closures,
    openPositions,
    instrument,
    currentPrice,
    currentBarTime,
  }) => {
    const realizedDelta = closures.reduce((sum, c) => sum + c.realizedPnl, 0);
    const newBalance = get().balance + realizedDelta;

    void currentPrice;
    const totalUnrealized = openPositions.reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0,
    );
    const equity = newBalance + totalUnrealized;
    const marginUsed = openPositions.reduce(
      (sum, p) => sum + instrument.marginPerContract * p.size,
      0,
    );

    if (closures.length > 0) {
      void tradeRepository.bulkAdd(closures.map((c) => c.trade));
    }

    const session = get().activeSession;
    const updatedSession: Session | null = session
      ? {
          ...session,
          currentBalance: newBalance,
          currentBarTime,
          lastPlayedAt: Math.floor(Date.now() / 1000),
        }
      : null;

    set({
      balance: newBalance,
      equity,
      marginUsed,
      activeSession: updatedSession,
    });

    // Battle rule enforcement — threshold pulled from BATTLE config (its
    // own startingBalance), per Phase 7 D5. Source of truth is the battle,
    // not the session.
    const battle = get().activeBattle;
    const drawdownViolation = battle
      ? checkMaxDrawdown(battle, equity)
      : null;

    return { drawdownViolation };
  },
}));

/** Derived selector — free margin = equity − margin used. */
export const selectFreeMargin = (s: SessionState): number =>
  s.equity - s.marginUsed;
