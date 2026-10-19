import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * End-to-end proof for the Postgres path: schema create + seed, real admin login, real multipart
 * image upload, order through checkout, then a process restart and a re-read of everything.
 *
 *   DATABASE_URL=postgres://... PORT=3210 ADMIN_BOOTSTRAP_PASSWORD=... node scripts/e2e-postgres.mjs
 *
 * It DROPS THE PUBLIC SCHEMA first, so it refuses to run unless E2E_ALLOW_DROP=1 is set or the
 * database name looks like a scratch database (test/scratch/demo/tmp).
 */
const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL is required (this run must exercise the real persistence path).');
  process.exit(1);
}
const dbName = decodeURIComponent(new URL(DB).pathname.replace(/^\//, ''));
const looksScratch = /test|scratch|demo|tmp/i.test(dbName);
if (!looksScratch && process.env.E2E_ALLOW_DROP !== '1') {
  console.error(`Refusing to drop the schema of "${dbName}" - it does not look like a scratch database.`);
  console.error('Set E2E_ALLOW_DROP=1 if you really mean it.');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3210);
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'Str0ng-Passw0rd-For-Debol';
const OWNER_EMAILS = (process.env.E2E_ADMIN_EMAILS || 'owner@kidsstore.test,demo@kidsstore.test').split(',');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};

function boot() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: DB,
      ADMIN_BOOTSTRAP_PASSWORD: PASSWORD,
      ALLOWED_ORIGINS: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const capture = (b) => { const s = b.toString(); logs.push(s); process.env.E2E_VERBOSE && console.log('  [server]', s.trim()); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.__logs = logs;
  return child;
}

const waitUp = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server never came up');
};

const stop = (child) => new Promise((resolve) => {
  child.once('exit', resolve);
  child.kill('SIGTERM');
  setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 4000);
});

