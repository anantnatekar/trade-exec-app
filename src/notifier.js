'use strict';

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null; // email notifications simply stay disabled if the package isn't installed
}

/**
 * Two notification channels:
 *  1. Server-Sent Events (SSE) to any open browser tab — works out of the
 *     box, no config needed. This is the primary "tell the user now" path.
 *  2. Email, only if SMTP_* env vars are set — a nice-to-have for when the
 *     user isn't watching the tab when the order fills.
 */
class Notifier {
  constructor(env = process.env) {
    this._sseClients = new Set(); // Set<express.Response>
    this._mailer = null;

    if (nodemailer && env.SMTP_HOST && env.NOTIFY_EMAIL_TO) {
      this._mailer = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 587,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
      this._emailFrom = env.NOTIFY_EMAIL_FROM || env.SMTP_USER;
      this._emailTo = env.NOTIFY_EMAIL_TO;
    }
  }

  // --- SSE plumbing ---
  addSseClient(res) {
    this._sseClients.add(res);
    res.on('close', () => this._sseClients.delete(res));
  }

  _pushSse(event, payload) {
    const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this._sseClients) res.write(line);
  }

  // --- Public notification API ---
  async notifyOrderUpdate(order) {
    console.log(`[notify] Order ${order.clientOrderId} (${order.ticker} ${order.side}) -> ${order.status}`);
    this._pushSse('order-update', order);

    const terminal = ['FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED'].includes(order.status);
    if (terminal && this._mailer) {
      await this._sendEmail(order).catch((err) =>
        console.error('[notify] Email send failed (order still recorded fine):', err.message)
      );
    }
  }

  async _sendEmail(order) {
    const subject =
      order.status === 'FILLED'
        ? `Order filled: ${order.side} ${order.ticker}`
        : `Order ${order.status.toLowerCase()}: ${order.side} ${order.ticker}`;

    const lines = [
      `Ticker: ${order.ticker}`,
      `Side: ${order.side}`,
      order.quantity ? `Quantity: ${order.quantity}` : `Notional: $${order.notional}`,
      `Status: ${order.status}`,
      order.avgFillPrice ? `Avg fill price: $${order.avgFillPrice}` : null,
      order.filledQuantity ? `Filled quantity: ${order.filledQuantity}` : null,
      order.reason ? `Reason: ${order.reason}` : null,
      `Order ID: ${order.clientOrderId}`,
    ].filter(Boolean);

    await this._mailer.sendMail({
      from: this._emailFrom,
      to: this._emailTo,
      subject,
      text: lines.join('\n'),
    });
  }
}

module.exports = { Notifier };
