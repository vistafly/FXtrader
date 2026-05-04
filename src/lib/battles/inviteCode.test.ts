import { describe, expect, it } from "vitest";

import {
  buildBattleUrl,
  buildInviteUrl,
  generateInviteCode,
  parseBattleId,
} from "./inviteCode";

describe("generateInviteCode", () => {
  it("returns 12 chars by default", () => {
    expect(generateInviteCode()).toHaveLength(12);
  });
  it("respects length param", () => {
    expect(generateInviteCode(20)).toHaveLength(20);
    expect(generateInviteCode(4)).toHaveLength(4);
  });
  it("only uses URL-safe alphabet", () => {
    const code = generateInviteCode(64);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("produces different codes across calls (entropy sanity)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(generateInviteCode(12));
    // 50 calls of 12-char codes with 64^12 keyspace should virtually never collide.
    expect(codes.size).toBe(50);
  });
});

describe("buildBattleUrl", () => {
  it("prefixes local-", () => {
    expect(buildBattleUrl("local", "abc123")).toBe("/battles/local-abc123");
  });
  it("prefixes server-", () => {
    expect(buildBattleUrl("server", "k97xyz")).toBe("/battles/server-k97xyz");
  });
});

describe("buildInviteUrl", () => {
  it("builds without origin (relative)", () => {
    expect(buildInviteUrl("abc123def456")).toBe("/battles/join/abc123def456");
  });
  it("builds with origin (absolute, for clipboard share)", () => {
    expect(buildInviteUrl("abc123", "https://app.example.com")).toBe(
      "https://app.example.com/battles/join/abc123",
    );
  });
});

describe("parseBattleId", () => {
  it("parses local- prefix", () => {
    expect(parseBattleId("local-abc123")).toEqual({
      source: "local",
      id: "abc123",
    });
  });
  it("parses server- prefix", () => {
    expect(parseBattleId("server-k97xyz")).toEqual({
      source: "server",
      id: "k97xyz",
    });
  });
  it("strips only the first prefix occurrence (handles ID-with-dashes)", () => {
    // Real Convex IDs sometimes include dashes; ensure we only strip the
    // single leading prefix, not all of them.
    expect(parseBattleId("server-k9-7xy-z")).toEqual({
      source: "server",
      id: "k9-7xy-z",
    });
    expect(parseBattleId("local-abc-def-ghi")).toEqual({
      source: "local",
      id: "abc-def-ghi",
    });
  });
  it("returns unknown for non-prefixed IDs", () => {
    expect(parseBattleId("just-an-id")).toEqual({
      source: "unknown",
      id: "just-an-id",
    });
    expect(parseBattleId("")).toEqual({ source: "unknown", id: "" });
  });
  it("does not match prefix-substring tricks", () => {
    // "localmood-abc" is NOT a local battle (no hyphen-after-local)
    expect(parseBattleId("localmood-abc")).toEqual({
      source: "unknown",
      id: "localmood-abc",
    });
    expect(parseBattleId("serverless-abc")).toEqual({
      source: "unknown",
      id: "serverless-abc",
    });
  });
});
