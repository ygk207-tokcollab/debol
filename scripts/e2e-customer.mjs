import { spawn } from 'node:child_process';

/**
 * End-to-end proof for the customer side: phone sign-in issues an unguessable session, the profile
 * form really writes, addresses belong to that customer, and /me/orders only shows orders placed with
 * their own phone. Runs in memory mode so it needs no database.
 *
 *   PORT=3216 node scripts/e2e-customer.mjs
 *
 * Persistence of the same rows across a restart is covered by scripts/e2e-postgres.mjs.
 */
const PORT = Number(process.env.PORT || 3216);
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const MY_PHONE = '0912345678';
const STRANGER_PHONE = '0955512312';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};

const boot = () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const capture = (b) => { logs.push(b.toString()); process.env.E2E_VERBOSE && console.log('  [server]', b.toString().trim()); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.__logs = logs;
  return child;
};

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

const call = async (pathname, { token, method = 'GET', body } = {}) => {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

const signIn = async (phone, fullName) => (await call('/customers/auth/phone', { method: 'POST', body: { phone, fullName } })).data;

const run = async () => {
  const health = await waitUp();
  check('health reports memory-only without DATABASE_URL', health.persistence === 'memory-only', JSON.stringify(health));

  // --- session issuance -----------------------------------------------------
  const anon = await call('/me/profile');
  check('GET /me/profile without a session is 401', anon.status === 401, `${anon.status}`);

  const first = await signIn(MY_PHONE);
  check('phone sign-in returns a session and that phone', first?.token && first.profile.phone === MY_PHONE, JSON.stringify(first?.profile));
  const token = first.token;
  const guessable = `cust_${Buffer.from(MY_PHONE).toString('hex')}`;
  check('token is random, not the old hex-of-phone', token !== guessable && /^cust_[0-9a-f]{48}$/.test(token), token.slice(0, 12));
  check('a new account starts with an empty name', first.profile.fullName === '', JSON.stringify(first.profile.fullName));
  check('currency comes from store settings', first.profile.currency === 'ETB', first.profile.currency);

  const forged = await call('/me/profile', { token: guessable });
  check('the old guessable token format is rejected', forged.status === 401, `${forged.status}`);

  // --- the profile form -----------------------------------------------------
  const saved = await call('/me/profile', { token, method: 'PATCH', body: { fullName: 'Hanna Girma', secondaryPhone: '0922222222' } });
  check('PATCH /me/profile accepts a name', saved.status === 200 && saved.data.fullName === 'Hanna Girma', JSON.stringify(saved.data));
  const reread = await call('/me/profile', { token });
  check('the saved name survives a re-read', reread.data?.fullName === 'Hanna Girma', JSON.stringify(reread.data));
  check('the saved secondary phone survives', reread.data?.secondaryPhone === '0922222222', `${reread.data?.secondaryPhone}`);
  check('the phone still belongs to the signer', reread.data?.phone === MY_PHONE, `${reread.data?.phone}`);

  const badName = await call('/me/profile', { token, method: 'PATCH', body: { fullName: '   ' } });
  check('an empty name is refused', badName.status === 422, `${badName.status}`);
  const badPhone = await call('/me/profile', { token, method: 'PATCH', body: { phone: 'not-a-phone' } });
  check('an invalid phone is refused', badPhone.status === 422, `${badPhone.status}`);

  // --- a second customer --------------------------------------------------
  const other = await signIn(STRANGER_PHONE);
  const otherToken = other.token;
  const otherProfile = await call('/me/profile', { token: otherToken });
  check('a second phone gets its own profile', otherProfile.data?.phone === STRANGER_PHONE && otherProfile.data?.fullName === '', JSON.stringify(otherProfile.data));

  const clash = await call('/me/profile', { token: otherToken, method: 'PATCH', body: { phone: MY_PHONE } });
  check('claiming another customer phone is refused', clash.status === 409, `${clash.status}`);

  // --- addresses ----------------------------------------------------------
  const empty = await call('/me/addresses', { token });
  check('no inherited mock address', Array.isArray(empty.data) && empty.data.length === 0, JSON.stringify(empty.data));

  const addr1 = await call('/me/addresses', { token, method: 'POST', body: { label: 'Home', region: 'Addis Ababa', city: 'Addis Ababa', addressLine: 'House 12' } });
  check('address saved and made default', addr1.status === 200 && addr1.data.id === 1 && addr1.data.isDefault === true, JSON.stringify(addr1.data));
  const addr2 = await call('/me/addresses', { token, method: 'POST', body: { label: 'Work', region: 'Addis Ababa', city: 'Addis Ababa', addressLine: 'Bole Rd 4' } });
  check('a second address is not default', addr2.data.isDefault === false, JSON.stringify(addr2.data));
  const twoList = await call('/me/addresses', { token });
  check('both addresses are stored', twoList.data?.length === 2, `${twoList.data?.length}`);

  const strangerAddresses = await call('/me/addresses', { token: otherToken });
  check("another customer can't see them", strangerAddresses.data?.length === 0, JSON.stringify(strangerAddresses.data));

  const badAddress = await call('/me/addresses', { token, method: 'POST', body: { region: 'Addis Ababa' } });
  check('an address without city/line is refused', badAddress.status === 422 && badAddress.data.fields?.length === 2, JSON.stringify(badAddress.data));

  const removed = await call(`/me/addresses/${addr1.data.id}`, { token, method: 'DELETE' });
  const afterDelete = await call('/me/addresses', { token });
  check('address deleted and default promoted', removed.status === 200 && afterDelete.data?.length === 1 && afterDelete.data[0].isDefault === true, JSON.stringify(afterDelete.data));

  // --- orders -------------------------------------------------------------
  const mine = await call('/me/orders', { token });
  const phones = new Set((mine.data || []).map((e) => e.summary.customerPhone.replace(/\D/g, '')));
  check('order list is filtered to my phone', mine.status === 200 && phones.size === 1 && phones.has(MY_PHONE), JSON.stringify([...phones]));
  check('seeded orders for this phone are present', (mine.data || []).length >= 1, `${mine.data?.length}`);
  const orderId = mine.data?.[0]?.summary?.id;

  const strangerOrders = await call('/me/orders', { token: otherToken });
  check('the stranger sees no orders', strangerOrders.data?.length === 0, `${strangerOrders.data?.length}`);
  const stolenRead = await call(`/me/orders/${orderId}`, { token: otherToken });
  check("the stranger can't read my order by id", stolenRead.status === 404, `${stolenRead.status}`);
  const stolenCancel = await call(`/me/orders/${orderId}/cancel-request`, { token: otherToken, method: 'POST', body: { reason: 'please' } });
  check("the stranger can't cancel my order", stolenCancel.status === 404, `${stolenCancel.status}`);

  const myRead = await call(`/me/orders/${orderId}`, { token });
  check('I can read my own order', myRead.status === 200 && myRead.data.orderNumber, `${myRead.status}`);
  const cancel = await call(`/me/orders/${orderId}/cancel-request`, { token, method: 'POST', body: { reason: 'Ordered the wrong size' } });
  check('my cancellation is recorded', cancel.status === 200 && cancel.data.cancelRequested === true, `${cancel.status}`);
  const cancelled = (await call('/me/orders', { token })).data.find((e) => e.summary.id === orderId);
  check('the list reports the cancellation', cancelled?.summary.cancelRequested === true, JSON.stringify(cancelled?.summary.cancelRequested));
  const history = cancel.data.history || [];
  check('the history carries a customer event', history.some((h) => h.actorType === 'CUSTOMER'), JSON.stringify(history.at(-1)));

  const anonOrders = await call('/me/orders');
  check('the order list needs a session', anonOrders.status === 401, `${anonOrders.status}`);

  // --- returning customer, sign-out ---------------------------------------
  const again = await signIn(MY_PHONE);
  check('signing in again reuses the stored profile', again.profile.fullName === 'Hanna Girma' && again.profile.phone === MY_PHONE, JSON.stringify(again.profile));
  const oldSession = await call('/me/profile', { token });
  check('the previous session for that phone is retired', oldSession.status === 401, `${oldSession.status}`);
  const kept = await call('/me/addresses', { token: again.token });
  check('addresses follow the customer back', kept.data?.length === 1 && kept.data[0].label === 'Work', JSON.stringify(kept.data));

  const out = await call('/customers/auth/logout', { token: again.token, method: 'POST' });
  check('logout revokes the session', out.status === 200 && (await call('/me/profile', { token: again.token })).status === 401, `${out.status}`);

  const afterSignOut = await signIn(MY_PHONE);
  const keptAfterSignOut = await call('/me/addresses', { token: afterSignOut.token });
  check('the account outlives a sign-out', afterSignOut.profile.fullName === 'Hanna Girma' && keptAfterSignOut.data?.length === 1, JSON.stringify(afterSignOut.profile));

  const shortNumber = await call('/customers/auth/phone', { method: 'POST', body: { phone: '1234' } });
  check('a too-short number cannot sign in', shortNumber.status === 422, `${shortNumber.status}`);

  // --- telegram session ---------------------------------------------------
  const initData = `auth_date=1760000000&query_id=AA&user=${encodeURIComponent(JSON.stringify({ id: 42, first_name: 'Bekele', last_name: 'Molla', username: 'bkml' }))}`;
  const tg = await call('/telegram/auth', { method: 'POST', body: { initData } });
  check('telegram sign-in names the telegram user', tg.status === 200 && tg.data.profile.fullName === 'Bekele Molla', JSON.stringify(tg.data.profile));
  check("telegram sessions carry nobody else's phone", tg.data.profile.phone === '' && tg.data.profile.telegramLinked === true, JSON.stringify(tg.data.profile));
  const tgOrders = await call('/me/orders', { token: tg.data.token });
  check('an unnamed telegram session shows no orders', tgOrders.data?.length === 0, JSON.stringify(tgOrders.data));
  const tgJunk = await call('/telegram/auth', { method: 'POST', body: { initData: 'user=%7Bbroken' } });
  check('malformed initData still yields a session', tgJunk.status === 200 && tgJunk.data.profile.fullName === '', JSON.stringify(tgJunk.data?.profile));

  const tgSaved = await call('/me/profile', { token: tg.data.token, method: 'PATCH', body: { fullName: 'Bekele Molla', phone: MY_PHONE } });
  check('a telegram session cannot steal a phone', tgSaved.status === 409, `${tgSaved.status}`);
};

const child = boot();
try {
  await run();
} finally {
  await stop(child);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
if (failed.length) {
  console.log('Failed: ' + failed.map((f) => f.name).join(' | '));
  console.log(child.__logs.join('').slice(-4000));
}
process.exit(failed.length ? 1 : 0);
