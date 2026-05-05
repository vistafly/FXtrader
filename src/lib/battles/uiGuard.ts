import { toast } from "sonner";

import { getInstrument } from "@/lib/instruments/instruments";
import { useSessionStore } from "@/stores/sessionStore";

import { checkBattleRule, type SubmittableOrderDraft } from "./guards";

/**
 * UI-side battle rule pre-check shared by every order-entry surface
 * (QuickBuySellPanel, PlaceOrderDialog, useKeyboardShortcuts M-shortcut).
 *
 * Returns true if the order is OK to submit; returns false (and shows a
 * toast) if a battle rule blocks it. The orderStore.submitOrder backstop
 * still runs — this function exists for inline UX feedback so the user
 * sees the violation message before the order round-trips.
 *
 * Note (v2.2.5α): when battles set requireStopLoss, this guard rejects
 * orders without an SL. Order-entry surfaces should expose a pips-or-price
 * SL input so the user can attach one before submitting.
 */
export function uiPreCheckBattleRule(
  draft: SubmittableOrderDraft & { instrument: string },
): boolean {
  const session = useSessionStore.getState().activeSession;
  const battle = useSessionStore.getState().activeBattle;
  if (!battle || !session || session.battleId !== battle.id) return true;

  const violation = checkBattleRule(draft, {
    battle,
    instrument: getInstrument(draft.instrument),
    currentBalance: useSessionStore.getState().balance,
  });
  if (violation) {
    toast.error(violation);
    return false;
  }
  return true;
}
