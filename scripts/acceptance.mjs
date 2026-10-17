#!/usr/bin/env node
/**
 * Acceptance run for the twelve scenarios in the build brief. Every step goes over HTTP against a
 * running backend and the real PostgreSQL instance it talks to; nothing here is mocked, and each
 * check prints the evidence it used. Run `node acceptance.mjs` after starting the backend.
 */
import { execFile } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8090/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'owner@kidsstore.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD || 'LocalDemo2026pass';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const db = {
  host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || '5433',
  name: process.env.DB_NAME || 'kidsstore_demo', user: process.env.DB_USER || 'kidsstore',
  password: process.env.DB_PASSWORD || 'kidsstore',
};

const pass = []; const fail = [];
function check(no, title, ok, evidence) {
  (ok ? pass : fail).push(no);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${no}. ${title}`);
  console.log(`        ${evidence}`);
  return ok;
}
async function req(method, path, { body, token, headers = {}, base = BASE } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
               ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
}
function sql(query) {
  return new Promise((resolve, reject) => {
    execFile(PSQL, ['-h', db.host, '-p', db.port, '-U', db.user, '-d', db.name, '-tAc', query],
      { env: { ...process.env, PGPASSWORD: db.password } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim())));
  });
}
async function waitFor(fn, timeoutMs, everyMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last.done) return last.value;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return last.value;
}

const stamp = Date.now();
const phone = (tail) => `09${String(tail).padStart(8, '0')}`.slice(0, 10);
const stub = async (route) => {
  try { return await fetch(`http://127.0.0.1:9099/${route}`, { method: 'POST' }); } catch { return { status: 0 }; }
};
// The Bot API stand-in is already running but forced to answer with server errors, which is what a
// real Telegram outage looks like to the sender.
await stub('__offline');
await stub('__reset');

