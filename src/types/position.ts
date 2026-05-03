import type { OrderSide } from "./order";

export type PositionStatus = "open" | "closed";
export type PositionCloseReason = "manual" | "tp" | "sl" | "liquidated";

export interface Position {
  id: string;
  sessionId: string;
  instrument: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  entryTime: number;
  takeProfit?: number;
  stopLoss?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  commission: number;
  status: PositionStatus;
  closedAt?: number;
  closePrice?: number;
  closeReason?: PositionCloseReason;
}
