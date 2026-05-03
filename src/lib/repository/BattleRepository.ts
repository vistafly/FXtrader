import type { Battle, BattleAttempt } from "@/types/battle";

import { getDb } from "./db";

const idbAvailable = (): boolean =>
  typeof window !== "undefined" && typeof indexedDB !== "undefined";

/**
 * CRUD over the `battles` and `battleAttempts` Dexie tables. Methods are
 * no-ops on the server (SSR) and in test environments without IndexedDB.
 */
class BattleRepository {
  // ---- battles ----------------------------------------------------------

  async putBattle(battle: Battle): Promise<void> {
    if (!idbAvailable()) return;
    await getDb().battles.put(battle);
  }

  async getBattle(id: string): Promise<Battle | undefined> {
    if (!idbAvailable()) return undefined;
    return getDb().battles.get(id);
  }

  async listBattles(): Promise<Battle[]> {
    if (!idbAvailable()) return [];
    return getDb().battles.toArray();
  }

  async deleteBattle(id: string): Promise<void> {
    if (!idbAvailable()) return;
    const db = getDb();
    await db.transaction("rw", db.battles, db.battleAttempts, async () => {
      await db.battles.delete(id);
      await db.battleAttempts.where("battleId").equals(id).delete();
    });
  }

  // ---- attempts ---------------------------------------------------------

  async putAttempt(attempt: BattleAttempt): Promise<void> {
    if (!idbAvailable()) return;
    await getDb().battleAttempts.put(attempt);
  }

  async listAttempts(battleId: string): Promise<BattleAttempt[]> {
    if (!idbAvailable()) return [];
    return getDb()
      .battleAttempts.where("battleId")
      .equals(battleId)
      .sortBy("completedAt");
  }

  async getAttemptForSession(sessionId: string): Promise<BattleAttempt | undefined> {
    if (!idbAvailable()) return undefined;
    return getDb()
      .battleAttempts.where("sessionId")
      .equals(sessionId)
      .first();
  }
}

export const battleRepository = new BattleRepository();
