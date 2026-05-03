export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type OrderStatus = "pending" | "filled" | "cancelled" | "rejected";

export interface Order {
  id: string;
  sessionId: string;
  instrument: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  filledPrice?: number;
  rejectionReason?: string;
}
