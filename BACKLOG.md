# BACKLOG

Tracking items observed or deferred during the build, organized by
intent. Three categories:

- **Deferred** — we plan to build it, just later. Each entry has a
  phase reference + revisit criteria.
- **Under consideration** — genuinely undecided. Technical constraints
  documented so future planning sessions don't re-investigate the same
  dead ends.
- **Explicitly skipped** — features observed (often in FXReplay) that
  we've explicitly decided NOT to build. Listed here so future planning
  sessions don't re-investigate.

The roadmap (what we WILL build, in order) lives in `CLAUDE.md` §16.1.

---

## Deferred

- **CSV importer for user-supplied historical data** — deferred from spec §7 ("User-imported data") to v1.1. Path is scaffolded (`Settings → Import Data` accepting Dukascopy-format CSVs persisted via a `barRepository.bulkInsert()`); not built.
- **Read-only enforcement on ended sessions** — deferred from Phase 6 D5. Currently `/trade/[sessionId]` loads any session including `status: "ended"` and lets the user navigate the engine, but order submission isn't blocked. Should refuse new orders when session is ended.
- **Live theme switching** — deferred from Phase 4 (LightweightChartProvider notes). Theme tokens are read once at chart mount; switching dark↔light at runtime requires re-reading CSS variables and recoloring the chart canvas. Marked at `LightweightChartProvider.ts: "Theme tokens read at mount; live theme switching deferred to Phase 6"` (later deferred again).
- **In-chart drag-to-modify TP/SL on the canvas line itself** — deferred to post-TV-swap per spec §18. Lightweight Charts v4's `priceLine` is canvas-rendered with no pointer events. The current solution overlays draggable HTML chips on top; the canvas line stays static. TradingView Trading Platform handles this natively.
- **Playwright E2E tests** — deferred per spec §4.1 ("Test coverage policy"). Engine logic + analytics are unit-tested in Vitest. Canvas rendering, frame timing, chart pan/zoom, drag interactions, recharts paint — none of these are tested. Add when there's a real regression to catch, not before.
- **Per-bar mark-to-market equity curve overlay** — noted in Phase 7 D2 heads-up. The Journal's equity curve is per-trade (one point per closed trade, same-time aggregated). Per-bar would show intra-trade drawdown but requires storing per-bar equity history (new Dexie table). Not built; flagged in `lib/analytics/equityCurve.ts`.
- **Tag taxonomy / structured tags** — deferred from Phase 7 D4. Tags are free-form text with combobox autocomplete from existing tags. A predefined taxonomy (e.g. `setup:breakout`, `mistake:fomo`, `emotion:revenge`) would aid analytics filtering but constrains the user. Free-form first; revisit if filter UX gets noisy.
- **Pending orders + open positions persistence across reloads** — closed trades and sessions persist; pending orders and open positions are in-memory only (Phase 5 D2). On reload they're lost. Acceptable for short-lived replay sessions; revisit if users complain. Likely pulled into v2.2.5 since multi-asset switching makes the gap more conspicuous.
- **Password reset / forgot-password flow** — deferred from Phase v2.1 A5. v2.0 multiplayer ships email/password without a reset path; recovery is "ask the deployment owner" since it's a 5-friend deployment. Wire this up alongside opening to public lobbies (probably the same v2.x phase that adds replay-log verification).
- **Migrate `middleware.ts` to `proxy.ts`** — Next 16 renamed the convention; `@convex-dev/auth@0.0.92` still exports `convexAuthNextjsMiddleware` so we can't migrate yet without losing auth. Build emits a deprecation warning until the library catches up; revisit when `@convex-dev/auth` ships a proxy-shaped export.
- **Max Daily Drawdown** — separate from lifetime max drawdown. Needs day-segmented equity history with explicit "day boundaries" inside the replay window (since replay time is decoupled from wall-clock time). Per-bar equity history persistence is a prerequisite (already on this list as the per-bar mark-to-market overlay).
- **Session Data Length / Historical Data Length controls** — FXReplay-style options for how much future market time the session can run and how far back the chart can scroll. Our bundled datasets are 30 days fixed; these UI controls only become meaningful when we ingest longer datasets. Tied to the CSV importer item.
- **Battle IDs are capability-not-ACL** — Convex IDs (32-char) are not enumerable in practice but they're not access-controlled. Anyone authed who obtains a battle ID (via screenshot, shared URL, browser history, etc.) can read the battle, regardless of whether the battle is invite-only. Acceptable for friends-only scale where the deployment URL itself isn't published. Before opening to public lobbies, add row-level access control via an `allowedUsers` junction table (or use Convex's own row-level read auth). The boundary case to fix: invite-only battles being readable by anyone with the ID even if they were never invited. Tracked here for v2.x.
- **No retry queue for failed server-attempt submissions** — `endSession` calls `submitToServer` once; if Convex submission fails (network, rate limit, validation), the attempt is logged + lost. Users who play a server battle on a flaky connection can lose attempts silently. v2.x: queue failed submissions in IndexedDB, retry on next app boot, surface a "your last attempt didn't sync, retry?" UI on /dashboard.
- **No server-side intra-session rule verification** — submitAttempt's only rule check is "if maxDrawdownPct is set and final pnlPct breaches it, DQ flag must be true." Doesn't catch transient breaches (drawdown hit -50% mid-session but recovered to -10% by end), maxLossPerTradePct violations, or missing stop losses on individual trades. The full enforcement requires per-bar equity history + per-trade audit log (replay log), which is the v2.x anti-cheat work. For friends-only this is acceptable.
- **`convex/users.ts:emailExists` is an account-enumeration vector** — anyone can call the query with arbitrary emails and learn whether each is registered. Acceptable at the friends-only scale (the deployment URL itself isn't published) but must be rate-limited or removed before opening to public lobbies. Options when revisiting: rate-limit per-IP via Convex middleware; replace with "create account or signin" merged-flow that doesn't reveal which side the email matches; require email verification before signup so the "already exists" check happens after a verified address has been demonstrated.
- **Recharts width=-1/height=-1 warning on /journal first paint** — `EquityCurveChart`, `WinLossPie`, `PnlHistogram` log width/height warnings on initial render before their parent containers measure. Charts paint correctly after resolution, so it's pure console noise. Next 16 forwards these from browser to dev terminal making them more visible. Fix is to set explicit dimensions or `aspect` on each chart's wrapper, or add `minWidth: 0` to the flex parent. Low priority — visual only, not a regression.

---

## Under consideration

- **In-app music/audio integration** — first considered May 2026 after seeing FXReplay's "Chart Background" feature. Browser Media Session API does NOT permit controlling other tabs (Spotify, YouTube, etc.) from FXTrader; that capability doesn't exist for security reasons. Realistic options if pursued: (a) bundled ambient sound (lofi/rain/cafe) inside FXTrader, similar to FXReplay's approach — earlier deemed "gimmicky" but reversible; (b) embedded Spotify/YouTube web player in a side panel — significant UX complexity. Decision deferred pending real usage; revisit after v2.3 ships and the user has friend-tested actual battles. *Distinct from "Chart background ambient sound" under Explicitly skipped — that's bundled audio inside FXTrader; this is about controlling external music sources.*

---

## Explicitly skipped

These are features observed in FXReplay (or considered separately) that
we've explicitly decided NOT to build. Distinct from "Deferred" (will
build later) and "Under consideration" (genuinely undecided). Listed
here so future planning sessions don't re-investigate.

- **In-product chat** — friends use Discord, not FXTrader, for battle communication. Decision: May 2026.
- **Voice chat** — same reasoning as in-product chat; Discord handles voice. Decision: May 2026.
- **In-product friends list / social features** — friends-only deployment scale; social features add complexity without addressing a real problem at this scale. Decision: May 2026.
- **Chart background ambient sound** — FXReplay has bundled ambient sound (lofi/rain/cafe). Initial reaction was "gimmicky." *Note: technically distinct from the "In-app music/audio integration" entry under Under consideration, which is about controlling EXTERNAL music (Spotify etc.). Bundled ambient = explicitly skipped. External music control = under consideration.* Decision: May 2026.
