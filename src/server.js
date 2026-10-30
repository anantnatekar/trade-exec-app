'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { createTradingDeskClient } = require('./tradingDeskClient');
const { OrderStore } = require('./orderStore');
const { RecommendationsStore } = require('./recommendationsStore');
const { Notifier } = require('./notifier');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const tradingDesk = createTradingDeskClient();
const orders = new OrderStore();
const recommendations = new RecommendationsStore();
const notifier = new Notifier();

const PORT = process.env.PORT || 3000;
const VALID_SIDES = new Set(['BUY', 'SELL']);

// ---------------------------------------------------------------------
// 1. Ingest a recommendation from PortfolioAI.
//    Point PortfolioAI (or a small script reading its Excel export) at
//    POST /api/recommendations with { ticker, action, reasoning, confidence }.
//    HOLD recommendations are stored too, just shown as non-actionable.
// ---------------------------------------------------------------------
app.post('/api/recommendations', (req, res) => {
  const { ticker, action, reasoning, confidence, source } = req.body || {};
  if (!ticker || !action || !['BUY', 'SELL', 'HOLD'].includes(String(action).toUpperCase())) {
    return res.status(400).json({ error: 'ticker and action (BUY|SELL|HOLD) are required' });
  }
  const rec = recommendations.add({ ticker, action, reasoning, confidence, source });
  res.status(201).json(rec);
});

app.get('/api/recommendations', (_req, res) => {
  res.json(recommendations.list());
});

// ---------------------------------------------------------------------
// 2. User reviews a recommendation, enters quantity or $ notional, and
//    the FRONTEND shows an explicit confirmation step before ever calling
//    this endpoint. This endpoint itself is the "user has confirmed, go
//    submit it" action — it is the only place that calls the trading desk.
// ---------------------------------------------------------------------
app.post('/api/orders', async (req, res) => {
  const { recommendationId, side, quantity, notional, confirmed } = req.body || {};

  if (!confirmed) {
    return res.status(400).json({ error: 'Order must be explicitly confirmed by the user before submission.' });
  }
  if (!VALID_SIDES.has(side)) {
    return res.status(400).json({ error: "side must be 'BUY' or 'SELL'" });
  }
  const hasQty = quantity !== undefined && quantity !== null && quantity !== '';
  const hasNotional = notional !== undefined && notional !== null && notional !== '';
  if (hasQty === hasNotional) {
    return res.status(400).json({ error: 'Provide exactly one of quantity or notional ($).' });
  }
  if (hasQty && Number(quantity) <= 0) {
    return res.status(400).json({ error: 'quantity must be greater than 0.' });
  }
  if (hasNotional && Number(notional) <= 0) {
    return res.status(400).json({ error: 'notional must be greater than 0.' });
  }

  const rec = recommendationId ? recommendations.get(recommendationId) : null;
  const ticker = rec ? rec.ticker : req.body.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker (directly, or via recommendationId) is required' });

  const clientOrderId = crypto.randomUUID();
  const orderRecord = {
    clientOrderId,
    recommendationId: rec ? rec.id : null,
    ticker: String(ticker).toUpperCase(),
    side,
    quantity: hasQty ? Number(quantity) : undefined,
    notional: hasNotional ? Number(notional) : undefined,
    status: 'SUBMITTING',
    createdAt: new Date().toISOString(),
  };
  orders.create(orderRecord);

  try {
    const result = await tradingDesk.submitOrder({
      clientOrderId,
      ticker: orderRecord.ticker,
      side,
      quantity: orderRecord.quantity,
      notional: orderRecord.notional,
    });

    const updated = orders.update(clientOrderId, {
      deskOrderId: result.deskOrderId,
      status: result.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
      reason: result.reason,
    });

    if (rec) recommendations.markStatus(rec.id, 'ACTIONED');
    await notifier.notifyOrderUpdate(updated);

    if (updated.status === 'PENDING') pollUntilTerminal(clientOrderId);

    res.status(202).json(updated);
  } catch (err) {
    const updated = orders.update(clientOrderId, { status: 'REJECTED', reason: err.message });
    await notifier.notifyOrderUpdate(updated);
    res.status(502).json({ error: 'Trading desk submission failed', details: err.message, order: updated });
  }
});

app.get('/api/orders', (_req, res) => {
  res.json(orders.list());
});

// ---------------------------------------------------------------------
// 3. Poll the trading desk until the order reaches a terminal state, then
//    notify the user. (If your real desk pushes webhooks instead of
//    supporting polling, add a POST /api/orders/:id/webhook route that
//    calls the same orders.update(...) + notifier.notifyOrderUpdate(...)
//    pair used here, and skip this poller for live mode.)
// ---------------------------------------------------------------------
const TERMINAL_STATUSES = new Set(['FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED']);

function pollUntilTerminal(clientOrderId, attempt = 0) {
  const MAX_ATTEMPTS = 60; // ~5 min at 5s intervals — generous for a market order
  const INTERVAL_MS = 5000;

  setTimeout(async () => {
    const order = orders.get(clientOrderId);
    if (!order || TERMINAL_STATUSES.has(order.status)) return;

    try {
      const statusResult = await tradingDesk.getOrderStatus(order.deskOrderId);
      if (statusResult.status !== order.status) {
        const updated = orders.update(clientOrderId, statusResult);
        await notifier.notifyOrderUpdate(updated);
      }
      if (!TERMINAL_STATUSES.has(statusResult.status) && attempt < MAX_ATTEMPTS) {
        pollUntilTerminal(clientOrderId, attempt + 1);
      }
    } catch (err) {
      console.error(`[poll] status check failed for ${clientOrderId}:`, err.message);
      if (attempt < MAX_ATTEMPTS) pollUntilTerminal(clientOrderId, attempt + 1);
    }
  }, INTERVAL_MS);
}

// ---------------------------------------------------------------------
// 4. Real-time push to the browser so "send a confirmation once the order
//    is completed" doesn't require the user to refresh or poll manually.
// ---------------------------------------------------------------------
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  notifier.addSseClient(res);
});

app.listen(PORT, () => {
  console.log(`portfolioai-trade-exec listening on http://localhost:${PORT}`);
  console.log(`Trading desk mode: ${(process.env.TRADING_DESK_MODE || 'mock').toUpperCase()}`);
});
