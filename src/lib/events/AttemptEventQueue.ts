/**
 * v2.3 sub-phase 2: client-side append queue for the attempt event log.
 *
 * Responsibilities:
 *   - Assign monotonic seq numbers per attempt (idempotency anchor)
 *   - Buffer events in-memory and flush to Convex via the injected
 *     `appendEvent` mutation
 *   - Surface seq-gap rejections from the server as a fatal sync
 *     error (the queue stops flushing and exposes the error so the
 *     UI can inform the user that resume is no longer safe)
 *   - On transient network errors: retry with backoff
 *
 * Out of scope for sub-phase 2 (v2.x hardening):
 *   - On-disk persistence of unflushed events (Dexie buffer for
 *     offline windows). Today: queue lives in memory; closing the
 *     tab during an outage drops unflushed events. Acceptable at
 *     friends-only scale; revisit when public lobbies open.
 *
 * Module-scoped singleton: there's at most one in-flight attempt per
 * tab. The trade page calls `initialize(attemptId, lastSeq)` on boot
 * and `setAppendMutation(fn)` once the Convex client is ready.
 */

import type { AttemptEvent } from "./AttemptEvent";

/**
 * Distributive Omit. Default `Omit<U, K>` collapses a discriminated
 * union into a single intersection — losing the narrowing — so
 * callers can't pass `{ type: "submit-order", orderId: ... }` to
 * enqueue without a TS error. This variant strips the key from each
 * member of the union individually.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type AttemptEventInput = DistributiveOmit<AttemptEvent, "seq">;

/**
 * The bound Convex mutation for appendEvent. Trade page injects via
 * `setAppendMutation(useConvexMutation(api.attempts.appendEvent))`.
 *
 * Returns a promise that resolves on server ack or rejects on any
 * server-side validation error (seq gap, ownership, status mismatch).
 */
export type AppendEventFn = (args: {
  attemptId: string;
  seq: number;
  type: string;
  payload: unknown;
  time: number;
}) => Promise<unknown>;

interface QueueState {
  attemptId: string | null;
  /** Next seq to assign on enqueue. Initialized to lastEventSeq + 1
   *  on attempt boot; advances by 1 per enqueue call. */
  nextSeq: number;
  /** Events accepted from callers but not yet ack'd by Convex. */
  pending: AttemptEvent[];
  /** True while the flush loop is active. Prevents re-entry. */
  flushing: boolean;
  /** Set when a server-side rejection makes resume unsafe (seq gap,
   *  attempt-not-in-flight, etc.). UI surfaces this as "your attempt
   *  couldn't be synced; refresh to recover" rather than retrying. */
  syncError: { message: string; kind: string; eventSeq: number } | null;
  appendMutation: AppendEventFn | null;
}

const RETRY_DELAY_MS = 2000;

const state: QueueState = {
  attemptId: null,
  nextSeq: 0,
  pending: [],
  flushing: false,
  syncError: null,
  appendMutation: null,
};

const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

export const attemptEventQueue = {
  /**
   * Bind the Convex appendEvent mutation. Called once after the
   * Convex client is ready. Pass `null` to unbind (e.g. on logout).
   */
  setAppendMutation(fn: AppendEventFn | null) {
    state.appendMutation = fn;
    if (fn && state.pending.length > 0) {
      void this.flush();
    }
  },

  /**
   * Begin tracking events for an attempt. `lastEventSeq` is the
   * server's current value (-1 for fresh attempts; the resume path
   * passes the value from the persisted battleAttempts row).
   */
  initialize(attemptId: string, lastEventSeq: number) {
    state.attemptId = attemptId;
    state.nextSeq = lastEventSeq + 1;
    state.pending = [];
    state.flushing = false;
    state.syncError = null;
    notify();
  },

  /** Tear down. Used on session end / logout / route change away from /trade. */
  reset() {
    state.attemptId = null;
    state.nextSeq = 0;
    state.pending = [];
    state.flushing = false;
    state.syncError = null;
    notify();
  },

  /**
   * Append an event to the queue. Assigns the next seq, returns the
   * full event so callers can reflect it locally (e.g. tests, debug
   * logging). Kicks the async flush loop.
   *
   * Returns null if no attempt is currently being tracked — events
   * outside an active attempt context are silently dropped (e.g.
   * single-player sessions in the v1 flow). This is intentional: not
   * every session is a competitive attempt.
   */
  enqueue(event: AttemptEventInput): AttemptEvent | null {
    if (!state.attemptId) return null;
    if (state.syncError) return null; // Queue is in fatal-error state.
    const seq = state.nextSeq++;
    const full = { ...event, seq } as AttemptEvent;
    state.pending.push(full);
    void this.flush();
    return full;
  },

  /**
   * Drain pending events to Convex. Idempotent / re-entrant-safe via
   * the `flushing` flag. On transient error: retries after a delay.
   * On server-side rejection (seq-gap, ownership, status): sets
   * syncError and stops — UI is responsible for surfacing it.
   */
  async flush(): Promise<void> {
    if (state.flushing) return;
    if (!state.attemptId || !state.appendMutation) return;
    if (state.pending.length === 0) return;
    if (state.syncError) return;

    state.flushing = true;
    notify();
    try {
      while (state.pending.length > 0 && !state.syncError) {
        const event = state.pending[0];
        try {
          await state.appendMutation({
            attemptId: state.attemptId,
            seq: event.seq,
            type: event.type,
            payload: event,
            time: event.time,
          });
          state.pending.shift();
        } catch (e) {
          // Distinguish server-validation errors (fatal — stop) from
          // transient network errors (retry).
          const err = e as { data?: { kind?: string; message?: string }; message?: string };
          const kind = err?.data?.kind;
          if (
            kind === "seq-gap" ||
            kind === "attempt-not-in-flight" ||
            kind === "forbidden" ||
            kind === "attempt-not-found"
          ) {
            state.syncError = {
              message:
                err?.data?.message ?? err?.message ?? "Sync rejected by server",
              kind,
              eventSeq: event.seq,
            };
            notify();
            return;
          }
          // Transient — retry after delay.
          state.flushing = false;
          notify();
          await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
          void this.flush();
          return;
        }
      }
    } finally {
      state.flushing = false;
      notify();
    }
  },

  /** Subscribe to queue state changes (UI uses this to show sync status). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Read-only snapshot of current state for UI/tests. */
  getState(): {
    attemptId: string | null;
    nextSeq: number;
    pendingCount: number;
    flushing: boolean;
    syncError: QueueState["syncError"];
  } {
    return {
      attemptId: state.attemptId,
      nextSeq: state.nextSeq,
      pendingCount: state.pending.length,
      flushing: state.flushing,
      syncError: state.syncError,
    };
  },

  /**
   * Test-only: drain the queue synchronously by invoking the
   * mutation in-line. Skips the async loop so unit tests don't have
   * to await flush + retry timers. Returns the events that were
   * delivered. Throws on server rejection.
   */
  __testDrain(): AttemptEvent[] {
    const drained = [...state.pending];
    state.pending = [];
    return drained;
  },
};
