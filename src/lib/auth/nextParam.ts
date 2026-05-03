// Validate the `?next=...` redirect param after auth.
//
// Open-redirect attacks (?next=https://evil.com) are a real class — never
// trust the param verbatim. Rules:
//
//   - Must start with `/`
//   - Must NOT contain `//` (would allow protocol-relative redirects)
//   - Must NOT contain `\` (Windows path injection)
//   - Must match one of the known authed-route prefixes
//   - Anything else → fallback to /dashboard
//
// The middleware sets `next=<original-path>` when redirecting unauthed users
// to /signin; this validator runs on the way back out so we only ever land
// on a path we control.
const ALLOWED_PREFIXES = ["/dashboard", "/battles", "/journal", "/trade", "/settings"];

const FALLBACK = "/dashboard";

export function validateNextParam(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  if (typeof raw !== "string") return FALLBACK;
  if (!raw.startsWith("/")) return FALLBACK;
  if (raw.includes("//")) return FALLBACK;
  if (raw.includes("\\")) return FALLBACK;
  if (!ALLOWED_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`) || raw.startsWith(`${p}?`))) {
    return FALLBACK;
  }
  return raw;
}
