# FXTrader

> Replay historical markets, sharpen your edge.

A desktop-first web application for traders to practice on historical market data candle-by-candle with simulated order placement. Inspired by [FXReplay](https://app.fxreplay.com), but free, local, and fully owned by the user.

## Status

**Phase 1 scaffold complete.** The application is in active build-out per the master spec. See [`../CLAUDE.md`](../CLAUDE.md) for the full specification and phase plan.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build |
| `pnpm typecheck` | TypeScript check (no emit) |
| `pnpm lint` | ESLint |
| `pnpm test` | Run unit tests once |
| `pnpm test:watch` | Run unit tests in watch mode |
| `pnpm fetch-data` | (Phase 3) Build bundled sample datasets into `public/data/` |

## Tech stack

- Next.js 16 (App Router) · React 19 · TypeScript (strict)
- Tailwind CSS v3 · shadcn/ui (new-york style, neutral base) · Lucide icons
- Zustand · Dexie · TanStack Query/Table · React Hook Form + Zod
- Vitest · Testing Library

A full README — including the TradingView Trading Platform upgrade path, keyboard shortcuts, and roadmap — will land in Phase 8 per [CLAUDE.md §14](../CLAUDE.md).
