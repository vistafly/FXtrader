import type { Session } from "@/types/session";

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
}

export const sessionRepository = new SessionRepository();
