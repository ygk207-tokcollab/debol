# Acceptance run

`scripts/acceptance.mjs` is a black-box acceptance harness for the twelve scenarios in the build
brief. It drives a **running backend over real HTTP** and asserts against the **real PostgreSQL
database** through `psql`; nothing is mocked inside the app. Each step prints the evidence it used, and
the run ends with `N of 12 acceptance scenarios passed` and exit code 1 if anything failed.

Header comment of the script, verbatim: "Every step goes over HTTP against a running backend and the
real PostgreSQL instance it talks to; nothing here is mocked, and each check prints the evidence it
used."

## Preconditions

1. A PostgreSQL database migrated by the app (V1 + V2) with an OWNER account matching
   `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The defaults are the throwaway demo pair created by
   `scripts/run-demo.ps1` (`owner@kidsstore.test` / `LocalDemo2026pass`, database `kidsstore_demo`).
2. The backend listening on the port in `BASE_URL` (default `http://127.0.0.1:8090/api/v1`).
   `scripts/run-demo.ps1` defaults to 8080, so set `SERVER_PORT=8090`.
3. The Telegram Bot API stub running, because the script takes it offline/online to simulate outages.
4. `psql` reachable at `PSQL` (default `C:/Program Files/PostgreSQL/18/bin/psql.exe`) with the same
   `DB_*` credentials the backend uses.

The run is destructive by design: it creates products, orders, carts and audit rows and it edits store
settings (`storeNameEn` becomes `Debol (acceptance run)`, `freeDeliveryOver` becomes 2500) and the
first delivery zone's fee (175). Use a disposable database.

## How to run

```bash
# 1. Bot API stand-in (its working directory receives .telegram-stub-log.jsonl)
cd kids-store/scripts
node telegram-stub.mjs                     # "Telegram Bot API stub listening on 127.0.0.1:9099"
```

```bash
# 2. backend on 8090 against kidsstore_demo, polling off (pairing is done via the register endpoint)
cd kids-store
SERVER_PORT=8090 powershell -File scripts/run-demo.ps1
# or from source: DB_NAME=kidsstore_demo SERVER_PORT=8090 ./scripts/run-backend.sh
```

```bash
# 3. the twelve scenarios
cd kids-store
node scripts/acceptance.mjs
```

Overridable environment variables (all read at the top of the script): `BASE_URL`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `PSQL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.

```bash
BASE_URL=http://127.0.0.1:8080/api/v1 DB_NAME=kidsstore_dev \
  ADMIN_EMAIL=owner@example.test ADMIN_PASSWORD=Localdev2026pass node scripts/acceptance.mjs
