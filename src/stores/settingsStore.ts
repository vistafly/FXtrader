import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface SettingsState {
  theme: "dark" | "light";
  defaultLotSize: number;
  defaultStopLossPips: number;
  defaultTakeProfitPips: number;
  oneClickTradingEnabled: boolean;
  keyboardShortcutsEnabled: boolean;

  setTheme: (theme: "dark" | "light") => void;
  setDefaultLotSize: (size: number) => void;
  setDefaultStopLossPips: (pips: number) => void;
  setDefaultTakeProfitPips: (pips: number) => void;
  setOneClickTradingEnabled: (enabled: boolean) => void;
  setKeyboardShortcutsEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      defaultLotSize: 1,
      defaultStopLossPips: 20,
      defaultTakeProfitPips: 40,
      oneClickTradingEnabled: false,
      keyboardShortcutsEnabled: true,

      setTheme: (theme) => set({ theme }),
      setDefaultLotSize: (defaultLotSize) => set({ defaultLotSize }),
      setDefaultStopLossPips: (defaultStopLossPips) => set({ defaultStopLossPips }),
      setDefaultTakeProfitPips: (defaultTakeProfitPips) => set({ defaultTakeProfitPips }),
      setOneClickTradingEnabled: (oneClickTradingEnabled) => set({ oneClickTradingEnabled }),
      setKeyboardShortcutsEnabled: (keyboardShortcutsEnabled) => set({ keyboardShortcutsEnabled }),
    }),
    {
      name: "fxtrader-settings",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
