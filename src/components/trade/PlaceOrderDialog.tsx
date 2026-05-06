"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uiPreCheckBattleRule } from "@/lib/battles/uiGuard";
import { getInstrument } from "@/lib/instruments/instruments";
import { cn } from "@/lib/utils";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { OrderSide, OrderType } from "@/types/order";

// `<Input type="number">` reports its value as a string. Empty inputs come
// through as `""`, which `z.coerce.number()` would turn into `NaN` and then
// `.positive()` would reject — even when the field is optional. preprocess
// normalizes empties to `undefined` BEFORE the inner schema runs.
const optionalPositiveNumber = z.preprocess(
  (v) => (v === "" || v === undefined || v === null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
  z.coerce.number().positive().optional(),
);

const schema = z
  .object({
    type: z.enum(["market", "limit", "stop"]),
    size: z.coerce.number().positive("Size must be > 0"),
    limitPrice: optionalPositiveNumber,
    stopPrice: optionalPositiveNumber,
    stopLoss: optionalPositiveNumber,
    takeProfit: optionalPositiveNumber,
  })
  .refine(
    (v) => v.type !== "limit" || v.limitPrice !== undefined,
    { message: "Limit price required", path: ["limitPrice"] },
  )
  .refine(
    (v) => v.type !== "stop" || v.stopPrice !== undefined,
    { message: "Stop price required", path: ["stopPrice"] },
  );

type FormValues = z.input<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  side: OrderSide;
  symbol: string;
  defaultSize: number;
}

