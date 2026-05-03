export type InstrumentClass = "forex" | "futures";

export interface Instrument {
  symbol: string;
  displayName: string;
  class: InstrumentClass;
  pipSize: number;
  tickSize: number;
  tickValue: number;
  contractSize: number;
  marginPerContract: number;
  commission: number;
  priceDecimals: number;
}
