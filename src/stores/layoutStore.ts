import { create } from "zustand";

import type {
  SessionLayoutState,
  SessionPaneState,
} from "@/types/session";

/**
 * v2.2.5α: layout / per-pane state for the multi-pane trade workspace.
 *
 * 5α scope:
 * - Hardcoded auto-layout derived from instrument count: 1 → "1pane",
 *   2-4 → "4quad", 5 → "6pane".
 * - Each pane has a fixed instrument (battle.instruments[paneIndex] with
 *   wrap-around when more panes than instruments) and timeframe "1".
 * - Click a pane to focus it (= activePaneIndex).
 * - U3: callers track focus changes and close any open Place Order dialog.
 *
 * 5β will:
 * - Add LayoutSelector (free choice of layout regardless of instrument count).
 * - Add per-pane instrument + timeframe dropdowns.
 * - Add drag/swap of pane state blobs.
 * - Persist layout to IndexedDB on every change.
 */
export type Layout =
  | "1pane"
  | "2vertical"
  | "2horizontal"
  | "4quad"
  | "6pane";

export interface SlPreview {
  symbol: string;
  /** SL preview prices when the user has typed an SL value. Optional —
   *  undefined when the user only set a TP or only set a trigger price
   *  (limit/stop) without any SL/TP yet. */
  longPrice?: number;
  shortPrice?: number;
  /** TP preview prices when the user has typed a TP value. Optional —
   *  SL alone, TP alone, or both are valid. */
  tpLongPrice?: number;
  tpShortPrice?: number;
  /**
   * v2.2.5α: trigger price preview for limit/stop orders. When set,
   * ChartContainer draws a dotted line at this price showing where the
   * pending order will sit on the chart — distinct from SL/TP lines so
   * the user can read the full setup before submitting. Undefined for
   * market orders (no trigger).
   */
  triggerPrice?: number;
  triggerKind?: "limit" | "stop";
}

export interface LayoutState {
  layout: Layout;
  panes: SessionPaneState[];
  activePaneIndex: number;
  /** Monotonic counter incremented on any focus change. UI can subscribe to
   *  close any open dialogs (U3) when this changes. */
  focusEpoch: number;
  /** v2.2.5α: the instruments the session was opened with. Used by setLayout
   *  to wrap-around-fill panes when the user switches layouts. */
  availableInstruments: string[];
  /**
   * v2.2.5α: drag-to-resize positions for grid splitters. Each value is a
   * fraction in (0, 1) representing the splitter's position along its axis.
   *
   *   cols: positions of vertical splitters (left→right); for a 3-col layout
   *         (6-pane), this has 2 entries: e.g. [0.33, 0.67].
   *   rows: positions of horizontal splitters (top→bottom).
   *
   * Grid track widths are derived from these by computing successive
   * differences (with implicit 0 and 1 endpoints).
   */
  gridSplits: { cols: number[]; rows: number[] };

  /** Initialize from battle/session inputs. Defaults to 1-pane; user opts into multi-pane via setLayout. */
  initFromInstruments: (instruments: string[], saved?: SessionLayoutState) => void;
  /**
   * v2.2.5α: change the layout. Re-fills panes from the session's instruments,
   * preserving pane 0's instrument when possible. Requires the session's
   * instruments[] (saved on layoutStore via initFromInstruments) so wrap-around
   * fill works correctly.
   */
  setLayout: (layout: Layout) => void;
  /**
   * Update one splitter's fractional position. Index is 0-based within the
   * axis. Clamped against neighboring splitters with a minimum 5% gap so
   * panes can't be made invisibly thin.
   */
  setGridSplit: (axis: "cols" | "rows", index: number, fraction: number) => void;

