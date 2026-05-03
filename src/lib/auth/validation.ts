// Auth-form validation + server-error translation.
//
// These run client-side, BEFORE calling signIn/signUp, so we get fast
// inline feedback without a server roundtrip — and we control the user-
// facing copy so backend identifiers like "InvalidAccountId" never leak.
//
// `noValidate` is set on the auth forms (signin/signup pages) to disable
// the browser's native email validator, since it fires synchronously on
// submit and blocks our normalize layer. That makes us responsible for
// presenting reasonable error feedback ourselves; that's what these
// functions are for.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPLAY_NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const PASSWORD_MIN = 8;
const EMAIL_MAX = 254; // RFC 5321 practical limit

export function validateEmail(email: string): string | null {
  if (!email) return "Email is required.";
  if (email.length > EMAIL_MAX) return "Email is too long.";
  if (!EMAIL_RE.test(email)) {
    return "Email looks invalid. Use a format like name@example.com.";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  return null;
}

export function validateDisplayName(name: string): string | null {
  if (!name) return "Display name is required.";
  if (!DISPLAY_NAME_RE.test(name)) {
    return "Display name must be 3-20 characters: letters, numbers, _ or -.";
  }
  return null;
}

// Translate server-side auth errors into messages we'd show a user.
//
// Three layers, in order:
//   1. ConvexError.data — verbatim. We author those throws (e.g. display
//      name validation in convex/profiles.ts), so the message is already
//      friendly. Detected via duck-typing rather than `instanceof
//      ConvexError` so this module stays import-clean of convex deps and
//      testable in plain Vitest.
//   2. Pattern-match common @convex-dev/auth error strings — translate
//      to UX-friendly equivalents. Most importantly: NEVER reveal whether
//      it was the email or password that was wrong; the "Invalid email
//      or password" convention prevents account-enumeration attacks.
//   3. Generic fallback per flow — never leak `err.message` directly,
//      since that may include identifiers like "InvalidAccountId" or
//      "InvalidSecret" that are meaningless to users.
export function translateAuthError(
  err: unknown,
  flow: "signIn" | "signUp",
): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === "string" && data.length > 0) return data;
  }

  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();

  if (flow === "signIn") {
    if (
      msg.includes("invalidaccountid") ||
      msg.includes("invalid account") ||
      msg.includes("invalid credentials") ||
      msg.includes("invalidsecret") ||
      msg.includes("could not find") ||
      msg.includes("not found")
    ) {
      return "Invalid email or password.";
    }
    return "Sign-in failed. Please try again.";
  }

  // signUp
  if (
    msg.includes("already exists") ||
    msg.includes("duplicate") ||
    msg.includes("alreadyexists")
  ) {
    return "An account with that email already exists. Try signing in instead.";
  }
  return "Sign-up failed. Please try again.";
}
