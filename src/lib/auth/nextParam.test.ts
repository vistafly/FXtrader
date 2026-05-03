import { describe, expect, it } from "vitest";

import { validateNextParam } from "./nextParam";

describe("validateNextParam", () => {
  describe("fallback cases", () => {
    it("falls back on null/undefined/empty", () => {
      expect(validateNextParam(null)).toBe("/dashboard");
      expect(validateNextParam(undefined)).toBe("/dashboard");
      expect(validateNextParam("")).toBe("/dashboard");
    });

    it("falls back on absolute URLs (open-redirect attack)", () => {
      expect(validateNextParam("https://evil.com")).toBe("/dashboard");
      expect(validateNextParam("http://evil.com")).toBe("/dashboard");
    });

    it("falls back on protocol-relative URLs", () => {
      expect(validateNextParam("//evil.com")).toBe("/dashboard");
      expect(validateNextParam("//evil.com/dashboard")).toBe("/dashboard");
    });

    it("falls back on backslash injection", () => {
      expect(validateNextParam("/\\evil.com")).toBe("/dashboard");
      expect(validateNextParam("/dashboard\\..\\admin")).toBe("/dashboard");
    });

    it("falls back on paths outside the allowlist", () => {
      expect(validateNextParam("/random")).toBe("/dashboard");
      expect(validateNextParam("/api/admin")).toBe("/dashboard");
      expect(validateNextParam("/signup")).toBe("/dashboard");
      expect(validateNextParam("/signin")).toBe("/dashboard");
    });
  });

  describe("allowed paths", () => {
    it("accepts exact prefix matches", () => {
      expect(validateNextParam("/dashboard")).toBe("/dashboard");
      expect(validateNextParam("/battles")).toBe("/battles");
      expect(validateNextParam("/journal")).toBe("/journal");
    });

    it("accepts paths under allowed prefixes", () => {
      expect(validateNextParam("/battles/abc123")).toBe("/battles/abc123");
      expect(validateNextParam("/trade/session-id")).toBe("/trade/session-id");
    });

    it("accepts query strings on allowed paths", () => {
      expect(validateNextParam("/journal?from=2026-01-01")).toBe(
        "/journal?from=2026-01-01",
      );
    });

    it("rejects prefix-substring tricks", () => {
      // /dashboardadmin starts with "/dashboard" but isn't /dashboard or
      // a child path — must not match.
      expect(validateNextParam("/dashboardadmin")).toBe("/dashboard");
      expect(validateNextParam("/battlessomethingelse")).toBe("/dashboard");
    });
  });
});
