'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'orders.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function persist(orders) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}

class OrderStore {
  constructor() {
    this._orders = load(); // clientOrderId -> order record
  }

  create(order) {
    this._orders[order.clientOrderId] = order;
    persist(this._orders);
    return order;
  }

  update(clientOrderId, patch) {
    const existing = this._orders[clientOrderId];
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this._orders[clientOrderId] = updated;
    persist(this._orders);
    return updated;
  }

  get(clientOrderId) {
    return this._orders[clientOrderId] || null;
  }

  list() {
    return Object.values(this._orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

module.exports = { OrderStore };
