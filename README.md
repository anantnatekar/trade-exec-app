# PortfolioAI Trade Execution

Takes BUY/HOLD/SELL recommendations from [PortfolioAI](https://github.com/anantnatekar/portfolio),
lets a user pick a quantity or dollar amount, requires an explicit confirmation,
submits the order to a trading desk, and notifies the user when it's filled.

```
PortfolioAI  -->  POST /api/recommendations  -->  [ review & confirm in UI ]  -->  POST /api/orders
                                                                                          |
                                                                                          v
                                                                            TradingDeskClient.submitOrder()
                                                                                          |
                                                                                          v
                                                                           poll / webhook until terminal
                                                                                          |
                                                                                          v
                                                                        notify user (SSE in-app + optional email)
```

## Why it's built this way

- **One file owns the trading desk integration**: `src/tradingDeskClient.js`.
  Routes, the order store, and the UI never talk to the desk directly — they
  only call this adapter. That means swapping the mock for your real desk is
  a one-file change, not a rewrite.
- **The confirmation is structural, not just a UI dialog**: `POST /api/orders`
  rejects the request outright unless `confirmed: true` is sent, and that
  field is only ever set after the user clicks "Confirm & Submit" in the UI.
- **Orders are idempotent-ish by design**: each confirmed submission gets a
  fresh `clientOrderId` (a UUID), which is sent to the desk as an
  `Idempotency-Key` in the live client — standard practice to avoid a retried
  request accidentally submitting the same order twice.
- **Orders persist to disk** (`data/orders.json`) so you have an audit trail
  and don't lose state on a restart — reasonable for a personal tool; swap
  for a real database if this ever needs to run multi-instance.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Open **http://localhost:3000**. By default `TRADING_DESK_MODE=mock`, so
nothing contacts a real trading desk — orders "fill" on their own after a
few seconds via a simulated desk, so you can exercise the whole flow safely.

## Feeding it recommendations from PortfolioAI

Three ways, pick whichever fits how you want to wire the two apps together:

1. **Manual testing** — just POST one yourself:
   ```bash
   curl -X POST localhost:3000/api/recommendations \
     -H "Content-Type: application/json" \
     -d '{"ticker":"AAPL","action":"BUY","reasoning":"Majority vote: 3/3 agents agree","confidence":1.0}'
   ```
2. **From PortfolioAI's Excel export** — `scripts/ingest-from-excel.js` reads
   the file PortfolioAI generates and posts each row in. Needs `npm install xlsx` once.
3. **Direct integration** — if you'd rather have PortfolioAI call this app
   the moment it finishes a recommendation, add an HTTP call to
   `POST /api/recommendations` at the end of its orchestrator step, with the
   same payload shape as above.

## Going live — read this before flipping the switch

`src/tradingDeskClient.js`'s `LiveTradingDeskClient` is a **sketch, not a
tested integration** — I don't know your actual trading desk's real API. Before
setting `TRADING_DESK_MODE=live` in `.env`:

- Replace the `fetch(...)` calls in `submitOrder` and `getOrderStatus` with
  your desk's real endpoints, auth scheme, and field names.
- Confirm how the desk wants idempotency handled (header name may differ).
- Decide whether your desk pushes a webhook on fill instead of supporting
  polling — if so, add a `POST /api/orders/:id/webhook` route that calls
  `orders.update(...)` and `notifier.notifyOrderUpdate(...)`, the same pair
  the poller in `server.js` already uses, and skip the poller for live mode.
- **This moves real money.** Given the Wealth & Investment Management context
  this is likely for, loop in whatever compliance/supervisory review your
  firm requires for automated order submission before this touches a real
  account — that's a real regulatory consideration, not boilerplate caution.

## Project layout

```
src/
  server.js                 Express routes
  tradingDeskClient.js       <-- the one file to edit for a real desk
  orderStore.js              JSON-file order persistence + audit trail
  recommendationsStore.js    in-memory recommendation queue
  notifier.js                SSE push + optional email on order completion
public/
  index.html, app.js         minimal UI: review -> confirm -> submit -> live status
scripts/
  ingest-from-excel.js       optional PortfolioAI export -> API bridge
```

## Email notifications (optional)

Leave `SMTP_HOST` blank in `.env` and you still get full functionality via
the in-app live status (SSE). Fill in `SMTP_*` and `NOTIFY_EMAIL_*` to also
get an email the moment an order reaches a terminal state (filled/rejected/cancelled).
