/**
 * Phase 3 gate: console-only test session that loads bars via the
 * BundledDataProvider, initializes a ReplayEngine in the replayStore, and
 * ticks through the first N bars while printing bar events.
 *
 * Run: pnpm smoke
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BundledDataProvider } from "../src/lib/data/BundledDataProvider";
import { useReplayStore } from "../src/stores/replayStore";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = join(dirname(__filename), "..");
const dataDir = join(projectRoot, "public", "data");

// Pretend to fetch by reading from disk. Maps "/data/<file>" → public/data/<file>.
const nodeFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : (input as URL).toString();
  const rel = url.replace(/^\/data\//, "");
  const filePath = join(dataDir, rel);
  const buf = readFileSync(filePath);
  return new Response(buf);
};

async function main() {
  const SYMBOL = "EURUSD";
  const TICK_COUNT = 5;

  console.log(`smoke: loading ${SYMBOL} via BundledDataProvider...`);
  const provider = new BundledDataProvider({ baseUrl: "/data", fetch: nodeFetch });

  const config = await provider.onReady();
  console.log(`smoke: provider config → resolutions=[${config.supported_resolutions.join(",")}]`);

  // Wire store + engine. The store creates the engine internally via initEngine.
  const store = useReplayStore.getState();
  const events: string[] = [];
  // Manually subscribe to the store (the engine is created INSIDE loadInstrument →
  // initEngine). After load, we'll attach a direct engine listener so we can see
  // every bar tick.
  const { totalBars } = await store.loadInstrument(provider, SYMBOL, "1", 0);
  console.log(`smoke: loaded ${totalBars} bars; engine seated`);

  const engine = useReplayStore.getState().engine!;
  if (!engine) throw new Error("engine missing after loadInstrument");

  const unsub = engine.subscribe((e) => {
    if (e.type === "bar") {
      const t = new Date(e.bar.time * 1000).toISOString();
      events.push(`bar idx=${e.index.toString().padStart(5)} time=${t} c=${e.bar.close}`);
    } else {
      events.push(`evt ${e.type}`);
    }
  });

  // Step through TICK_COUNT bars deterministically (no real-time playback —
  // we just want to prove the wiring works).
  for (let i = 0; i < TICK_COUNT; i++) {
    engine.step("forward");
  }

  unsub();

  console.log("\nsmoke: events captured:");
  for (const ev of events) console.log("  " + ev);

  const stateAfter = useReplayStore.getState();
  console.log(
    `\nsmoke: store state → currentBarIndex=${stateAfter.currentBarIndex} ` +
      `currentBarTime=${new Date(stateAfter.currentBarTime * 1000).toISOString()} ` +
      `totalBars=${stateAfter.totalBars} isPlaying=${stateAfter.isPlaying}`,
  );

  if (stateAfter.currentBarIndex !== TICK_COUNT) {
    throw new Error(`Expected currentBarIndex=${TICK_COUNT}, got ${stateAfter.currentBarIndex}`);
  }
  if (events.filter((e) => e.startsWith("bar")).length !== TICK_COUNT) {
    throw new Error(`Expected ${TICK_COUNT} bar events, got ${events.filter((e) => e.startsWith("bar")).length}`);
  }
  console.log("\nsmoke: ✓ Phase 3 gate satisfied — data loads, engine ticks, events flow.");
}

main().catch((err) => {
  console.error("smoke: FAILED");
  console.error(err);
  process.exit(1);
});
