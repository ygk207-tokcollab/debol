#!/usr/bin/env node
// Re-captures docs/api-samples/*.json from a running backend, byte for byte as the API responds.
//
//   ADMIN_EMAIL=owner@kidsstore.test ADMIN_PASSWORD='...' node scripts/capture-api-samples.mjs
//
// BASE_URL defaults to the local demo backend on 8090. Nothing here is invented: the files are what
// the endpoints returned at run time, so re-run this after any API or branding change.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8090/api/v1').replace(/\/+$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'api-samples');
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required (see .env.local). Nothing was written.');
  process.exit(1);
}

const PUBLIC = {
  'store.json': '/store',
  'store_settings.json': '/store/settings',
  'categories.json': '/categories',
  'delivery-zones.json': '/delivery-zones',
  'size-guides.json': '/size-guides',
  'age-groups.json': '/age-groups',
  'products_page_0_size_2.json': '/products?page=0&pageSize=2',
};

const ADMIN = {
  'admin_dashboard.json': '/admin/dashboard',
  'admin_products.json': '/admin/products?page=0&pageSize=2',
  'admin_orders.json': '/admin/orders?page=0&pageSize=2',
  'admin_categories.json': '/admin/categories',
  'admin_delivery-zones.json': '/admin/delivery-zones',
  'admin_inventory.json': '/admin/inventory?page=0&pageSize=2',
  'admin_notifications.json': '/admin/notifications?page=0&pageSize=2',
  'admin_settings.json': '/admin/settings',
  'admin_age-groups.json': '/admin/age-groups',
  'admin_administrators.json': '/admin/administrators',
  'admin_telegram_status.json': '/admin/telegram/status',
  'admin_audit.json': '/admin/audit?page=0&pageSize=2',
};

async function grab(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} for ${path}: ${text.slice(0, 200)}`);
  return text;
}

const login = await fetch(`${BASE}/admin/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) throw new Error(`login failed with ${login.status}: ${(await login.text()).slice(0, 200)}`);
const token = (await login.json()).token;

let written = 0;
for (const [file, path] of Object.entries(PUBLIC)) {
  writeFileSync(join(OUT, file), await grab(path), 'utf8');
  written += 1;
}
for (const [file, path] of Object.entries(ADMIN)) {
  const body = await grab(path, token);
  if (/botToken["']?\s*:\s*["'][0-9]+:/.test(body)) throw new Error(`${path} looks like it returned a bot token - refusing to write it`);
  writeFileSync(join(OUT, file), body, 'utf8');
  written += 1;
}
console.log(`${written} files refreshed in docs/api-samples from ${BASE}`);
