'use strict';

/**
 * PortfolioAI exports its BUY/HOLD/SELL recommendations to Excel (pandas +
 * openpyxl). This script reads that file and POSTs each row into this app's
 * /api/recommendations endpoint, so they show up in the UI ready to confirm.
 *
 * Usage:
 *   npm install xlsx   (not a default dependency — only needed if you use this script)
 *   node scripts/ingest-from-excel.js /path/to/portfolioai-export.xlsx
 *
 * Expected columns (rename to match your real export, or adjust the map
 * below): Ticker | Recommendation | Reasoning | Confidence
 */

const path = require('path');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/ingest-from-excel.js <path-to-export.xlsx>');
    process.exit(1);
  }

  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    console.error('Missing dependency. Run: npm install xlsx');
    process.exit(1);
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const workbook = XLSX.readFile(path.resolve(file));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  for (const row of rows) {
    const payload = {
      ticker: row.Ticker || row.ticker,
      action: row.Recommendation || row.action,
      reasoning: row.Reasoning || row.reasoning,
      confidence: row.Confidence ? Number(row.Confidence) : undefined,
      source: 'portfolioai-excel-export',
    };
    if (!payload.ticker || !payload.action) {
      console.warn('Skipping row, missing ticker/action:', row);
      continue;
    }
    const res = await fetch(`${appUrl}/api/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(res.ok ? `Ingested ${payload.ticker} (${payload.action})` : `Failed: ${payload.ticker}`);
  }
}

main();