export function PlaceOrderDialog({ open, onOpenChange, side, symbol, defaultSize }: Props) {
  const inst = getInstrument(symbol);
  const session = useSessionStore((s) => s.activeSession);
  const submitOrder = useOrderStore((s) => s.submitOrder);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "market",
      size: defaultSize,
      limitPrice: undefined,
      stopPrice: undefined,
      stopLoss: undefined,
      takeProfit: undefined,
    },
  });

  // Reset to current price suggestions when the dialog opens.
  // v2.2.5α: read the per-instrument engine, not the global active one,
  // so the dialog's pivot is correct even when opened for a non-focused pane.
  useEffect(() => {
    if (!open) return;
    const price =
      useReplayStore.getState().getEngine(symbol)?.getCurrentPrice() ?? 0;
    form.reset({
      type: "market",
      size: defaultSize,
      limitPrice: price ? Number(price.toFixed(inst.priceDecimals)) : undefined,
      stopPrice: price ? Number(price.toFixed(inst.priceDecimals)) : undefined,
      stopLoss: undefined,
      takeProfit: undefined,
    });
  }, [open, defaultSize, form, inst.priceDecimals, symbol]);

  // RHF's watch() can't be memoized; the rule is informational. We rely on
  // the dialog's form-driven re-render cadence — pip↔price conversion stays
  // current because every input edit triggers a re-render via watch.
  // eslint-disable-next-line react-hooks/incompatible-library
  const orderType: OrderType = form.watch("type");
  const watchedLimit = form.watch("limitPrice");
  const watchedStopP = form.watch("stopPrice");
  const watchedSl = form.watch("stopLoss");
  const watchedTp = form.watch("takeProfit");

  // Pivot = the price the order will fill at. Drives pip↔price conversion
  // for SL / TP. Recomputed on each render so the UI tracks form edits live.
  const pivotPrice =
    orderType === "market"
      ? (useReplayStore.getState().getEngine(symbol)?.getCurrentPrice() ?? 0)
      : orderType === "limit"
        ? Number(watchedLimit ?? 0)
        : Number(watchedStopP ?? 0);

  // Helpers: pips ↔ price. Pivot of 0 disables conversion (e.g. before
  // the engine has a current bar or before user enters a limit price).
  const priceToPips = (price: number | undefined) => {
    if (price == null || pivotPrice <= 0) return "";
    const pips = Math.abs(pivotPrice - price) / inst.pipSize;
    if (!Number.isFinite(pips)) return "";
    return pips.toFixed(1);
  };
  const slPipsDisplay = priceToPips(
    watchedSl != null ? Number(watchedSl) : undefined,
  );
  const tpPipsDisplay = priceToPips(
    watchedTp != null ? Number(watchedTp) : undefined,
  );

  const onSlPipsChange = (raw: string) => {
    if (raw === "") {
      form.setValue("stopLoss", undefined, { shouldValidate: false });
      return;
    }
    const pips = Number(raw);
    if (!Number.isFinite(pips) || pips <= 0 || pivotPrice <= 0) return;
    const delta = pips * inst.pipSize;
    const newPrice = side === "buy" ? pivotPrice - delta : pivotPrice + delta;
    form.setValue("stopLoss", Number(newPrice.toFixed(inst.priceDecimals)), {
      shouldValidate: false,
    });
  };
  const onTpPipsChange = (raw: string) => {
    if (raw === "") {
      form.setValue("takeProfit", undefined, { shouldValidate: false });
      return;
    }
    const pips = Number(raw);
    if (!Number.isFinite(pips) || pips <= 0 || pivotPrice <= 0) return;
    const delta = pips * inst.pipSize;
    const newPrice = side === "buy" ? pivotPrice + delta : pivotPrice - delta;
    form.setValue(
      "takeProfit",
      Number(newPrice.toFixed(inst.priceDecimals)),
      { shouldValidate: false },
    );
  };

  // Battle's requireStopLoss flag — drives the inline "required" badge and
  // the disabled state of the submit button when SL is missing.
  const battle = useSessionStore((s) => s.activeBattle);
  const slRequired = !!battle?.rules?.requireStopLoss;
  const slMissing = slRequired && (watchedSl == null || watchedSl === "");

  const onSubmit = form.handleSubmit(async (values) => {
    if (!session) {
      toast.error("Start a session first.");
      return;
    }
    const order = {
      sessionId: session.id,
      instrument: symbol,
      side,
      type: values.type,
      size: Number(values.size),
      limitPrice: values.limitPrice != null ? Number(values.limitPrice) : undefined,
      stopPrice: values.stopPrice != null ? Number(values.stopPrice) : undefined,
      stopLoss: values.stopLoss != null ? Number(values.stopLoss) : undefined,
      takeProfit: values.takeProfit != null ? Number(values.takeProfit) : undefined,
    };
    if (!uiPreCheckBattleRule(order)) return;
    try {
      await submitOrder(order);
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    toast.success(
      `${side === "buy" ? "Buy" : "Sell"} ${values.size} ${symbol} ${values.type} order pending.`,
    );
    onOpenChange(false);
  });

  const sideColor = side === "buy" ? "bg-bull text-bull-foreground" : "bg-bear text-bear-foreground";

  // step="any" sidesteps HTML5's grid-snapping validation. Zod handles
  // numeric correctness on submit; we don't need browser-side step enforcement.
  const step = "any";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={cn("uppercase tracking-wide", side === "buy" ? "text-bull" : "text-bear")}>
            {side} {symbol}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Place a {side} order for {symbol} with optional limit/stop trigger
            and SL/TP.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Type</label>
            <Select
              value={orderType}
              onValueChange={(v) => form.setValue("type", v as OrderType)}
            >
              <SelectTrigger className="h-8 font-mono text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">Market</SelectItem>
                <SelectItem value="limit">Limit</SelectItem>
                <SelectItem value="stop">Stop</SelectItem>
              </SelectContent>
            </Select>

            <label className="text-xs uppercase tracking-wide text-muted-foreground">Size</label>
            <Input
              type="number"
              step="any"
              min={0}
              {...form.register("size")}
              className="h-8 font-mono text-sm"
            />

            {orderType === "limit" && (
              <>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Limit</label>
                <Input
                  type="number"
                  step={step}
                  {...form.register("limitPrice")}
                  className="h-8 font-mono text-sm"
                />
              </>
            )}
            {orderType === "stop" && (
              <>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Stop</label>
                <Input
                  type="number"
                  step={step}
                  {...form.register("stopPrice")}
                  className="h-8 font-mono text-sm"
                />
              </>
            )}

            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Stop loss
              {slRequired && (
                <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.2em] text-bear">
                  required
                </span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                step={step}
                min={0}
                value={slPipsDisplay}
                onChange={(e) => onSlPipsChange(e.target.value)}
                className="h-8 font-mono text-sm"
                placeholder="pips"
                aria-label="Stop loss distance in pips"
              />
              <Input
                type="number"
                step={step}
                {...form.register("stopLoss")}
                className="h-8 font-mono text-sm"
                placeholder="price"
                aria-label="Stop loss price"
              />
            </div>

            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Take profit
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                step={step}
                min={0}
                value={tpPipsDisplay}
                onChange={(e) => onTpPipsChange(e.target.value)}
                className="h-8 font-mono text-sm"
                placeholder="pips"
                aria-label="Take profit distance in pips"
              />
              <Input
                type="number"
                step={step}
                {...form.register("takeProfit")}
                className="h-8 font-mono text-sm"
                placeholder="price"
                aria-label="Take profit price"
              />
            </div>
          </div>

          {form.formState.errors.limitPrice && (
            <p className="text-xs text-destructive">{form.formState.errors.limitPrice.message}</p>
          )}
          {form.formState.errors.stopPrice && (
            <p className="text-xs text-destructive">{form.formState.errors.stopPrice.message}</p>
          )}
          {form.formState.errors.size && (
            <p className="text-xs text-destructive">{form.formState.errors.size.message}</p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <button
              type="submit"
              disabled={slMissing}
              title={slMissing ? "Stop loss required by battle rules" : undefined}
              className={cn(
                "rounded-full px-6 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                sideColor,
              )}
            >
              {side === "buy" ? "Place buy" : "Place sell"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