  /**
   * v2.2.5α: per-pane "scroll-to-latest" trigger. The trade chart pane has a
   * jump-to-today button at bottom-right; clicking it bumps this counter for
   * the pane's index. ChartContainer subscribes to changes for its own pane
   * index and calls `chartHandle.scrollToLatestBar()` on bump.
   *
   * Sparse map (index → counter) so unrelated panes don't churn re-renders.
   */
  scrollToLatestEpoch: Record<number, number>;
  /** Bump the scroll-to-latest counter for one pane. */
  requestScrollToLatest: (paneIndex: number) => void;
  /**
   * v2.2.5α: per-pane "is the latest bar currently in view?" flag.
   * ChartContainer subscribes to its chart's visible-range events and writes
   * here. ChartPane hides the Today button when true (no need to jump
   * forward — the latest bar is already on-screen).
   */
  paneIsAtLatest: Record<number, boolean>;
  /** Set whether the pane's latest bar is currently visible. */
  setPaneIsAtLatest: (paneIndex: number, atLatest: boolean) => void;
  /**
   * v2.2.5α: pre-trade SL placement preview. Written by QuickBuySellPanel as
   * the user types the SL distance (in pips, USD, or %); read by
   * ChartContainer to draw two dotted preview lines on the matching pane —
   * one above pivot (where a SHORT's SL would land) and one below (LONG's
   * SL). Cleared (null) when the input is empty or the order is submitted.
   */
  slPreview: SlPreview | null;
  setSlPreview: (preview: SlPreview | null) => void;
  /**
   * v2.2.5α: drag-overrides the preview's trigger price for limit/stop
   * orders. PositionDragOverlay writes here when the user drags the
   * preview line on the chart; QuickBuySellPanel reads here and uses it
   * as the trigger price (overriding its local input). Cleared when the
   * user submits the order or cycles back to market.
   */
  previewTriggerOverride: { symbol: string; price: number } | null;
  setPreviewTriggerOverride: (
    override: { symbol: string; price: number } | null,
  ) => void;
  /**
   * v2.2.5α: monotonic counter the preview chip's X button bumps when the
   * user clicks to dismiss the staged limit/stop preview. QuickBuySellPanel
   * subscribes to changes and clears its inputs (slText, tpText, triggerText)
   * so the preview goes away. Counter pattern (vs a boolean flag) so
   * subscribers see EVERY click event, even if they fire back-to-back.
   */
  clearPreviewEpoch: number;
  requestClearPreview: () => void;
  /** Set focus to pane index. Increments focusEpoch even if same index — caller can debounce. */
  setActivePane: (index: number) => void;
  /** Change a pane's instrument (5β surface; exposed in 5α for future use). */
  setPaneInstrument: (index: number, symbol: string) => void;
  /** Change a pane's timeframe (5β surface). */
  setPaneTimeframe: (index: number, timeframe: string) => void;
  /** Flush. Returns the serializable blob for persistence. */
  toLayoutState: () => SessionLayoutState;
  /** Tear down on session change / unmount. */
  reset: () => void;
}

/**
 * v2.2.5α: default to 1-pane regardless of instrument count. Multi-pane
 * layouts are opt-in via the LayoutSelector dropdown. Rationale (May 2026
 * spot-check): users found the auto-4quad confusing — they expect a single
 * chart by default and a dropdown to switch into multi-pane.
 */
function autoLayout(): Layout {
  return "1pane";
}

/**
 * Number of panes in each layout. 5α auto-fills: pane i shows
 * instruments[i % instrumentCount]. (Wrap-around handles the case where
 * 4-quad is used with 3 instruments — pane 3 duplicates instrument 0.)
 */
export function paneCountForLayout(layout: Layout): number {
  switch (layout) {
    case "1pane":
      return 1;
    case "2vertical":
    case "2horizontal":
      return 2;
    case "4quad":
      return 4;
    case "6pane":
      return 6;
  }
}

/**
 * Default splitter positions for a layout — even spacing.
 */
function defaultSplits(layout: Layout): { cols: number[]; rows: number[] } {
  switch (layout) {
    case "1pane":
      return { cols: [], rows: [] };
    case "2vertical":
      return { cols: [], rows: [0.5] };
    case "2horizontal":
      return { cols: [0.5], rows: [] };
    case "4quad":
      return { cols: [0.5], rows: [0.5] };
    case "6pane":
      return { cols: [1 / 3, 2 / 3], rows: [0.5] };
  }
}

