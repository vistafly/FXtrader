"use client";

import { useMutation, useQuery } from "convex/react";
import { Crown, Globe, Lock, Play, Shield, Swords, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface Props {
  battleId: Id<"battles">;
  battleName: string;
  instruments: string[];
  durationMinutes: number;
  startingBalance: number;
  maxParticipants: number;
  visibility: "public" | "invite-only";
  inviteCode: string | null | undefined;
  rules: {
    maxDrawdownPct?: number;
    maxLossPerTradePct?: number;
    requireStopLoss?: boolean;
    profitTargetPct?: number;
  } | undefined;
  startedAt: number | null | undefined;
  /** True iff the current user is the creator. Drives the Start-match button. */
  isCreator: boolean;
  /**
   * Fired when the user (creator or joiner) should auto-launch into
   * trade. Caller is responsible for the actual startAttempt /
   * resumeAttempt flow + navigation.
   */
  onLaunch: () => void;
  /** Fired when the creator clicks "Start match". Caller calls the
   *  startMatch Convex mutation; auto-launch then fires via the
   *  startedAt-watch effect. */
  onStartMatch: () => Promise<void> | void;
  copyInviteLink?: () => void;
  /** When true, the launch action is in progress — disable the button. */
  launching?: boolean;
  launchingLabel?: string;
}

/**
 * v2.3 sub-phase 2B: immersive waiting room. Reference visual:
 * `references/waiting-room.png`.
 *
 * Layout:
 *   - Full-bleed dark gradient background (overrides the page chrome)
 *   - Battle name + countdown / status banner top-center
 *   - Two-column body:
 *       Left:  Rules card
 *       Right: Participants grid with avatar bubbles
 *   - Hero CTA at the bottom: "Start match" (creator) /
 *     "Waiting for host…" (joiner). Auto-launches all participants
 *     into trade once `startedAt` flips on the battle row.
 *
 * Real-time presence: this component manages joinLobby on mount /
 * leaveLobby on unmount. The members list is a live Convex query
 * so users see each other arrive/leave without polling.
 */
export function WaitingRoom(props: Props) {
  const {
    battleId,
    battleName,
    instruments,
    durationMinutes,
    startingBalance,
    maxParticipants,
    visibility,
    inviteCode,
    rules,
    startedAt,
    isCreator,
    onLaunch,
    onStartMatch,
    copyInviteLink,
    launching,
    launchingLabel,
  } = props;

  const router = useRouter();

  const myProfile = useQuery(api.profiles.getMyProfile, {});
  const members = useQuery(api.lobby.listLobbyMembers, { battleId });
  const joinLobbyMut = useMutation(api.lobby.joinLobby);
  const leaveLobbyMut = useMutation(api.lobby.leaveLobby);

  // Join the lobby on mount; leave on unmount. Refresh joinedAt
  // every 60s while open so the stale-prune on the server doesn't
  // drop us if we sit on the page for a while.
  useEffect(() => {
    if (!myProfile) return;
    const displayName = myProfile.displayName || "player";
    void joinLobbyMut({ battleId, displayName });
    const refresh = setInterval(() => {
      void joinLobbyMut({ battleId, displayName });
    }, 60_000);
    return () => {
      clearInterval(refresh);
      void leaveLobbyMut({ battleId });
    };
  }, [battleId, joinLobbyMut, leaveLobbyMut, myProfile]);

  // v2.3 sub-phase 2B: broadcast launch. When `startedAt` flips,
  // the auto-redirect effect fires onLaunch exactly once. Ref
  // guard prevents re-fires on subsequent re-renders while the
  // launch is in flight.
  const launchedRef = useRef(false);
  useEffect(() => {
    if (launchedRef.current) return;
    if (!startedAt) return;
    launchedRef.current = true;
    queueMicrotask(() => onLaunch());
  }, [startedAt, onLaunch]);

  const [startingMatch, setStartingMatch] = useState(false);
  const onStartClick = async () => {
    if (startingMatch || launching) return;
    setStartingMatch(true);
    try {
      await onStartMatch();
    } catch (err) {
      toast.error(`Could not start match: ${(err as Error).message}`);
    } finally {
      setStartingMatch(false);
    }
  };

  const matchStarted = !!startedAt;
  const memberList = members ?? [];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.12),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(56,189,248,0.08),transparent_50%)]">
      {/* Subtle grid background, in addition to the gradient. */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
        {/* Top bar: back-affordance + meta chips */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push("/battles")}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            ← Battles
          </button>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {visibility === "public" ? (
              <span className="inline-flex items-center gap-1">
                <Globe className="h-3 w-3" /> Public
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" /> Invite-only
              </span>
            )}
          </div>
        </div>

        {/* Hero — battle name + state banner */}
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-primary">
            <Swords className="h-3 w-3" />
            {matchStarted
              ? "Match starting"
              : isCreator
                ? "Your lobby"
                : "Waiting room"}
          </div>
          <h1 className="bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
            {battleName}
          </h1>
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {instruments.join(" · ")} · {durationMinutes} min · $
            {startingBalance.toLocaleString()}
          </p>
        </div>

        {/* Body: rules + participants */}
        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          {/* Rules */}
          <div className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur">
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Battle rules
              </h2>
            </div>
            <ul className="space-y-2.5 text-sm">
              <RuleRow
                label="Profit target"
                value={
                  rules?.profitTargetPct !== undefined
                    ? `+${rules.profitTargetPct}%`
                    : "None"
                }
                tone={rules?.profitTargetPct !== undefined ? "good" : null}
              />
              <RuleRow
                label="Max drawdown"
                value={
                  rules?.maxDrawdownPct !== undefined
                    ? `${rules.maxDrawdownPct}%`
                    : "None"
                }
                tone={rules?.maxDrawdownPct !== undefined ? "warn" : null}
              />
              <RuleRow
                label="Max loss / trade"
                value={
                  rules?.maxLossPerTradePct !== undefined
                    ? `${rules.maxLossPerTradePct}%`
                    : "None"
                }
                tone={rules?.maxLossPerTradePct !== undefined ? "warn" : null}
              />
              <RuleRow
                label="Stop loss"
                value={rules?.requireStopLoss ? "Required" : "Optional"}
                tone={rules?.requireStopLoss ? "warn" : null}
              />
            </ul>
          </div>

          {/* Participants */}
          <div className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  Participants
                </h2>
              </div>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {memberList.length} / {maxParticipants}
              </span>
            </div>

            {memberList.length === 0 ? (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/50 text-sm text-muted-foreground">
                <span>Waiting for someone to join…</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {memberList.map((m) => (
                  <ParticipantBubble
                    key={m._id}
                    name={m.displayName}
                    isMe={myProfile?.userId === m.userId}
                  />
                ))}
                {/* Empty slots up to maxParticipants */}
                {Array.from(
                  { length: Math.max(0, maxParticipants - memberList.length) },
                  (_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="flex aspect-square items-center justify-center rounded-full border border-dashed border-border/30 bg-background/40 text-xs text-muted-foreground/40"
                    >
                      ?
                    </div>
                  ),
                )}
              </div>
            )}

            {inviteCode && copyInviteLink && (
              <button
                onClick={copyInviteLink}
                className="mt-4 w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                Copy invite link
              </button>
            )}
          </div>
        </div>

        {/* Hero CTA */}
        <div className="mt-auto flex flex-col items-center gap-2 pb-4">
          {matchStarted ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                Match started
              </div>
              <p className="text-sm text-muted-foreground">
                Loading your trade view…
              </p>
            </div>
          ) : isCreator ? (
            <Button
              size="lg"
              onClick={onStartClick}
              disabled={startingMatch || launching}
              className="h-12 px-8 text-base"
            >
              <Play className="mr-2 h-5 w-5" />
              {startingMatch || launching
                ? launchingLabel ?? "Starting match…"
                : "Start match"}
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-4 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                <Crown className="h-3.5 w-3.5" />
                Waiting for host to start
              </div>
              <p className="max-w-md text-xs text-muted-foreground">
                Once the host starts the match, all participants will be
                launched into trade together.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | null;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm",
          tone === "good" && "text-bull",
          tone === "warn" && "text-bear",
          tone === null && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </li>
  );
}

function ParticipantBubble({ name, isMe }: { name: string; isMe: boolean }) {
  // First two letters as a pseudo-avatar. Subtle gradient bg so the
  // bubbles read as "filled with personality" rather than empty
  // placeholders.
  const initials = name.slice(0, 2).toUpperCase();
  const hue = hashHue(name);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          "relative flex aspect-square w-full items-center justify-center rounded-full font-semibold transition-transform",
          "ring-2 ring-offset-2 ring-offset-background",
          isMe ? "ring-primary scale-105" : "ring-border/50",
        )}
        style={{
          background: `radial-gradient(circle at 30% 30%, hsl(${hue} 80% 55%), hsl(${(hue + 40) % 360} 70% 35%))`,
        }}
      >
        <span className="text-base text-white drop-shadow">{initials}</span>
        {/* Live dot */}
        <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" />
      </div>
      <span
        className={cn(
          "max-w-full truncate font-mono text-[10px] uppercase tracking-wider",
          isMe ? "text-primary" : "text-muted-foreground",
        )}
        title={name}
      >
        {isMe ? "You" : name}
      </span>
    </div>
  );
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}
