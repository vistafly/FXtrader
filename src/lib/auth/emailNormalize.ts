// Email normalization — mirror this in convex/auth.ts (Password.profile)
// so client and server agree on canonical form.
//
// Rules:
//   1. Strip ALL whitespace anywhere in the string. RFC 5321 doesn't
//      permit whitespace in either local-part or domain, so stripping
//      is safe and forgiving. Catches:
//        - leading/trailing ASCII spaces (paste, autofill, fat-finger)
//        - internal ASCII spaces ("j @gmail.com" — typed-in mistake)
//        - non-breaking space U+00A0 (paste from formatted text;
//          String.prototype.trim() handles edges only, not internals)
//        - tabs, newlines, U+2028, etc. via the \s class
//   2. lowercase — RFC 5321 says local-part is case-sensitive, but every
//      mainstream provider (Gmail, Outlook, etc.) treats it as
//      case-insensitive. Keeping case-sensitive would create the exact
//      "Joe@example.com vs joe@example.com" duplicate-account bug.
//
// JS regex `\s` covers ASCII whitespace, NBSP, line/paragraph
// separators, and BOM. Single character class, single replace pass.
export function normalizeEmail(input: string): string {
  return input.replace(/\s/g, "").toLowerCase();
}
