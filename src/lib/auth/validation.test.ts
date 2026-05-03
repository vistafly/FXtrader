import { describe, expect, it } from "vitest";

import {
  translateAuthError,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "./validation";

describe("validateEmail", () => {
  it("rejects empty", () => {
    expect(validateEmail("")).toBe("Email is required.");
  });
  it("rejects missing @", () => {
    expect(validateEmail("jgmail.com")).toMatch(/looks invalid/);
  });
  it("rejects multiple @", () => {
    expect(validateEmail("j@@gmail.com")).toMatch(/looks invalid/);
  });
  it("rejects missing TLD", () => {
    expect(validateEmail("j@gmail")).toMatch(/looks invalid/);
  });
  it("rejects missing local part", () => {
    expect(validateEmail("@gmail.com")).toMatch(/looks invalid/);
  });
  it("rejects missing domain", () => {
    expect(validateEmail("j@")).toMatch(/looks invalid/);
  });
  it("rejects internal whitespace", () => {
    expect(validateEmail("j @gmail.com")).toMatch(/looks invalid/);
    expect(validateEmail("j@gmail .com")).toMatch(/looks invalid/);
  });
  it("rejects oversize", () => {
    const big = "a".repeat(255) + "@example.com";
    expect(validateEmail(big)).toBe("Email is too long.");
  });
  it("accepts standard format", () => {
    expect(validateEmail("alice@example.com")).toBeNull();
  });
  it("accepts subdomains", () => {
    expect(validateEmail("alice@mail.example.com")).toBeNull();
  });
  it("accepts plus-addressing", () => {
    expect(validateEmail("alice+tag@example.com")).toBeNull();
  });
});

describe("validatePassword", () => {
  it("rejects empty", () => {
    expect(validatePassword("")).toBe("Password is required.");
  });
  it("rejects too short", () => {
    expect(validatePassword("short")).toMatch(/at least 8/);
  });
  it("accepts at-minimum length", () => {
    expect(validatePassword("12345678")).toBeNull();
  });
  it("accepts longer", () => {
    expect(validatePassword("a-much-longer-password")).toBeNull();
  });
});

describe("validateDisplayName", () => {
  it("rejects empty", () => {
    expect(validateDisplayName("")).toBe("Display name is required.");
  });
  it("rejects too short (under 3)", () => {
    expect(validateDisplayName("ab")).toMatch(/3-20/);
  });
  it("rejects too long (over 20)", () => {
    expect(validateDisplayName("a".repeat(21))).toMatch(/3-20/);
  });
  it("rejects spaces", () => {
    expect(validateDisplayName("alice 42")).toMatch(/3-20/);
  });
  it("rejects punctuation outside _ and -", () => {
    expect(validateDisplayName("alice!")).toMatch(/3-20/);
    expect(validateDisplayName("alice.42")).toMatch(/3-20/);
  });
  it("accepts standard handle", () => {
    expect(validateDisplayName("alice")).toBeNull();
  });
  it("accepts mixed alphanumeric + _ + -", () => {
    expect(validateDisplayName("Alice_42-x")).toBeNull();
  });
});

describe("translateAuthError", () => {
  describe("ConvexError-shaped errors (data passthrough)", () => {
    it("surfaces .data verbatim if string", () => {
      const err = { data: "Display name 'alice' is already taken" };
      expect(translateAuthError(err, "signUp")).toBe(
        "Display name 'alice' is already taken",
      );
    });
    it("falls through if .data is empty string", () => {
      const err = { data: "" };
      // Empty string fails the `.length > 0` check, falls to generic
      expect(translateAuthError(err, "signIn")).toMatch(/Sign-in failed/);
    });
    it("falls through if .data is non-string", () => {
      const err = { data: 42 };
      expect(translateAuthError(err, "signIn")).toMatch(/Sign-in failed/);
    });
  });

  describe("signIn errors", () => {
    it("translates InvalidAccountId to opaque message", () => {
      const err = new Error("InvalidAccountId: account not found");
      expect(translateAuthError(err, "signIn")).toBe(
        "Invalid email or password.",
      );
    });
    it("translates InvalidSecret to opaque message", () => {
      const err = new Error("InvalidSecret: password mismatch");
      expect(translateAuthError(err, "signIn")).toBe(
        "Invalid email or password.",
      );
    });
    it("translates 'could not find' to opaque message", () => {
      const err = new Error("Could not find user");
      expect(translateAuthError(err, "signIn")).toBe(
        "Invalid email or password.",
      );
    });
    it("falls back to generic for unknown errors", () => {
      const err = new Error("Some weird database error");
      expect(translateAuthError(err, "signIn")).toMatch(/Sign-in failed/);
    });
  });

  describe("signUp errors", () => {
    it("translates 'already exists' to friendly duplicate message", () => {
      const err = new Error("User already exists");
      expect(translateAuthError(err, "signUp")).toMatch(
        /already exists.*signing in/,
      );
    });
    it("translates 'AlreadyExists' identifier to friendly", () => {
      const err = new Error("AlreadyExists");
      expect(translateAuthError(err, "signUp")).toMatch(/already exists/);
    });
    it("falls back to generic for unknown errors", () => {
      const err = new Error("Network timeout");
      expect(translateAuthError(err, "signUp")).toMatch(/Sign-up failed/);
    });
  });

  describe("non-Error inputs", () => {
    it("handles undefined", () => {
      expect(translateAuthError(undefined, "signIn")).toMatch(/Sign-in failed/);
    });
    it("handles plain strings", () => {
      expect(translateAuthError("InvalidAccountId", "signIn")).toBe(
        "Invalid email or password.",
      );
    });
  });
});