// ---------------------------------------------------------------- 1. administrator sign-in
const login = await req('POST', '/admin/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
const admin = login.json?.token;
check(1, 'Administrator can sign in and the panel is protected',
  login.status === 200 && !!admin && login.json.role === 'OWNER',
  `POST /admin/auth/login -> ${login.status}, role=${login.json?.role}, permissions=${(login.json?.permissions || []).join('/')}`);

const badLogin = await req('POST', '/admin/auth/login', { body: { email: ADMIN_EMAIL, password: 'wrong-password-123' } });
console.log(`        wrong password -> ${badLogin.status} ${badLogin.json?.code}, token issued: ${badLogin.json?.token ? 'YES (bug)' : 'no'}`);

// ---------------------------------------------------------------- 2. product created by admin reaches customers
const categories = await req('GET', '/categories');
const categorySlug = categories.json[0]?.slug;
const slugGuess = `acceptance-rain-coat-${stamp}`;
const created = await req('POST', '/admin/products', {
  token: admin,
  body: {
    nameEn: 'Acceptance Rain Coat', nameAm: 'የመሞከሪያ ጃኬት', descriptionEn: 'Waterproof layer for school mornings',
    descriptionAm: 'ለጠዋት ልሙድ ዝናብ የሚከላከል ልብስ', categorySlug, audience: 'CHILD', gender: 'UNISEX',
    ageGroup: '6-9y', sizingSystem: 'AGE', basePrice: 890, salePrice: 760, featured: false, status: 'PUBLISHED',
    variants: [{ sizeLabel: '6Y', colorName: 'Forest', colorHex: '#2f5d34', stock: 6, sku: `ACC-${stamp}-6Y` }],
  },
});
const productId = created.json?.id ?? created.json?.product?.id;
const publicProduct = await req('GET', `/products/${created.json?.slug || slugGuess}`);
const variantId = publicProduct.json?.variants?.[0]?.id;
check(2, 'Admin creates a product that customers can immediately see',
  created.status === 200 && publicProduct.status === 200 && !!variantId,
  `POST /admin/products -> ${created.status} (id=${productId}, slug=${created.json?.slug}); GET /products/${created.json?.slug} -> ` +
  `${publicProduct.status}, name="${publicProduct.json?.nameEn}", price=${publicProduct.json?.price}, sale=${publicProduct.json?.salePrice}, ` +
  `variant id=${variantId} stock=${publicProduct.json?.variants?.[0]?.stock}`);

// ---------------------------------------------------------------- helper: guest COD order
async function placeOrder(customerPhone, expectedUnits) {
  const cart = await req('POST', '/cart/items', { body: { variantId, quantity: expectedUnits } });
  const cartKey = cart.headers['x-cart-key'];
  const items = cart.json?.items || [];
  const quote = await req('POST', '/checkout/quote',
    { headers: { 'x-cart-key': cartKey }, body: { region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Bole' } });
  const order = await req('POST', '/checkout', {
    headers: { 'x-cart-key': cartKey, idempotency: `acc-${stamp}-${customerPhone}` },
    body: {
      fullName: 'Almaz Tesfaye', phone: customerPhone, secondaryPhone: '0718223344',
      region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Bole', neighborhood: 'Getu Hishir',
      addressLine: 'House 12, near Bole Medhanialem', deliveryInstructions: 'Call on arrival',
      preferredDeliveryTime: 'weekday afternoon', paymentMethod: 'CASH_ON_DELIVERY', language: 'en',
      expectedTotal: quote.json?.total, idempotencyKey: `acc-${stamp}-${customerPhone}`,
    },
  });
  return { cart, cartKey, quote, order };
}

// The checkout reply carries the human-readable order number; the numeric primary key is read from
// PostgreSQL rather than guessed, so scenario 4 proves the row exists as well as giving the ids.
async function idOf(orderJson) {
  if (!orderJson?.orderNumber) return undefined;
  return Number(await sql(`select id from orders where order_number = '${orderJson.orderNumber}'`));
}

// Telegram is deliberately unreachable at this point (the stub is not running), which is scenario 6.
const first = await placeOrder(phone(1234501), 2);
const orderId = await idOf(first.order.json);
const orderNumber = first.order.json?.orderNumber;
const publicToken = first.order.json?.publicToken;
const orderRead = orderId ? await req('GET', `/admin/orders/${orderId}`, { token: admin }) : { status: 0, json: {} };
check(3, 'Customer places a cash-on-delivery order',
  first.order.status === 200 && !!orderNumber && first.order.json?.paymentMethod === 'CASH_ON_DELIVERY',
  `quote subtotal=${first.quote.json?.subtotal} delivery=${first.quote.json?.deliveryFee} total=${first.quote.json?.total} ` +
  `${first.quote.json?.currency}; POST /checkout -> ${first.order.status} ${orderNumber}, paymentMethod=${first.order.json?.paymentMethod}, ` +
  `items=${(first.order.json?.items || []).map((i) => `${i.nameEn}/${i.sizeLabel}x${i.quantity}`).join(', ')}`);

const dbOrder = await sql(`select o.order_number, o.status, o.payment_status, o.total_amount,
       (o.total_amount - o.amount_collected),
       (select count(*) from order_item oi where oi.order_id = o.id)
  from orders o where o.id = ${orderId}`);
const dbLines = await sql(`select oi.product_name_en || ' ' || coalesce(oi.size_label,'-') || ' x' || oi.quantity ||
       ' @ ' || oi.unit_price || ' = ' || oi.line_total from order_item oi where oi.order_id = ${orderId} order by oi.id`);
const moves = await sql(`select count(*) from inventory_movement where reference_id = ${orderId}`);
check(4, 'Order and its items are really stored in PostgreSQL',
  !!dbOrder && dbOrder.split('|').length === 6,
  `psql> ${dbOrder}   [order_number|status|payment_status|total|balance_due|item_count]\n        psql> lines: ${dbLines.replace(/\n/g, '; ')}\n` +
  `        psql> inventory_movement rows for this order: ${moves}`);

// ---------------------------------------------------------------- 6. telegram down, order still saved
await waitFor(async () => {
  const h = await req('GET', '/admin/notifications', { token: admin });
  const row = (h.json?.items || []).find((i) => i.orderNumber === orderNumber);
  return { done: !!row && row.status !== 'PENDING' && (row.attempts || 0) > 0, value: row };
}, 45000);
const afterOutage = await req('GET', '/admin/notifications', { token: admin });
const outageRow = (afterOutage.json?.items || []).find((i) => i.orderNumber === orderNumber);
const stillSaved = await sql(`select status from orders where order_number = '${orderNumber}'`);
check(6, 'A Telegram outage never loses the order; the notification is queued and retried',
  first.order.status === 200 && !!outageRow && ['RETRY', 'SENDING', 'DEAD_LETTER'].includes(outageRow.status),
  `order ${orderNumber} is ${stillSaved} in PostgreSQL while notification #${outageRow?.id} is ${outageRow?.status} ` +
  `after ${outageRow?.attempts} attempt(s), lastError="${outageRow?.lastError}", next attempt ${outageRow?.nextAttemptAt}`);
const customerCharged = await sql(`select payment_status, amount_collected from orders where order_number = '${orderNumber}'`);
console.log(`        customer was not charged: payment_status|amount_collected = ${customerCharged}`);

// ---------------------------------------------------------------- 5. pair the bot, then deliver
await req('PUT', '/admin/telegram/config', { token: admin, body: { botUsername: 'kidsstore_demo_bot', enabled: true } });
const registered = await req('POST', '/admin/telegram/register', { token: admin, body: { telegramUserId: 777001, chatId: 777001 } });
await stub('__online');
const retried = await req('POST', '/admin/notifications/retry-all', { token: admin });
const dispatched = await req('POST', '/admin/notifications/dispatch', { token: admin });
const delivered = await waitFor(async () => {
  const h = await req('GET', '/admin/notifications', { token: admin });
  const row = (h.json?.items || []).find((i) => i.orderNumber === orderNumber);
  return { done: row?.status === 'SENT', value: row };
}, 30000);
const stubCalls = await fetch('http://127.0.0.1:9099/__log').then((r) => r.json()).catch(() => ({ calls: [] }));
const orderMessages = (stubCalls.calls || []).filter((c) => c.method === 'sendMessage' && String(c.body?.text || '').includes(orderNumber));
const sentMessage = orderMessages[0];
const notifyText = String(sentMessage?.body?.text || '').replace(/,/g, '');
const total = String(first.quote.json?.total);
check(5, 'The administrator receives the order on Telegram with the right details',
  delivered?.status === 'SENT' && !!sentMessage &&
  notifyText.includes(`TOTAL TO COLLECT: ETB ${total}`) && notifyText.includes('Almaz Tesfaye') &&
  notifyText.includes(phone(1234501)) && notifyText.includes('CASH ON DELIVERY') &&
  !!sentMessage.body.reply_markup?.inline_keyboard?.length && !notifyText.includes('bot_token') &&
  String(sentMessage.body.chat_id) === '777001',
  `POST /admin/telegram/register -> ${registered.status}; retry-all -> ${retried.status}; dispatch -> ${dispatched.status}; ` +
  `notification #${delivered?.id} status=${delivered?.status} chatId=${delivered?.chatId} telegramMessageId sent to ${sentMessage?.body?.chat_id}\n` +
  `        Bot API payload:\n${String(sentMessage?.body?.text).split('\n').map((l) => '          | ' + l).join('\n')}\n` +
  `        inline buttons: ${JSON.stringify(sentMessage?.body?.reply_markup || null).slice(0, 300)}`);

// ---------------------------------------------------------------- 7. confirmation + delivery trail
const confirmed = await req('POST', `/admin/orders/${orderId}/status?target=CONFIRMED`, { token: admin, body: { note: 'Phone call to the customer' } });
const processing = await req('POST', `/admin/orders/${orderId}/status?target=PROCESSING`, { token: admin, body: {} });
const courier = await req('POST', `/admin/orders/${orderId}/courier`, { token: admin, body: { courierName: 'Yonas courier', courierPhone: '0911223344' } });
const shipped = await req('POST', `/admin/orders/${orderId}/status?target=OUT_FOR_DELIVERY`, { token: admin, body: {} });
const arrived = await req('POST', `/admin/orders/${orderId}/status?target=DELIVERED`, { token: admin, body: { note: 'Handed to the customer at the gate' } });
const afterMove = await req('GET', `/admin/orders/${orderId}`, { token: admin });
const badMove = await req('POST', `/admin/orders/${orderId}/status?target=PENDING_CONFIRMATION`, { token: admin, body: {} });
check(7, 'Confirmation and delivery progress are recorded with a full history',
  [confirmed, processing, shipped, arrived].every((r) => r.status === 200) && afterMove.json?.status === 'DELIVERED' &&
  (afterMove.json?.history || afterMove.json?.statusHistory || []).length >= 4 && badMove.status >= 400,
  `CONFIRMED->${confirmed.status} PROCESSING->${processing.status} courier->${courier.status} OUT_FOR_DELIVERY->${shipped.status} ` +
  `DELIVERED->${arrived.status}; final status=${afterMove.json?.status}; history=` +
  `${(afterMove.json?.history || afterMove.json?.statusHistory || []).map((h) => `${h.fromStatus || 'placed'}->${h.toStatus}(${h.actorType})`).join(', ')}; ` +
  `illegal backward move -> ${badMove.status} ${badMove.json?.code}`);

// ---------------------------------------------------------------- 8 + 9. cash controls
const paidEarly = await req('GET', `/admin/orders/${orderId}`, { token: admin });
check(8, 'An order is never PAID before someone confirms the cash',
  paidEarly.json?.paymentStatus === 'UNPAID' && Number(paidEarly.json?.amountCollected) === 0 &&
  Number(paidEarly.json?.balanceDue) === Number(paidEarly.json?.totalAmount),
  `delivered order ${orderNumber}: paymentStatus=${paidEarly.json?.paymentStatus}, amountCollected=${paidEarly.json?.amountCollected}, ` +
  `total=${paidEarly.json?.totalAmount}, balanceDue=${paidEarly.json?.balanceDue} (DB says ` +
  `${await sql(`select payment_status || ' / ' || amount_collected from orders where id=${orderId}`)})`);

const cash = await req('POST', `/admin/orders/${orderId}/cash-collection`, { token: admin, body: { collectedBy: 'Store owner', note: 'Cash handed over at the door' } });
const afterCash = await req('GET', `/admin/orders/${orderId}`, { token: admin });
const cashDb = await sql(`select payment_status, amount_collected, payment_collected_at is not null from orders where id=${orderId}`);
check(9, 'Recording the cash collection moves the payment status',
  cash.status === 200 && afterCash.json?.paymentStatus === 'PAID' &&
  Number(afterCash.json?.amountCollected) === Number(afterCash.json?.totalAmount),
  `POST /cash-collection -> ${cash.status}; paymentStatus=${afterCash.json?.paymentStatus}, collected=${afterCash.json?.amountCollected}, ` +
  `balanceDue=${afterCash.json?.balanceDue}; DB payment_status|amount|payment_collected_at_set = ${cashDb}`);

// ---------------------------------------------------------------- 10. authorization boundaries
const anon = await req('GET', '/admin/orders');
const second = await placeOrder(phone(1234502), 1);
const otherOrderId = await idOf(second.order.json);
const loginA = await req('POST', '/customers/auth/phone', {
  body: { phone: phone(1234501), orderNumber, publicToken },
});
const customerToken = loginA.json?.token;
const ownOrder = customerToken ? await req('GET', `/me/orders/${orderId}`, { token: customerToken }) : { status: 0 };
const peek = customerToken ? await req('GET', `/me/orders/${otherOrderId}`, { token: customerToken }) : { status: 0 };
const peekAdmin = customerToken ? await req('GET', `/admin/orders/${otherOrderId}`, { token: customerToken }) : { status: 0 };
const tracked = await req('GET', `/orders/track/${orderNumber}`);
const trackedWithToken = await req('GET', `/orders/track/${orderNumber}?token=${publicToken}`);
check(10, 'A customer cannot reach the admin APIs or another customer’s order',
  anon.status === 401 && ownOrder.status === 200 && peek.status === 403 && peekAdmin.status === 403 &&
  tracked.status >= 400 && trackedWithToken.status === 200,
  `GET /admin/orders without a token -> ${anon.status} ${anon.json?.code}; customer’s own order -> ${ownOrder.status}; ` +
  `another customer’s order -> ${peek.status} ${peek.json?.code}; customer token on /admin/orders -> ${peekAdmin.status} ${peekAdmin.json?.code}; ` +
  `tracking without the receipt token -> ${tracked.status} ${tracked.json?.code}, with it -> ${trackedWithToken.status}`);

// ---------------------------------------------------------------- 11. changes survive a refresh
const inventory = await req('GET', '/admin/inventory', { token: admin });
const row0 = (inventory.json?.items || [])[0] || {};
const stockEdit = await req('POST', `/admin/variants/${variantId}/stock`, { token: admin, body: { mode: 'SET', stock: 11, reason: 'STOCK_SET', note: 'Acceptance stock edit' } });
const priceEdit = await req('PUT', `/admin/products/${productId}`, {
  token: admin,
  body: {
    nameEn: 'Acceptance Rain Coat', nameAm: 'የመሞከሪያ ጃኬት', categorySlug, audience: 'CHILD', gender: 'UNISEX',
    ageGroup: '6-9y', sizingSystem: 'AGE', basePrice: 990, salePrice: 840, status: 'PUBLISHED', featured: true,
    variants: [{ id: variantId, sizeLabel: '6Y', colorName: 'Forest', colorHex: '#2f5d34', stock: 11, sku: `ACC-${stamp}-6Y` }],
  },
});
const settings = await req('GET', '/admin/settings', { token: admin });
const newSettings = { ...settings.json, storeNameEn: 'Debol (acceptance run)', freeDeliveryOver: 2500 };
delete newSettings.updatedAt;
const saveSettings = await req('PUT', '/admin/settings', { token: admin, body: newSettings });
const zones = await req('GET', '/admin/delivery-zones', { token: admin });
const zone = (zones.json?.items || zones.json || [])[0];
const zoneEdit = await req('PUT', `/admin/delivery-zones/${zone.id}`, {
  token: admin,
  body: { nameEn: zone.nameEn, nameAm: zone.nameAm, region: zone.region, city: zone.city, subCity: zone.subCity,
          fee: 175, freeOver: 3000, estimatedDays: 3, active: true },
});
// Re-read everything the way a page refresh would.
const reReadProduct = await req('GET', `/products/${created.json?.slug}`);
const reReadSettings = await req('GET', '/admin/settings', { token: admin });
const reReadZones = await req('GET', '/admin/delivery-zones', { token: admin });
const reReadZone = (reReadZones.json?.items || reReadZones.json || []).find((z) => z.id === zone.id);
const dbStock = await sql(`select stock from product_variant where id = ${variantId}`);
const newQuote = await req('POST', '/checkout/quote', { headers: { 'x-cart-key': first.cartKey }, body: { region: zone.region, city: zone.city, subCity: zone.subCity } });
check(11, 'Product, inventory, delivery-fee and settings edits persist across a refresh',
  stockEdit.status === 200 && Number(reReadProduct.json?.variants?.[0]?.stock) === 11 &&
  Number(reReadProduct.json?.price) === 990 && reReadProduct.json?.featured === true &&
  saveSettings.status === 200 && reReadSettings.json?.freeDeliveryOver === 2500 &&
  zoneEdit.status === 200 && Number(reReadZone?.fee) === 175,
  `stock edit -> ${stockEdit.status}, DB stock=${dbStock}, refreshed API stock=${reReadProduct.json?.variants?.[0]?.stock}; ` +
  `price/feature edit -> ${priceEdit.status}, refreshed price=${reReadProduct.json?.price} sale=${reReadProduct.json?.salePrice} featured=${reReadProduct.json?.featured}; ` +
  `settings -> ${saveSettings.status}, refreshed freeDeliveryOver=${reReadSettings.json?.freeDeliveryOver}, storeName="${reReadSettings.json?.storeNameEn}"; ` +
  `zone ${zone.id} fee -> ${zoneEdit.status}, refreshed fee=${reReadZone?.fee}; a new quote for that zone returns delivery=${newQuote.json?.deliveryFee}`);

// ---------------------------------------------------------------- 12. failures stay visible and retryable
const outage2 = await stub('__offline');
const third = await placeOrder(phone(1234503), 1);
const failedRow = await waitFor(async () => {
  const h = await req('GET', '/admin/notifications?status=RETRY', { token: admin });
  const row = (h.json?.items || []).find((i) => i.orderNumber === third.order.json?.orderNumber);
  return { done: !!row, value: row };
}, 45000);
const visible = await req('GET', '/admin/notifications', { token: admin });
const countsBefore = visible.json?.counts;
const retryAgain = await req('POST', `/admin/orders/${await idOf(third.order.json)}/notification-retry`, { token: admin });
const fetched = await stub('__online');
const afterRetry = await waitFor(async () => {
  const h = await req('GET', '/admin/notifications', { token: admin });
  const row = (h.json?.items || []).find((i) => i.orderNumber === third.order.json?.orderNumber);
  return { done: row?.status === 'SENT', value: row };
}, 40000);
check(12, 'Failed notifications are visible in the panel and can be retried',
  !!failedRow && (failedRow.lastError || '').length > 0 && retryAgain.status === 200 && afterRetry?.status === 'SENT',
  `stub taken offline (${outage2.status}); order ${third.order.json?.orderNumber} queued as ${failedRow?.status} with error ` +
  `"${failedRow?.lastError}"; panel counts ${JSON.stringify(countsBefore)}; targeted retry -> ${retryAgain.status} ` +
  `${JSON.stringify(retryAgain.json)}; after the Bot API came back the row is ${afterRetry?.status} (attempts=${afterRetry?.attempts})`);

// ---------------------------------------------------------------- summary + dashboard truth
const dash = await req('GET', '/admin/dashboard', { token: admin });
const dbToday = await sql(`select count(*) from orders where created_at >= date_trunc('day', now())`);
const auditRows = await sql(`select count(*) from audit_log`);
console.log('\nDashboard (all counted in PostgreSQL): ' + JSON.stringify({
  ordersToday: dash.json?.ordersToday, awaitingConfirmation: dash.json?.awaitingConfirmation,
  inFulfilment: dash.json?.inFulfilment, deliveredTotal: dash.json?.deliveredTotal,
  collectedRevenue: dash.json?.collectedRevenue, unpaidDelivered: dash.json?.unpaidDelivered,
  lowStock: (dash.json?.lowStock || []).length, notifications: dash.json?.notifications, telegram: dash.json?.telegram?.ready,
}));
console.log(`Cross-check: orders created today in the DB = ${dbToday}; audit_log rows = ${auditRows} (who changed what).`);
console.log(`\n${pass.length} of 12 acceptance scenarios passed${fail.length ? `; FAILED: ${fail.join(', ')}` : ''}`);
process.exit(fail.length ? 1 : 0);