function fillPanes(
  layout: Layout,
  instruments: string[],
  preserve?: SessionPaneState[],
): SessionPaneState[] {
  const count = paneCountForLayout(layout);
  const panes: SessionPaneState[] = [];
  for (let i = 0; i < count; i++) {
    // Preserve pane i's prior state if present (keeps user's mid-session
    // selection intact when growing the layout). Otherwise wrap around the
    // available instruments.
    const prior = preserve?.[i];
    if (prior) {
      panes.push(prior);
    } else {
      panes.push({
        instrument:
          instruments[i % Math.max(1, instruments.length)] ?? instruments[0] ?? "",
        timeframe: "1",
      });
    }
  }
  return panes;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layout: "1pane",
  panes: [],
  activePaneIndex: 0,
  focusEpoch: 0,
  availableInstruments: [],
  gridSplits: defaultSplits("1pane"),
  scrollToLatestEpoch: {},
  paneIsAtLatest: {},
  slPreview: null,
  previewTriggerOverride: null,
  clearPreviewEpoch: 0,

  initFromInstruments: (instruments, saved) => {
    if (saved && saved.panes.length > 0) {
      // Honor persisted state from a prior session reload.
      set({
        layout: saved.layout,
        panes: saved.panes,
        activePaneIndex: Math.max(
          0,
          Math.min(saved.activePaneIndex, saved.panes.length - 1),
        ),
        focusEpoch: get().focusEpoch + 1,
        availableInstruments: instruments,
        gridSplits: defaultSplits(saved.layout),
      });
      return;
    }
    if (instruments.length === 0) {
      set({
        layout: "1pane",
        panes: [],
        activePaneIndex: 0,
        availableInstruments: [],
        gridSplits: defaultSplits("1pane"),
      });
      return;
    }
    const layout = autoLayout();
    set({
      layout,
      panes: fillPanes(layout, instruments),
      activePaneIndex: 0,
      focusEpoch: get().focusEpoch + 1,
      availableInstruments: instruments,
      gridSplits: defaultSplits(layout),
    });
  },

  setLayout: (layout) => {
    const state = get();
    if (state.availableInstruments.length === 0) return;
    set({
      layout,
      panes: fillPanes(layout, state.availableInstruments, state.panes),
      // Keep focus where it is if it still resolves; otherwise snap to 0.
      activePaneIndex:
        state.activePaneIndex < paneCountForLayout(layout)
          ? state.activePaneIndex
          : 0,
      focusEpoch: state.focusEpoch + 1,
      gridSplits: defaultSplits(layout),
    });
  },

  setGridSplit: (axis, index, fraction) => {
    set((state) => {
      const arr = state.gridSplits[axis].slice();
      if (index < 0 || index >= arr.length) return state;
      const min = index === 0 ? 0.05 : arr[index - 1] + 0.05;
      const max = index === arr.length - 1 ? 0.95 : arr[index + 1] - 0.05;
      arr[index] = Math.max(min, Math.min(max, fraction));
      return { gridSplits: { ...state.gridSplits, [axis]: arr } };
    });
  },

  requestScrollToLatest: (paneIndex) => {
    set((state) => ({
      scrollToLatestEpoch: {
        ...state.scrollToLatestEpoch,
        [paneIndex]: (state.scrollToLatestEpoch[paneIndex] ?? 0) + 1,
      },
    }));
  },

  setSlPreview: (preview) => {
    set({ slPreview: preview });
  },

  setPreviewTriggerOverride: (override) => {
    set({ previewTriggerOverride: override });
  },

  requestClearPreview: () => {
    set((state) => ({ clearPreviewEpoch: state.clearPreviewEpoch + 1 }));
  },

  setPaneIsAtLatest: (paneIndex, atLatest) => {
    set((state) => {
      // Skip the update if the value didn't change — keeps unrelated
      // selectors from re-rendering on every visible-range tick.
      if (state.paneIsAtLatest[paneIndex] === atLatest) return state;
      return {
        paneIsAtLatest: {
          ...state.paneIsAtLatest,
          [paneIndex]: atLatest,
        },
      };
    });
  },

  setActivePane: (index) => {
    if (index < 0 || index >= get().panes.length) return;
    set({
      activePaneIndex: index,
      focusEpoch: get().focusEpoch + 1,
    });
  },

  setPaneInstrument: (index, symbol) => {
    set((state) => {
      if (index < 0 || index >= state.panes.length) return state;
      const next = state.panes.slice();
      next[index] = { ...next[index], instrument: symbol };
      return { panes: next };
    });
  },

  setPaneTimeframe: (index, timeframe) => {
    set((state) => {
      if (index < 0 || index >= state.panes.length) return state;
      const next = state.panes.slice();
      next[index] = { ...next[index], timeframe };
      return { panes: next };
    });
  },

  toLayoutState: () => {
    const s = get();
    return {
      layout: s.layout,
      panes: s.panes,
      activePaneIndex: s.activePaneIndex,
    };
  },

  reset: () => {
    set({
      layout: "1pane",
      panes: [],
      activePaneIndex: 0,
      focusEpoch: 0,
      availableInstruments: [],
      gridSplits: defaultSplits("1pane"),
      scrollToLatestEpoch: {},
      paneIsAtLatest: {},
      slPreview: null,
      previewTriggerOverride: null,
      clearPreviewEpoch: 0,
    });
  },
}));

/** Convenience selector: the active pane's instrument. Drives order routing. */
export const selectActiveInstrument = (s: LayoutState): string | null =>
  s.panes[s.activePaneIndex]?.instrument ?? null;
