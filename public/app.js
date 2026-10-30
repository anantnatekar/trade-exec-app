'use strict';

const recsEl = document.getElementById('recs');
const ordersEl = document.getElementById('orders');
let pendingConfirm = null; // recommendationId currently showing its confirm box

async function loadRecs() {
  const res = await fetch('/api/recommendations');
  const recs = await res.json();
  recsEl.innerHTML = '';
  if (recs.length === 0) {
    recsEl.innerHTML = '<p class="empty">No recommendations yet. POST one to /api/recommendations to see it here.</p>';
    return;
  }
  for (const rec of recs) recsEl.appendChild(renderRec(rec));
}

function renderRec(rec) {
  const div = document.createElement('div');
  div.className = 'card';

  const actioned = rec.status !== 'NEW';
  const showConfirm = pendingConfirm === rec.id;

  div.innerHTML = `
    <h3>${rec.ticker} <span class="badge ${rec.action}">${rec.action}</span>
      ${rec.confidence != null ? `<span style="font-size:12px;color:#6B7785;">${Math.round(rec.confidence * 100)}% confidence</span>` : ''}
    </h3>
    <div class="reasoning">${rec.reasoning || ''}</div>
    ${rec.action === 'HOLD' || actioned ? '' : renderActionRow(rec, showConfirm)}
    ${actioned ? `<div class="empty">Status: ${rec.status}</div>` : ''}
  `;

  if (!actioned && rec.action !== 'HOLD') wireActionRow(div, rec, showConfirm);
  return div;
}

function renderActionRow(rec, showConfirm) {
  if (showConfirm) {
    return `<div class="confirm-box" data-confirm-box>
      <strong>Confirm this order?</strong>
      <div id="confirm-details" style="font-size:13px;margin:6px 0;"></div>
      <div class="row">
        <button class="confirm" data-confirm>Confirm &amp; Submit</button>
        <button class="cancel" data-cancel>Cancel</button>
      </div>
    </div>`;
  }
  return `<div class="row">
    <select data-mode>
      <option value="quantity">Shares</option>
      <option value="notional">$ Amount</option>
    </select>
    <input type="number" min="0" step="0.01" data-amount placeholder="e.g. 10" />
    <button class="primary" data-review>Review Order</button>
  </div>`;
}

function wireActionRow(container, rec, showConfirm) {
  if (showConfirm) {
    const order = pendingConfirmOrder;
    container.querySelector('#confirm-details').textContent =
      `${rec.action} ${order.amount} ${order.mode === 'quantity' ? 'shares of' : '$ of'} ${rec.ticker}`;
    container.querySelector('[data-confirm]').addEventListener('click', () => submitOrder(rec, order));
    container.querySelector('[data-cancel]').addEventListener('click', () => {
      pendingConfirm = null;
      loadRecs();
    });
    return;
  }
  container.querySelector('[data-review]').addEventListener('click', () => {
    const mode = container.querySelector('[data-mode]').value;
    const amount = Number(container.querySelector('[data-amount]').value);
    if (!amount || amount <= 0) {
      alert('Enter a quantity or dollar amount greater than 0.');
      return;
    }
    pendingConfirm = rec.id;
    pendingConfirmOrder = { mode, amount };
    loadRecs();
  });
}

let pendingConfirmOrder = null;

async function submitOrder(rec, order) {
  const body = {
    recommendationId: rec.id,
    side: rec.action,
    confirmed: true,
  };
  if (order.mode === 'quantity') body.quantity = order.amount;
  else body.notional = order.amount;

  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Order failed: ${err.error || res.statusText}`);
  }
  pendingConfirm = null;
  await loadRecs();
  await loadOrders();
}

async function loadOrders() {
  const res = await fetch('/api/orders');
  const list = await res.json();
  ordersEl.innerHTML = list.length
    ? ''
    : '<p class="empty">No orders submitted yet.</p>';
  for (const o of list) {
    const row = document.createElement('div');
    row.className = 'order-row';
    const qty = o.quantity ? `${o.quantity} sh` : `$${o.notional}`;
    row.innerHTML = `<span>${o.side} ${o.ticker} &middot; ${qty}</span><span class="status ${o.status}">${o.status}</span>`;
    ordersEl.appendChild(row);
  }
}

// Live updates so a fill/reject shows up without refreshing.
const events = new EventSource('/events');
events.addEventListener('order-update', () => loadOrders());

loadRecs();
loadOrders();
setInterval(loadRecs, 15000); // in case recs arrive from PortfolioAI while the tab is open