```

If the stub is not running, `POST /__offline`/`/__reset` are swallowed (status 0) and scenarios 5 and
12 fail; if `psql` is missing the run throws on the first DB assertion (scenario 4).

## The twelve scenarios, as the code asserts them

Executed in the order the file reads top to bottom - note that **6 runs before 5** on purpose, because
Telegram must be unreachable while the first order is placed.

| # | Title in the script | What it actually does and proves |
| --- | --- | --- |
| 1 | Administrator can sign in and the panel is protected | `POST /admin/auth/login` with the seeded email/password must return 200 with a `token` and `role: "OWNER"` plus its `permissions` list. It then logs in with `wrong-password-123` and prints the status/`code` and whether a token was issued (expect 401 and no token) - the negative case is reported, not asserted |
| 2 | Admin creates a product that customers can immediately see | `POST /admin/products` as OWNER with a bilingual name, `categorySlug` taken from the first result of the public `GET /categories`, `status: "PUBLISHED"`, `basePrice 890` / `salePrice 760` and one variant (`6Y` / `Forest` / stock 6 / unique SKU). Then the **public** `GET /products/{slug}` (no token) must return the product with a variant id, price and stock - proof that admin writes reach the storefront without extra publishing |
| 3 | Customer places a cash-on-delivery order | As a guest: `POST /cart/items` (`variantId`, quantity 2) reading the new cart key from the `x-cart-key` response header, `POST /checkout/quote` (Addis Ababa / Bole) for subtotal + delivery fee + total, then `POST /checkout` with a full Ethiopian address, `paymentMethod: "CASH_ON_DELIVERY"`, `expectedTotal` from the quote and an `idempotencyKey`. Asserts 200, an `orderNumber`, and `paymentMethod === "CASH_ON_DELIVERY"` |
| 4 | Order and its items are really stored in PostgreSQL | Three `psql` queries: the `orders` row (`order_number`, `status`, `payment_status`, `total_amount`, `total - amount_collected`, and a subselect count of `order_item`) and one line per `order_item` (`product_name_en size x qty @ unit = line_total`), plus the number of `inventory_movement` rows referencing the order. Passes when the order row exists with all six fields and the item lines are there - i.e. persistence, not just an HTTP 200 |
| 6 | A Telegram outage never loses the order; the notification is queued and retried | While the stub is forced offline (`POST /__offline` answers 500 "Simulated Bot API outage"). Polls `GET /admin/notifications` up to 45 s until the row for that `orderNumber` has left `PENDING` and `attempts > 0`, then asserts its status is one of `RETRY` / `SENDING` / `DEAD_LETTER` **and** re-reads `orders.status` from the database to show the order is intact. Extra evidence line proves the customer was not charged (`payment_status`, `amount_collected`) |
| 5 | The administrator receives the order on Telegram with the right details | `PUT /admin/telegram/config` (`botUsername`, `enabled: true`), `POST /admin/telegram/register` (`telegramUserId: 777001`, `chatId: 777001`) - the manual pairing path, since the stub's `getUpdates` returns `[]` - then `POST /__online`, `POST /admin/notifications/retry-all`, `POST /admin/notifications/dispatch`, and waits up to 30 s for the row to be `SENT`. Reads `GET http://127.0.0.1:9099/__log`, finds the `sendMessage` call whose text contains the order number and asserts the payload: contains `TOTAL TO COLLECT: ETB <quoted total>`, the customer name `Almaz Tesfaye`, the customer phone, `CASH ON DELIVERY`, a non-empty `reply_markup.inline_keyboard`, `chat_id == 777001`, and that the text does **not** contain `bot_token`. It prints the full message body line by line plus the buttons |
| 7 | Confirmation and delivery progress are recorded with a full history | Walks the state machine through the admin API: `?target=CONFIRMED` (with a note), `PROCESSING`, `POST /admin/orders/{id}/courier`, `OUT_FOR_DELIVERY`, `DELIVERED`; then `GET /admin/orders/{id}` must show `DELIVERED` with >= 4 history entries (each printed as `from->to (actorType)`). Finally it attempts the illegal backward move `?target=PENDING_CONFIRMATION` and asserts `status >= 400` |
| 8 | An order is never PAID before someone confirms the cash | Re-reads the delivered order: `paymentStatus === "UNPAID"`, `amountCollected === 0`, `balanceDue === totalAmount`, cross-checked against `select payment_status, amount_collected from orders`. Delivery alone must not imply payment |
| 9 | Recording the cash collection moves the payment status | `POST /admin/orders/{id}/cash-collection` (`collectedBy`, `note`) then asserts `paymentStatus === "PAID"`, `amountCollected === totalAmount`, and the DB columns `payment_status`, `amount_collected`, `payment_collected_at is not null` |
| 10 | A customer cannot reach the admin APIs or another customer's order | `GET /admin/orders` anonymously must be 401. Places a second order, signs in as the first customer with `POST /customers/auth/phone` (phone + `orderNumber` + `publicToken`, i.e. proof-of-purchase), then asserts: own order via `/me/orders/{id}` = 200; the other customer's order via `/me/orders/{otherId}` = 403; that customer token on `/admin/orders/{otherId}` = 403; `GET /orders/track/{orderNumber}` without the receipt token = `>= 400`; with `?token=<publicToken>` = 200 |
| 11 | Product, inventory, delivery-fee and settings edits persist across a refresh | `POST /admin/variants/{id}/stock` (`mode: "SET"`, stock 11, `reason: "STOCK_SET"`), `PUT /admin/products/{id}` (price 990, sale 840, `featured: true`, variant echoed with its id), `PUT /admin/settings` (name + `freeDeliveryOver: 2500`, sending back the whole settings object minus `updatedAt`), `PUT /admin/delivery-zones/{id}` (fee 175). Then re-fetches each **the way a page refresh would** (`GET /products/{slug}`, `GET /admin/settings`, `GET /admin/delivery-zones`) and asserts the new values, plus `select stock from product_variant` from the DB and a fresh `POST /checkout/quote` showing the zone's new delivery fee |
| 12 | Failed notifications are visible in the panel and can be retried | Takes the stub offline again (`POST /__offline`), places a third order, waits up to 45 s for it to appear in `GET /admin/notifications?status=RETRY`, asserts `lastError` is non-empty and prints the panel's `counts` object; then `POST /admin/orders/{id}/notification-retry` (must be 200), brings the stub back (`POST /__online`) and waits up to 40 s for that row to become `SENT`. This is the operator recovery path end to end |

