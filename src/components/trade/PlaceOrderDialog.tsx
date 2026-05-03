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

  // Reset to current price suggestions when the dialog opens
  useEffect(() => {
    if (!open) return;
    const price = useReplayStore.getState().engine?.getCurrentPrice() ?? 0;
    form.reset({
      type: "market",
      size: defaultSize,
      limitPrice: price ? Number(price.toFixed(inst.priceDecimals)) : undefined,
      stopPrice: price ? Number(price.toFixed(inst.priceDecimals)) : undefined,
      stopLoss: undefined,
      takeProfit: undefined,
    });
  }, [open, defaultSize, form, inst.priceDecimals]);

  // RHF's watch returns a fresh function each render. The compiler-incompatible
  // warning is intentional: we want the type field to drive a re-render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const orderType: OrderType = form.watch("type");

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

            <label className="text-xs uppercase tracking-wide text-muted-foreground">Stop loss</label>
            <Input
              type="number"
              step={step}
              {...form.register("stopLoss")}
              className="h-8 font-mono text-sm"
              placeholder="optional"
            />

            <label className="text-xs uppercase tracking-wide text-muted-foreground">Take profit</label>
            <Input
              type="number"
              step={step}
              {...form.register("takeProfit")}
              className="h-8 font-mono text-sm"
              placeholder="optional"
            />
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
            <button type="submit" className={cn("rounded-full px-6 py-2 text-sm font-semibold transition-opacity hover:opacity-90", sideColor)}>
              {side === "buy" ? "Place buy" : "Place sell"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
