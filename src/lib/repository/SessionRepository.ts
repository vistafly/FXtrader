import type { Session, SessionLayoutState } from "@/types/session";

import { getDb } from "./db";

const idbAvailable = (): boolean =>
  typeof window !== "undefined" && typeof indexedDB !== "undefined";

/**
 * CRUD over Dexie's `sessions` table. Methods are no-ops on the server (SSR)
 * and in test environments without IndexedDB (jsdom).
 */
class SessionRepository {
  async put(session: Session): Promise<void> {
    if (!idbAvailable()) return;
    await getDb().sessions.put(session);
  }

  async get(id: string): Promise<Session | undefined> {
    if (!idbAvailable()) return undefined;
    return getDb().sessions.get(id);
  }

  async list(): Promise<Session[]> {
    if (!idbAvailable()) return [];
    return getDb().sessions.orderBy("lastPlayedAt").reverse().toArray();
  }

  async delete(id: string): Promise<void> {
    if (!idbAvailable()) return;
    await getDb().sessions.delete(id);
  }

  /**
   * v2.2.5α: persist the multi-pane workspace state for a session. Stored as
   * a JSON-serializable column on the existing `sessions` row (no new table)
   * — see Session.layoutState. Called on every layout / instrument /
   * timeframe / focus change. Cheap upsert; the whole row is rewritten.
   */
  async updateLayoutState(
    sessionId: string,
    layoutState: SessionLayoutState,
  ): Promise<void> {
    if (!idbAvailable()) return;
    const db = getDb();
    const row = await db.sessions.get(sessionId);
    if (!row) return;
    await db.sessions.put({ ...row, layoutState });
  }

  /** Convenience read of the persisted layout state. */
  async getLayoutState(
    sessionId: string,
  ): Promise<SessionLayoutState | undefined> {
    if (!idbAvailable()) return undefined;
    const row = await getDb().sessions.get(sessionId);
    return row?.layoutState;
  }
}

export const sessionRepository = new SessionRepository();
