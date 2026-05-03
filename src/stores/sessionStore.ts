import { create } from "zustand";

import { sessionRepository } from "@/lib/repository/SessionRepository";
import { tradeRepository } from "@/lib/repository/TradeRepository";
import type { Instrument } from "@/types/instrument";
import type { Session } from "@/types/session";
import type { Trade } from "@/types/trade";

import type { OpenPosition } from "./orderStore";

let _sessionCounter = 0;
const nextSessionId = () =>
  `sess_${Date.now().toString(36)}_${(++_sessionCounter).toString(36)}`;

export interface StartSessionParams {
  name: string;
  instrument: string;
  startBarTime: number;
  startingBalance: number;
}

export interface SessionState {
  activeSession: Session | null;
  balance: number;
  equity: number;
  marginUsed: number;

  startSession: (params: StartSessionParams) => Promise<Session>;
  endSession: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;

  /**
   * Per-bar settlement called from providers.tsx after orderStore.applyBarResult.
   * Adds realized P&L to balance, recomputes equity from open positions.
   */
  applyBarSettlement: (params: {
    closures: { realizedPnl: number; trade: Trade }[];
    openPositions: OpenPosition[];
    instrument: Instrument;
    currentPrice: number;
    currentBarTime: number;
  }) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeSession: null,
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
    };

    await sessionRepository.put(session);
    set({
      activeSession: session,
      balance: params.startingBalance,
      equity: params.startingBalance,
      marginUsed: 0,
    });
    return session;
  },

  endSession: async () => {
    const session = get().activeSession;
    if (!session) return;
    const updated: Session = {
      ...session,
      status: "ended",
      lastPlayedAt: Math.floor(Date.now() / 1000),
      currentBalance: get().balance,
    };
    await sessionRepository.put(updated);
    set({ activeSession: updated });
  },

  loadSession: async (id) => {
    const session = await sessionRepository.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    set({
      activeSession: session,
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

    // Equity = balance + sum of unrealized P&L on still-open positions.
    // openPositions[i].unrealizedPnl was just refreshed by orderStore.applyBarResult
    // against bar.close, so we sum it directly.
    void currentPrice; // Available if we ever want to recompute defensively here.
    const totalUnrealized = openPositions.reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0,
    );
    const equity = newBalance + totalUnrealized;
    const marginUsed = openPositions.reduce(
      (sum, p) => sum + instrument.marginPerContract * p.size,
      0,
    );

    // Persist closed trades to Dexie. Fire-and-forget — UI is already updated
    // optimistically by orderStore.applyBarResult.
    if (closures.length > 0) {
      void tradeRepository.bulkAdd(closures.map((c) => c.trade));
    }

    // Mirror balance + bar time onto the active session.
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
  },
}));

/** Derived selector — free margin = equity − margin used. */
export const selectFreeMargin = (s: SessionState): number =>
  s.equity - s.marginUsed;
