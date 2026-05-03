# Trade-view screenshot

The README references `public/screenshot-trade.png` for the landing/preview
image. That file is not committed to the repo — capture it locally with the
recipe below and commit the result.

## Capture recipe

1. **Start the app**
   ```bash
   pnpm install
   pnpm fetch-data        # synthetic, deterministic
   pnpm dev               # http://localhost:3000
   ```

2. **Set up the scene**
   - From the dashboard, click **Start new session**
   - Name: anything (e.g. `Screenshot session`)
   - Instrument: **EURUSD**
   - Starting balance: **$10,000**
   - Land on `/trade/<sessionId>`

3. **Get the chart in a good visual state**
   - Press Play or step forward a few bars so the chart shows real candles
   - Click **Buy** to open a long position at the current price
   - Drag the **+ TP** chip onto the chart, place ~30 pips above entry
   - Drag the **+ SL** chip onto the chart, place ~15 pips below entry
   - Step forward a couple more bars so the position has non-zero unrealized P&L
   - Confirm the AccountHUD (top-right) shows a non-trivial P&L number

4. **Capture**
   - Resolution: **1600 × 900** (or 3200 × 1800 retina, then scale to 1600 wide)
   - Format: **PNG**
   - Save to: **`public/screenshot-trade.png`**

   On macOS: `Cmd+Shift+4`, drag, save. On Windows: Snipping Tool. On Chrome:
   DevTools → Cmd/Ctrl+Shift+P → "Capture full size screenshot" with the
   viewport sized to 1600×900.

5. **Commit**
   ```bash
   git add public/screenshot-trade.png
   git commit -m "Add trade-view screenshot for README"
   ```

The README's screenshot reference will resolve automatically once the file
exists on disk.

## What the screenshot should show

Required visual elements (so the screenshot is representative, not just
aesthetic):

- [ ] Candlestick chart with the EURUSD price scale on the right
- [ ] At least one open position with all three lines visible:
      entry chip · TP chip · SL chip
- [ ] **AccountHUD** in the top-right (compact, glassy) showing live P&L
- [ ] **Replay controls + scrubber** at the bottom of the chart panel
- [ ] **Open positions table** with at least one row
- [ ] **Order entry row** (Market button + Size input + Buy/Sell)
- [ ] **Timeframe selector** centered above the time axis
- [ ] Dark theme (dark mode is the default; this is the canonical look)

If any of those are missing the screenshot is doing too little work; recapture.
