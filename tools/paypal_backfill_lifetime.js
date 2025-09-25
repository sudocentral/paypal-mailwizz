#!/usr/bin/env node
/**
 * Backfills LIFETIME_DONATED in MailWizz by summing all historic PayPal transactions per donor (by email).
 * - No local DB. PayPal is source of truth.
 * - Handles multi-year accounts by paging 31-day windows (PayPal Reporting API restriction).
 * - Safe to re-run; always recomputes fresh totals and overwrites MailWizz field.
 *
 * ENV required:
 *   PAYPAL_ENV=live|sandbox
 *   PAYPAL_CLIENT_ID=...
 *   PAYPAL_CLIENT_SECRET=...
 *   PAYPAL_START_DATE=2010-01-01T00:00:00Z   (earliest expected donation)
 *   MAILWIZZ_API_BASE=https://mvpes.sudomanaged.com/api/index.php
 *   MAILWIZZ_API_KEY=...
 *   MAILWIZZ_LIST_UID=kc6447jr7p5eb
 *   // Optional: CURRENCY_CODE=USD (if you only want to include a specific currency)
 */

const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const {
  PAYPAL_ENV = 'live',
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_START_DATE = '2010-01-01T00:00:00Z',
  MAILWIZZ_API_BASE,
  MAILWIZZ_API_KEY,
  MAILWIZZ_LIST_UID,
  CURRENCY_CODE,
} = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
  process.exit(1);
}
if (!MAILWIZZ_API_BASE || !MAILWIZZ_API_KEY || !MAILWIZZ_LIST_UID) {
  console.error('Missing MailWizz env (MAILWIZZ_API_BASE, MAILWIZZ_API_KEY, MAILWIZZ_LIST_UID)');
  process.exit(1);
}

const PAYPAL_BASE = PAYPAL_ENV === 'sandbox'
  ? 'https://api.sandbox.paypal.com'
  : 'https://api.paypal.com';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getAccessToken() {
  const resp = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      auth: { username: PAYPAL_CLIENT_ID, password: PAYPAL_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    }
  );
  return resp.data.access_token;
}

function isoDate(d) {
  // to ISO without ms
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function* thirtyOneDayWindows(startISO, endISO) {
  let start = new Date(startISO);
  const end = new Date(endISO);
  while (start < end) {
    const windowStart = new Date(start);
    const windowEnd = new Date(start);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 31);
    if (windowEnd > end) windowEnd.setTime(end.getTime());
    yield { start: isoDate(windowStart), end: isoDate(windowEnd) };
    start = new Date(windowEnd);
  }
}

async function getAllTransactions(accessToken, startISO, endISO) {
  let page = 1;
  let hasMore = true;
  const all = [];

  while (hasMore) {
    const resp = await axios.get(`${PAYPAL_BASE}/v1/reporting/transactions`, {
      params: {
        start_date: startISO,
        end_date: endISO,
        fields: 'all',
        page: page,
        page_size: 100,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 60000,
    });

    const details = resp.data.transaction_details || [];
    all.push(...details);

    const totalPages = Number(resp.data.total_pages || 1);
    hasMore = page < totalPages;
    page++;

    // be polite to the API
    if (hasMore) await sleep(250);
  }
  return all;
}

function sumDonationsByEmail(transactions, onlyCurrency) {
  // Returns: Map<email, { total: number, latestName?: string }>
  const map = new Map();

  for (const tx of transactions) {
    const email = tx?.payer_info?.email_address || null;
    const name = tx?.payer_info?.payer_name?.alternate_full_name
              || tx?.payer_info?.payer_name?.given_name
              || null;
    const info = tx?.transaction_info || {};
    const amount = info?.transaction_amount?.value;
    const currency = info?.transaction_amount?.currency_code;
    const status = info?.transaction_status;

    // Count only completed/settled donations. Adjust statuses if needed.
    if (!email || !amount || status !== 'S') continue; // 'S' = Success/Completed; PayPal often uses codes; if string statuses, use 'COMPLETED'
    if (onlyCurrency && currency !== onlyCurrency) continue;

    const val = parseFloat(amount);
    if (Number.isNaN(val)) continue;

    const prev = map.get(email) || { total: 0, latestName: null };
    prev.total += val;
    if (name) prev.latestName = name;
    map.set(email, prev);
  }

  return map;
}

async function upsertMailWizz(email, lifetime, maybeName) {
  const FormData = require('form-data');
  const fd = new FormData();

  // Parse optional name into FNAME/LNAME if possible
  let first = '', last = '';
  if (maybeName && typeof maybeName === 'string') {
    const parts = maybeName.trim().split(/\s+/);
    first = parts[0] || '';
    last = parts.slice(1).join(' ') || '';
  }

  fd.append('EMAIL', email);
  fd.append('FNAME', first);
  fd.append('LNAME', last);
  fd.append('LIFETIME_DONATED', lifetime.toFixed(2));
  fd.append('details[status]', 'confirmed');

  const url = `${MAILWIZZ_API_BASE}/lists/${MAILWIZZ_LIST_UID}/subscribers`;

  try {
    const resp = await axios.post(url, fd, {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': MAILWIZZ_API_KEY,
        ...fd.getHeaders(),
      },
      timeout: 30000,
    });
    return resp.data;
  } catch (e) {
    const payload = e.response?.data || e.message;
    console.error(`MailWizz error for ${email}:`, payload);
    // Do not throw to keep batch running; log and continue.
    return null;
  }
}

(async function main() {
  const START = PAYPAL_START_DATE;
  const END = new Date().toISOString();

  console.log(`🔐 Getting PayPal access token for ${PAYPAL_ENV}...`);
  const token = await getAccessToken();

  const donors = new Map(); // email -> { total, latestName }

  console.log(`📅 Sweeping transactions from ${START} to ${END} in 31-day windows...`);
  let windowIndex = 0;

  for (const win of thirtyOneDayWindows(START, END)) {
    windowIndex++;
    console.log(`  ▶ Window ${windowIndex}: ${win.start} → ${win.end}`);
    const txs = await getAllTransactions(token, win.start, win.end);

    const sums = sumDonationsByEmail(txs, CURRENCY_CODE /* or undefined */);
    // Merge into donors map
    for (const [email, rec] of sums.entries()) {
      const prev = donors.get(email) || { total: 0, latestName: null };
      prev.total += rec.total;
      if (rec.latestName) prev.latestName = rec.latestName;
      donors.set(email, prev);
    }

    // Gentle pacing to respect API limits
    await sleep(500);
  }

  // Write a checkpoint JSON for audit
  const out = {};
  for (const [email, rec] of donors.entries()) {
    out[email] = { total: rec.total, name: rec.latestName || '' };
  }
  const outfile = `./paypal_backfill_snapshot_${Date.now()}.json`;
  fs.writeFileSync(outfile, JSON.stringify(out, null, 2));
  console.log(`💾 Snapshot written: ${outfile}`);

  // Push into MailWizz
  console.log(`🚀 Updating MailWizz subscribers with LIFETIME_DONATED...`);
  let i = 0;
  for (const [email, rec] of donors.entries()) {
    i++;
    if (!email) continue;
    await upsertMailWizz(email, rec.total, rec.latestName);
    if (i % 25 === 0) await sleep(500); // brief throttle
  }

  console.log('✅ Backfill complete.');
})().catch(err => {
  console.error('❌ Fatal backfill error:', err.response?.data || err.message);
  process.exit(1);
});

