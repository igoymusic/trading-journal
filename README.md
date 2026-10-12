# Trading Journal

A personal desktop trading journal for options traders, in the spirit of TradeZella and Kinfo. Trades are imported from your broker and stored only on your own computer.

**Status:** step 1 of the [plan](#roadmap). Imports a thinkorswim Account Statement CSV and shows every round-trip trade with P&L per contract in dollars.

## Using it

1. Download the latest Windows installer: open the **Actions** tab on GitHub, pick the newest green **Build** run, and download **Trading-Journal-Windows-Installer** at the bottom of the page.
2. Run the installer. Windows may warn that the app is from an unknown publisher, because it isn't code-signed. Click **More info**, then **Run anyway**.
3. In thinkorswim: **Monitor** → **Account Statement** → choose dates → **Apply** → menu icon → **Export to File**.
4. In the app, click **Import thinkorswim CSV** and pick that file. Importing the same file twice is safe; duplicates are skipped.

Your journal lives in `%APPDATA%\Trading Journal\journal.sqlite`.

## How the import works

- Fills come from the statement's **Account Trade History** section, with execution times to the second (shown in your computer's time zone).
- Fees come from the **Cash Balance** section. Multi-leg orders are charged once, so that charge is split across the legs by contract count.
- Options that expired are closed at $0 using the "Removed due to Expiration" rows.
- Fills on the same contract are grouped into a trade from the moment you open a position until you're flat again. Scaling in and out stays in one trade.
- Option prices are shown per contract in dollars: a $0.79 quote is shown as $79.00.

## Developing

Requires Node.js 22+.

```
npm install
npm test          # unit tests
npm run typecheck
npm start         # build and launch the app
npm run dist      # build the Windows installer into release/
```

Code layout:

- `src/core`: broker-file parsing and trade math, no Electron dependencies (unit-tested).
- `src/main`: Electron main process, SQLite database (Node's built-in `node:sqlite`), file import.
- `src/renderer`: the screens (React).
- `src/shared`: the API between the screens and the main process.

## Roadmap

1. ~~App skeleton + thinkorswim CSV import~~
2. Underlying chart (TradingView Lightweight Charts) with second-exact entry/exit markers
3. Monthly P&L calendar and Day view
4. Year and Week views, summary stats
5. Notes, setups, tags, ratings, R-multiple, reports, filters
6. Trade replay, playbooks, option price chart, goals
7. Broker sign-in and daily sync (SnapTrade), plus optional direct Schwab connection
8. Installer polish and first-run guide

Read-only by design: the app never places orders.
