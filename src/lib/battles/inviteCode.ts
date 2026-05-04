// Invite code generator + URL utilities for v2.2 server battles.
//
// Per A4: 12-char URL-safe codes, single permanent code per battle,
// reusable, no rotation, no per-user binding. Anyone with the code can
// join the battle. Same model as Discord permanent invite links.
//
// Per A6: battle URLs use prefix-based dispatch — `/battles/local-<id>`
// for v1 IndexedDB battles, `/battles/server-<id>` for v2 Convex battles.
// One route handler at /battles/[battleId] parses the prefix and
// dispatches to the right data source. Storage type stays out of the
// URL space (the user thinks "their battle"; the server vs local split
// is implementation detail).

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// generateInviteCode runs SERVER-SIDE only (Convex mutation context).
// Uses crypto.getRandomValues for unbiased random selection. The mod
// here is a tiny bias issue (256 % 64 = 0, so the bias is zero — 64 is
// a power of 2 and 256 / 64 is exact). Don't change ALPHABET length
// without recomputing.
export function generateInviteCode(length = 12): string {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export type BattleSource = "local" | "server";

export function buildBattleUrl(source: BattleSource, id: string): string {
  return `/battles/${source}-${id}`;
}

export function buildInviteUrl(inviteCode: string, origin = ""): string {
  return `${origin}/battles/join/${inviteCode}`;
}

export interface ParsedBattleId {
  source: BattleSource | "unknown";
  id: string;
}

export function parseBattleId(prefixedId: string): ParsedBattleId {
  if (prefixedId.startsWith("local-")) {
    return { source: "local", id: prefixedId.slice("local-".length) };
  }
  if (prefixedId.startsWith("server-")) {
    return { source: "server", id: prefixedId.slice("server-".length) };
  }
  return { source: "unknown", id: prefixedId };
}
