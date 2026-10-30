'use strict';

const { nanoid } = require('nanoid');

/**
 * Holds the BUY/HOLD/SELL recommendations handed off from PortfolioAI,
 * until a user acts on them (or dismisses them). This is intentionally
 * in-memory and simple — swap for a real DB if you need history beyond
 * the current process lifetime.
 */
class RecommendationsStore {
  constructor() {
    this._recs = new Map(); // id -> recommendation
  }

  add({ ticker, action, reasoning, confidence, source }) {
    const id = nanoid(10);
    const rec = {
      id,
      ticker: String(ticker).toUpperCase(),
      action: String(action).toUpperCase(), // 'BUY' | 'SELL' | 'HOLD'
      reasoning: reasoning || '',
      confidence: confidence ?? null, // e.g. 0.66 or 1.0 from PortfolioAI's majority vote
      source: source || 'portfolioai',
      status: 'NEW', // 'NEW' | 'ACTIONED' | 'DISMISSED'
      createdAt: new Date().toISOString(),
    };
    this._recs.set(id, rec);
    return rec;
  }

  get(id) {
    return this._recs.get(id) || null;
  }

  list() {
    return [...this._recs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markStatus(id, status) {
    const rec = this._recs.get(id);
    if (!rec) return null;
    rec.status = status;
    this._recs.set(id, rec);
    return rec;
  }
}

module.exports = { RecommendationsStore };
