import Dexie, { type Table } from "dexie";

import type { Bar } from "@/types/bar";
import type { Battle, BattleAttempt } from "@/types/battle";
import type { Order } from "@/types/order";
import type { Position } from "@/types/position";
import type { Session } from "@/types/session";
import type { Trade } from "@/types/trade";

export interface StoredBar extends Bar {
  /** Composite key: `${instrument}:${time}`. Lets us bulk-insert per instrument without collisions. */
  id: string;
  instrument: string;
}

export class FXTraderDB extends Dexie {
  sessions!: Table<Session, string>;
  orders!: Table<Order, string>;
  positions!: Table<Position, string>;
  trades!: Table<Trade, string>;
  battles!: Table<Battle, string>;
  battleAttempts!: Table<BattleAttempt, string>;
  bars!: Table<StoredBar, string>;

  constructor() {
    super("fxtrader");

    this.version(1).stores({
      sessions: "id, instrument, status, lastPlayedAt, createdAt",
      orders: "id, sessionId, instrument, status, createdAt",
      positions: "id, sessionId, instrument, status, entryTime",
      trades: "id, sessionId, instrument, exitTime, [sessionId+exitTime]",
      battles: "id, instrument, name",
      battleAttempts: "id, battleId, completedAt, pnlPct",
      bars: "id, instrument, time, [instrument+time]",
    });
    // Phase 7: sessions can belong to a battle; battleAttempts gain a sessionId
    // back-reference so we can hydrate an attempt's full trade history.
    this.version(2).stores({
      sessions: "id, instrument, status, lastPlayedAt, createdAt, battleId",
      battleAttempts: "id, battleId, sessionId, completedAt, pnlPct, disqualified",
    });
  }
}

let _db: FXTraderDB | null = null;

/** Lazy singleton — Dexie touches `indexedDB`, which is undefined during SSR. */
export function getDb(): FXTraderDB {
  if (typeof window === "undefined") {
    throw new Error("getDb() called on the server. Wrap callers in a client boundary.");
  }
  if (!_db) {
    _db = new FXTraderDB();
  }
  return _db;
}
