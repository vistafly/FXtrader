import type { Instrument } from "@/types/instrument";

// Session hours coverage:
//   forex (EURUSD, GBPUSD, USDJPY) → "forex" preset
//   CME futures (NQ1!, ES1!)        → "cme-futures" preset
// Any future instrument should set sessionHours when added; the closed-
// market overlay does NOT render for instruments without a preset.

export const EURUSD: Instrument = {
  symbol: "EURUSD",
  displayName: "EUR/USD",
  class: "forex",
  pipSize: 0.0001,
  tickSize: 0.00001,
  tickValue: 1, // USD per 0.00001 move per standard lot (100,000 units)
  contractSize: 100_000,
  marginPerContract: 1_000, // 100:1 simulated leverage
  commission: 3.5, // USD per side per standard lot
  priceDecimals: 5,
  sessionHours: "forex",
};

export const GBPUSD: Instrument = {
  symbol: "GBPUSD",
  displayName: "GBP/USD",
  class: "forex",
  pipSize: 0.0001,
  tickSize: 0.00001,
  tickValue: 1,
  contractSize: 100_000,
  marginPerContract: 1_000,
  commission: 3.5,
  priceDecimals: 5,
  sessionHours: "forex",
};

export const USDJPY: Instrument = {
  symbol: "USDJPY",
  displayName: "USD/JPY",
  class: "forex",
  pipSize: 0.01,
  tickSize: 0.001,
  tickValue: 1, // USD per 0.001 move on a standard lot, varies by USDJPY rate; approximation suitable for sim
  contractSize: 100_000,
  marginPerContract: 1_000,
  commission: 3.5,
  priceDecimals: 3,
  sessionHours: "forex",
};

export const NQ1: Instrument = {
  symbol: "NQ1!",
  displayName: "Nasdaq 100 Futures",
  class: "futures",
  pipSize: 0.25, // for display; futures pip ≡ tick
  tickSize: 0.25,
  tickValue: 5, // $5 per 0.25 point per contract
  contractSize: 20, // $20 multiplier per index point
  marginPerContract: 18_000,
  commission: 2.5,
  priceDecimals: 2,
  sessionHours: "cme-futures",
};

export const ES1: Instrument = {
  symbol: "ES1!",
  displayName: "S&P 500 Futures",
  class: "futures",
  pipSize: 0.25,
  tickSize: 0.25,
  tickValue: 12.5, // $12.50 per 0.25 point per contract
  contractSize: 50,
  marginPerContract: 13_000,
  commission: 2.5,
  priceDecimals: 2,
  sessionHours: "cme-futures",
};

export const INSTRUMENTS: Record<string, Instrument> = {
  EURUSD,
  GBPUSD,
  USDJPY,
  "NQ1!": NQ1,
  "ES1!": ES1,
};

export function getInstrument(symbol: string): Instrument {
  const inst = INSTRUMENTS[symbol];
  if (!inst) throw new Error(`Unknown instrument: ${symbol}`);
  return inst;
}