const call = async (pathname, { token, method = 'GET', body, headers = {}, raw } = {}) => {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (raw) return { status: res.status, text, res };
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

async function main() {
  // fresh slate so the seed path is what gets exercised
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: DB, ssl: false });
  await admin.connect();
  await admin.query('drop schema if exists public cascade');
  await admin.query('create schema public');
  await admin.end();

  let child = boot();
  const health = await waitUp();
  check('health reports postgres persistence', health.persistence === 'postgres', JSON.stringify(health));
  check('bootstrap password logged', child.__logs.join('').includes('ADMIN_BOOTSTRAP_PASSWORD applied'), '');

  const store = await call('/store');
  check('public /store works', store.status === 200 && store.data.featured.length > 0, `featured=${store.data?.featured?.length} newArrivals=${store.data?.newArrivals?.length} categories=${store.data?.categories?.length}`);

  const noToken = await call('/admin/products');
  check('admin list without token is 401', noToken.status === 401, JSON.stringify(noToken.data));

  const devLogin = await call('/admin/auth/dev-login', { method: 'POST', body: { email: 'owner@kidsstore.test' } });
  check('dev-login refused in production', devLogin.status === 404, JSON.stringify(devLogin.data));

  const badPw = await call('/admin/auth/login', { method: 'POST', body: { email: 'owner@kidsstore.test', password: 'wrong-password-here' } });
  check('wrong password rejected', badPw.status === 401, JSON.stringify(badPw.data));

  const unknownUser = await call('/admin/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: PASSWORD } });
  check('unknown email rejected', unknownUser.status === 401, JSON.stringify(unknownUser.data));

  const login = await call('/admin/auth/login', { method: 'POST', body: { email: 'owner@kidsstore.test', password: PASSWORD } });
  const token = login.data?.token;
  check('bootstrap password logs the owner in', login.status === 200 && typeof token === 'string', `token=${String(token).slice(0, 12)}...`);
  check('token is not the old static mock', token !== 'admin-mock-token-2026', String(token));

  const loginDemo = await call('/admin/auth/login', { method: 'POST', body: { email: 'demo@kidsstore.test', password: PASSWORD } });
  check('bootstrap password also reaches the second owner account', loginDemo.status === 200 && Boolean(loginDemo.data?.token), JSON.stringify(loginDemo.data).slice(0, 100));

  const me = await call('/admin/auth/me', { token });
  check('/admin/auth/me returns the real admin', me.status === 200 && me.data.email === 'owner@kidsstore.test', JSON.stringify(me.data));

  const forged = await call('/admin/products', { token: 'adm_' + '0'.repeat(48) });
  check('forged token rejected', forged.status === 401, JSON.stringify(forged.data));

  const admins = await call('/admin/administrators', { token });
  const leaked = JSON.stringify(admins.data).includes('passwordHash') || JSON.stringify(admins.data).includes('scrypt:');
  check('administrator list leaks no hash', admins.status === 200 && !leaked, JSON.stringify(admins.data).slice(0, 160));

  const created = await call('/admin/products', {
    token,
    method: 'POST',
    body: {
      nameEn: 'E2E Uploaded Coat', categorySlug: 'baby-clothing', audience: 'CHILD', gender: 'UNISEX',
      ageGroups: ['TODDLER_1_2Y'], sizingSystem: 'AGE', basePrice: 1290, status: 'PUBLISHED', featured: false,
      variants: [{ sizeLabel: '2y', colorName: 'Camel', sku: 'E2E-COAT-2Y', stock: 7 }],
    },
  });
  const newId = created.data?.id;
  check('product created', created.status === 200 && Boolean(newId), `id=${newId}`);

  // real multipart upload, exactly like the browser does it
  const pngPath = path.resolve('public', 'logo-mark.png');
  const png = fs.readFileSync(pngPath);
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'logo-mark.png');
  const upRes = await fetch(`${BASE}/admin/products/${newId}/image-upload?isPrimary=true&altEn=E2E%20coat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const upBody = await upRes.json();
  check('upload accepted', upRes.status === 200 && upBody.uploaded === true, JSON.stringify(upBody).slice(0, 200));
  check('upload returns a media url', typeof upBody.url === 'string' && upBody.url.startsWith('/api/v1/media/images/'), upBody.url);
  check('upload reports byte size', upBody.image?.sizeBytes === png.length, `${upBody.image?.sizeBytes} vs file ${png.length}`);

  const imgRes = await fetch(`http://127.0.0.1:${PORT}${upBody.url}`);
  const served = Buffer.from(await imgRes.arrayBuffer());
  check('image served back byte-identical', imgRes.status === 200 && served.equals(png), `${imgRes.headers.get('content-type')} ${served.length}B, match=${served.equals(png)}`);

  const badType = new FormData();
  badType.append('file', new Blob(['not an image'], { type: 'text/plain' }), 'note.txt');
  const rejected = await fetch(`${BASE}/admin/products/${newId}/image-upload`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: badType });
  check('non-image upload refused', rejected.status === 415, JSON.stringify(await rejected.json()));

  // place an order through the public checkout, then move it along the status chain
  const guestKey = `e2e_${Date.now()}`;
  const variantId = created.data?.variants?.[0]?.id;
  const add = await call('/cart/items', { method: 'POST', body: { variantId, quantity: 2 }, headers: { 'x-cart-key': guestKey } });
  check('cart add works', add.status === 200, JSON.stringify(add.data).slice(0, 120));
  const quote = await call('/checkout/quote', { method: 'POST', body: { region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Bole' }, headers: { 'x-cart-key': guestKey } });
  check('quote computed', quote.status === 200 && quote.data?.total > 0, JSON.stringify(quote.data).slice(0, 160));
  const place = await call('/checkout', {
    method: 'POST',
    headers: { 'x-cart-key': guestKey },
    body: {
      fullName: 'E2E Buyer', phone: '0911000111', city: 'Addis Ababa', region: 'Addis Ababa',
      subCity: 'Bole', addressLine: 'House 9',
    },
  });
  const orderNumber = place.data?.orderNumber;
  check('order placed', place.status === 200 && Boolean(orderNumber), JSON.stringify(place.data).slice(0, 140));

  const list = await call(`/admin/orders?q=${encodeURIComponent(orderNumber)}`, { token });
  const orderId = (list.data?.items ?? list.data?.content ?? [])[0]?.id;
  check('order listed in admin', Boolean(orderId), `orderNumber=${orderNumber} id=${orderId}`);

  const move = await call(`/admin/orders/${orderId}/status?target=CONFIRMED`, { token, method: 'POST', body: { note: 'e2e' } });
  check('order status changed', move.status === 200 && move.data?.status === 'CONFIRMED', JSON.stringify(move.data).slice(0, 120));

  // ---- customer side: the phone that ordered signs in and edits its own account ----
  const cust = await call('/customers/auth/phone', { method: 'POST', body: { phone: '0911000111' } });
  const custToken = cust.data?.token;
  check('customer sign-in issued an unguessable session', cust.status === 200 && /^cust_[0-9a-f]{48}$/.test(String(custToken)), JSON.stringify(cust.data?.profile).slice(0, 120));
  const myOrders = await call('/me/orders', { token: custToken });
  check('the buyer sees the order they placed', myOrders.data?.length === 1 && myOrders.data[0].summary.customerPhone === '0911000111', JSON.stringify((myOrders.data || []).map((e) => e.summary.orderNumber)));
  const custSave = await call('/me/profile', { token: custToken, method: 'PATCH', body: { fullName: 'E2E Buyer', secondaryPhone: '0922000333' } });
  check('profile write accepted', custSave.status === 200 && custSave.data?.fullName === 'E2E Buyer', JSON.stringify(custSave.data).slice(0, 120));
  const custAddr = await call('/me/addresses', { token: custToken, method: 'POST', body: { label: 'Home', region: 'Addis Ababa', city: 'Addis Ababa', addressLine: 'House 9' } });
  check('address saved as the default', custAddr.status === 200 && custAddr.data?.isDefault === true, JSON.stringify(custAddr.data).slice(0, 140));
  const stranger = await call('/customers/auth/phone', { method: 'POST', body: { phone: '0933000444' } });
  const strangerOrders = await call('/me/orders', { token: stranger.data?.token });
  check("another phone's account sees no orders", strangerOrders.status === 200 && strangerOrders.data?.length === 0, JSON.stringify(strangerOrders.data).slice(0, 80));
  const strangerRead = await call(`/me/orders/${orderId}`, { token: stranger.data?.token });
  check("another phone can't open that order by id", strangerRead.status === 404, `status=${strangerRead.status}`);

  await new Promise((r) => setTimeout(r, 1500));
  await stop(child);

  // ---- restart: the real test for "production ready" ----
  child = boot();
  await waitUp();
  check('restart hydrated', child.__logs.join('').includes('[db] hydrated'), child.__logs.join('').split('\n').find((l) => l.includes('hydrated'))?.trim());

  const afterProducts = await call('/products?pageSize=100');
  const found = (afterProducts.data?.items ?? afterProducts.data?.content ?? []).find((p) => p.slug?.includes('e2e-uploaded-coat'));
  check('created product survived the restart', Boolean(found), `slug=${found?.slug}`);

  const detail = await call(`/products/${found?.slug ?? 'e2e-uploaded-coat'}`);
  const img = detail.data?.images?.[0];
  check('image row survived the restart', Boolean(img), JSON.stringify(img));
  const served2 = Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}${img?.url}`)).arrayBuffer());
  check('image bytes survived the restart', served2.equals(png), `${served2.length}B match=${served2.equals(png)}`);

  const login2 = await call('/admin/auth/login', { method: 'POST', body: { email: 'owner@kidsstore.test', password: PASSWORD } });
  const token2 = login2.data?.token;
  check('login still works after restart', login2.status === 200 && Boolean(token2), JSON.stringify(login2.data).slice(0, 120));
  const oldSession = await call('/admin/products', { token });
  check('session token survives the restart (stored in admin_sessions)', oldSession.status === 200, `status=${oldSession.status}`);

  const afterOrder = await call(`/admin/orders/${orderId}`, { token: token2 });
  check('order survived the restart', afterOrder.status === 200 && afterOrder.data?.customerName === 'E2E Buyer', JSON.stringify(afterOrder.data).slice(0, 160));
  check('order status survived the restart', afterOrder.data?.status === 'CONFIRMED', afterOrder.data?.status);
  check('order history survived', (afterOrder.data?.history ?? []).length >= 2, `events=${(afterOrder.data?.history ?? []).length}`);
  check('order line items survived', (afterOrder.data?.items ?? []).length === 1 && afterOrder.data.items[0].quantity === 2, JSON.stringify(afterOrder.data?.items)?.slice(0, 160));

  const relogin = await call('/customers/auth/phone', { method: 'POST', body: { phone: '0911000111' } });
  check('the customer profile survived the restart', relogin.data?.profile?.fullName === 'E2E Buyer' && relogin.data?.profile?.secondaryPhone === '0922000333', JSON.stringify(relogin.data?.profile).slice(0, 160));
  const addressesAfter = await call('/me/addresses', { token: relogin.data?.token });
  check('the saved address survived the restart', addressesAfter.data?.length === 1 && addressesAfter.data[0].addressLine === 'House 9', JSON.stringify(addressesAfter.data).slice(0, 160));
  const ordersAfter = await call('/me/orders', { token: relogin.data?.token });
  check('the account still sees only its own order', ordersAfter.data?.length === 1 && ordersAfter.data[0].summary.status === 'CONFIRMED', JSON.stringify(ordersAfter.data?.[0]?.summary?.status));
  const retiredToken = await call('/me/profile', { token: custToken });
  check('re-login retired the pre-restart customer token', retiredToken.status === 401, `status=${retiredToken.status}`);

  const stockAfter = await call(`/products/${found?.slug}`, {});
  check('stock decremented and persisted', stockAfter.data?.variants?.[0]?.stock === 5, `stock=${stockAfter.data?.variants?.[0]?.stock}`);

  const del = await call(`/admin/products/${newId}`, { token: token2, method: 'DELETE' });
  check('archive endpoint answers', del.status < 500, `status=${del.status}`);

  await new Promise((r) => setTimeout(r, 1200));
  await stop(child);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
}

main().catch((err) => { console.error('E2E ERROR:', err); process.exit(1); });
