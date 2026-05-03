import type { OrderSide } from "./order";
import type { PositionCloseReason } from "./position";

export interface Trade {
  id: string;
  sessionId: string;
  instrument: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  pnl: number;
  pips: number;
  commission: number;
  duration: number;
  closeReason: PositionCloseReason;
  notes?: string;
  tags?: string[];
}