After the twelve checks the script prints a dashboard cross-check (not scored): `GET /admin/dashboard`
values for `ordersToday`, `awaitingConfirmation`, `inFulfilment`, `deliveredTotal`,
`collectedRevenue`, `unpaidDelivered`, low-stock count, notification counts, `telegram.ready`, next to
`select count(*) from orders where created_at >= date_trunc('day', now())` and
`select count(*) from audit_log` - i.e. the dashboard is proved to be counting the database, not
in-memory state.

## Reading the output

```
PASS  4. Order and its items are really stored in PostgreSQL
        psql> ORD-2026-00001|PENDING_CONFIRMATION|UNPAID|1670.00|1670.00|1   [order_number|status|payment_status|total|balance_due|item_count]
        psql> lines: Acceptance Rain Coat 6Y x2 @ 760.00 = 1520.00
        psql> inventory_movement rows for this order: 1
```

- `PASS` / `FAIL` then the scenario number and the script's own title, with indented evidence lines
  containing the raw HTTP statuses, response fields, `psql` output, and for scenario 5 the complete
  Telegram message body.
- The final line is authoritative: `12 of 12 acceptance scenarios passed`, or `... ; FAILED: 6, 9`.
- `process.exit(fail.length ? 1 : 0)` makes it usable in a pipeline.

## Known characteristics of the harness

- Numbering: checks are labelled 1-12 but 6 executes before 5, and scenario 5 also re-delivers the
  notification first created in scenario 6.
- The stub's recorded calls live in `scripts/.telegram-stub-log.jsonl` (rewritten by `POST /__reset`),
  which is the evidence source for scenario 5.
- `check()` reports the *script's* expectation; the printed `code` for negative cases
  (e.g. `badLogin.json?.code`) reads a field the API does not emit - the backend error body is
  `{"error": "...","message":"..."}` (`ErrorResponse`), so those small `undefined`s in the evidence
  lines are cosmetic. The assertions themselves use `status`, which is correct.
- Scenario 10's phone sign-in depends on `ALLOW_PHONE_LOGIN=true` (the default).
- Scenario 5 asserts against the stub on port 9099; pointing `TELEGRAM_API_BASE_URL` at the real Bot
  API would send a genuine message to whoever is registered as chat `777001` - do not.

Related: [SETUP-LOCAL.md](SETUP-LOCAL.md) (starting the stack),
[TELEGRAM-SETUP.md](TELEGRAM-SETUP.md) (pairing and the outbox),
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) (what each failure means).
