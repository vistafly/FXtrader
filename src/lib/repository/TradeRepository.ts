import type { Trade } from "@/types/trade";

import { getDb } from "./db";

/** True only in real browsers. jsdom has window but no indexedDB. */
const idbAvailable = (): boolean =>
  typeof window !== "undefined" && typeof indexedDB !== "undefined";

class TradeRepository {
  async add(trade: Trade): Promise<void> {
    if (!idbAvailable()) return;
    await getDb().trades.put(trade);
  }

  async bulkAdd(trades: Trade[]): Promise<void> {
    if (!idbAvailable() || trades.length === 0) return;
    await getDb().trades.bulkPut(trades);
  }

  async listForSession(sessionId: string): Promise<Trade[]> {
    if (!idbAvailable()) return [];
    return getDb().trades.where("sessionId").equals(sessionId).sortBy("exitTime");
  }

  async deleteForSession(sessionId: string): Promise<void> {
    if (!idbAvailable()) return;
    await getDb().trades.where("sessionId").equals(sessionId).delete();
  }
}

export const tradeRepository = new TradeRepository();
