'use strict';

/**
 * TradingDeskClient is the ONLY place that talks to the trading desk.
 * Everything else in this app (routes, order store, UI) is written against
 * this interface, so swapping mock -> live is a one-file change.
 *
 * submitOrder(order) -> Promise<{ deskOrderId, status }>
 *   order: { clientOrderId, ticker, side ('BUY'|'SELL'), quantity?, notional?, accountId }
 *   status is one of: 'ACCEPTED' | 'REJECTED'
 *
 * getOrderStatus(deskOrderId) -> Promise<{ status, filledQuantity?, avgFillPrice?, reason? }>
 *   status is one of: 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELLED'
 *
 * Real trading desk APIs vary a lot (FIX, REST, gRPC, internal queue, etc).
 * The LiveTradingDeskClient below is a REST sketch you MUST adapt to your
 * actual desk's real request/response shape, auth scheme, and error codes
 * before TRADING_DESK_MODE=live is safe to use. Treat it as a starting
 * point, not a working integration.
 */

class MockTradingDeskClient {
  constructor() {
    this._orders = new Map(); // deskOrderId -> simulated order state
  }

  async submitOrder(order) {
    const deskOrderId = `MOCK-${order.clientOrderId}`;
    // Simulate a desk that accepts almost everything, but reject obviously
    // bad input the same way a real desk would (belt-and-suspenders; the
    // route layer already validates this too).
    if ((!order.quantity && !order.notional) || (order.quantity && order.notional)) {
      return { deskOrderId, status: 'REJECTED', reason: 'Specify exactly one of quantity or notional.' };
    }

    this._orders.set(deskOrderId, {
      status: 'PENDING',
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      notional: order.notional,
      createdAt: Date.now(),
    });

    // Simulate the desk filling the order a few seconds later, async,
    // exactly like a real desk would via webhook or a status poll.
    const fillDelayMs = 3000 + Math.floor(Math.random() * 4000);
    setTimeout(() => this._simulateFill(deskOrderId), fillDelayMs);

    return { deskOrderId, status: 'ACCEPTED' };
  }

  _simulateFill(deskOrderId) {
    const o = this._orders.get(deskOrderId);
    if (!o) return;
    // ~95% fill, ~5% reject, so the UI/notifier paths for both are exercised.
    const rejected = Math.random() < 0.05;
    if (rejected) {
      o.status = 'REJECTED';
      o.reason = 'Simulated desk rejection (e.g., insufficient buying power).';
    } else {
      o.status = 'FILLED';
      o.filledQuantity = o.quantity ?? Math.round((o.notional / this._simulatedPrice(o.ticker)) * 1000) / 1000;
      o.avgFillPrice = this._simulatedPrice(o.ticker);
    }
    this._orders.set(deskOrderId, o);
  }

  _simulatedPrice(ticker) {
    // Deterministic-ish fake price so repeated calls for the same ticker
    // in one run are stable; replace entirely once wired to a real desk.
    let hash = 0;
    for (const ch of ticker) hash = (hash * 31 + ch.charCodeAt(0)) % 10000;
    return Math.round((50 + (hash % 450)) * 100) / 100;
  }

  async getOrderStatus(deskOrderId) {
    const o = this._orders.get(deskOrderId);
    if (!o) return { status: 'REJECTED', reason: 'Unknown deskOrderId' };
    return {
      status: o.status,
      filledQuantity: o.filledQuantity,
      avgFillPrice: o.avgFillPrice,
      reason: o.reason,
    };
  }
}

class LiveTradingDeskClient {
  constructor({ baseUrl, apiKey, accountId }) {
    if (!baseUrl || !apiKey || !accountId) {
      throw new Error(
        'LiveTradingDeskClient requires TRADING_DESK_BASE_URL, TRADING_DESK_API_KEY, ' +
        'and TRADING_DESK_ACCOUNT_ID — set these in .env before using TRADING_DESK_MODE=live.'
      );
    }
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.accountId = accountId;
  }

  async submitOrder(order) {
    // TODO: replace this entire body with your real trading desk's actual
    // order-submission contract. The shape below is a plausible REST guess,
    // not a verified integration — confirm field names, auth header format,
    // and status values against your desk's real API documentation first.
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'Idempotency-Key': order.clientOrderId, // prevents double-submission on retry
      },
      body: JSON.stringify({
        accountId: this.accountId,
        clientOrderId: order.clientOrderId,
        symbol: order.ticker,
        side: order.side,
        quantity: order.quantity,
        notional: order.notional,
        orderType: 'MARKET',
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Trading desk rejected the order (${res.status}): ${text}`);
    }
    const data = await res.json();
    // TODO: map data.* to { deskOrderId, status } using your real response shape.
    return { deskOrderId: data.orderId, status: data.status };
  }

  async getOrderStatus(deskOrderId) {
    // TODO: replace with your real desk's order-status endpoint.
    const res = await fetch(`${this.baseUrl}/orders/${deskOrderId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch order status (${res.status})`);
    const data = await res.json();
    return {
      status: data.status,
      filledQuantity: data.filledQuantity,
      avgFillPrice: data.avgFillPrice,
      reason: data.reason,
    };
  }
}

function createTradingDeskClient(env = process.env) {
  const mode = (env.TRADING_DESK_MODE || 'mock').toLowerCase();
  if (mode === 'live') {
    return new LiveTradingDeskClient({
      baseUrl: env.TRADING_DESK_BASE_URL,
      apiKey: env.TRADING_DESK_API_KEY,
      accountId: env.TRADING_DESK_ACCOUNT_ID,
    });
  }
  return new MockTradingDeskClient();
}

module.exports = { createTradingDeskClient, MockTradingDeskClient, LiveTradingDeskClient };
