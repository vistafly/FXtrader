import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./emailNormalize";

const NBSP = " ";

describe("normalizeEmail", () => {
  describe("case folding", () => {
    it("lowercases mixed case", () => {
      expect(normalizeEmail("Test@Example.COM")).toBe("test@example.com");
    });
    it("lowercases all-uppercase", () => {
      expect(normalizeEmail("ALICE@DOMAIN.IO")).toBe("alice@domain.io");
    });
    it("leaves already-lowercase unchanged", () => {
      expect(normalizeEmail("test@example.com")).toBe("test@example.com");
    });
  });

  describe("whitespace — edges", () => {
    it("strips leading ASCII whitespace", () => {
      expect(normalizeEmail("   test@example.com")).toBe("test@example.com");
    });
    it("strips trailing ASCII whitespace", () => {
      expect(normalizeEmail("test@example.com   ")).toBe("test@example.com");
    });
    it("strips both ends + tabs/newlines", () => {
      expect(normalizeEmail("\t test@example.com \n")).toBe(
        "test@example.com",
      );
    });
  });

  describe("whitespace — internal", () => {
    it("strips internal ASCII space (the typed-in mistake case)", () => {
      // User types `j @gmail.com` mid-form. Email can't contain a space
      // anywhere; strip it rather than reject.
      expect(normalizeEmail("j @gmail.com")).toBe("j@gmail.com");
    });
    it("strips internal space mid-domain", () => {
      expect(normalizeEmail("alice@gmail .com")).toBe("alice@gmail.com");
    });
    it("strips multiple internal spaces", () => {
      expect(normalizeEmail("a l i c e @ g m a i l . c o m")).toBe(
        "alice@gmail.com",
      );
    });
  });

  describe("whitespace — non-breaking space (U+00A0)", () => {
    it("strips leading NBSP", () => {
      expect(normalizeEmail(`${NBSP}test@example.com`)).toBe(
        "test@example.com",
      );
    });
    it("strips trailing NBSP", () => {
      expect(normalizeEmail(`test@example.com${NBSP}`)).toBe(
        "test@example.com",
      );
    });
    it("strips internal NBSP (the trim()-resistant case)", () => {
      expect(normalizeEmail(`test${NBSP}@example.com`)).toBe(
        "test@example.com",
      );
    });
    it("strips multiple NBSPs in one input", () => {
      expect(
        normalizeEmail(`${NBSP}${NBSP}TEST${NBSP}@example.com${NBSP}`),
      ).toBe("test@example.com");
    });
  });

  describe("idempotency", () => {
    it("normalizing twice equals normalizing once", () => {
      const inputs = [
        "Test@Example.COM",
        `${NBSP}joe@example.com${NBSP}`,
        "  ALICE@DOMAIN.IO  ",
        `bob${NBSP}@example.com`,
        "j @gmail.com",
        "a l i c e @ g m a i l . c o m",
      ];
      for (const input of inputs) {
        const once = normalizeEmail(input);
        const twice = normalizeEmail(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe("edge cases", () => {
    it("empty string returns empty string", () => {
      expect(normalizeEmail("")).toBe("");
    });
    it("whitespace-only returns empty string", () => {
      expect(normalizeEmail(`  ${NBSP}  `)).toBe("");
    });
  });
});
