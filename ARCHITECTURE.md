# Architecture

## The pieces

```
 Office staff (browser)          Drivers (phone browser)        Customers (tracking link)
        │                                │                                 │
        └──────────── React web app (static files, any host) ──────────────┘
                                         │  HTTPS + Supabase login token
                                         ▼
                       Supabase Edge Function  "api"  (Deno)
                       ├─ checks the token with Supabase Auth
                       ├─ checks role, organisation and shop access
                       └─ reads and writes Google Sheets with a service account
                                         │
             ┌───────────────────────────┴─────────────────────────────┐
             ▼                                                         ▼
  Platform spreadsheet (Farwings)                    One spreadsheet per organisation
  ├─ organizations                                   ├─ settings, shops, staff, areas
  └─ error_log  (problems for the platform admin)
                                                     ├─ customers, addresses
                                                     ├─ vehicles, vehicle_documents
                                                     ├─ deliveries, delivery_events, trips
                                                     ├─ payments, settlements, vehicle_costs
                                                     └─ activity_log

  Supabase Storage bucket "delivery-proof" (private): delivery photos, signatures, cheque photos
```

- **Supabase** is used for logins and for proof-of-delivery images (a private Storage bucket, shown through short-lived signed links). It stores no other business data. The parts it holds are each user's role, organisation, spreadsheet ID and shops, all kept in `app_metadata`, which users cannot change themselves.
- **Google Sheets** holds all the business data. Each client company has its own spreadsheet, so its data stays separate from other clients and it can open its own sheet.
- **The browser never talks to Google.** Only the Edge Function holds the Google key.

## Who can do what

| Role | Scope | Can |
|---|---|---|
| Platform admin (Farwings) | All organisations | Create, suspend or check organisations and their first admin; read the Problems list. Sees no client deliveries. |
| Admin | Everything in their organisation | All staff work, plus shops, vehicles and hire options, areas, team, settings and the history |
| Staff | Their shops | Create deliveries and customers, see costs, assign drivers, track. Vehicles are view-only. |
| Driver | Their shops | Their own deliveries today, through the driver pages |
| Customer | One delivery | A private tracking link, no sign-in |

**Each client is isolated.** A person's organisation and spreadsheet ID are stored in Supabase `app_metadata`, which users cannot edit. Every request opens only that spreadsheet, so no client can read or write another client's data. Suspending a client locks all of its users out at once.

- The server checks every request against this table and against the user's shops (`supabase/functions/_shared/domain/permissions.ts`). The menus only hide what the server would refuse anyway.
- Switching a person off bans their Supabase login.

## Where the logic lives

| Folder | What |
|---|---|
| `supabase/functions/_shared/domain/` | Rules shared by server and browser: costs, route order, status changes, permissions |
| `supabase/functions/_shared/sheets/` | Google Sheets client and the "book" that loads tabs and saves changes |
| `supabase/functions/_shared/services/` | One file per area: platform, admin, records, deliveries, driver, tracking, logs |
| `supabase/functions/_shared/app.ts` | URL routes |
| `supabase/functions/api/index.ts` | Deno entry: Supabase admin client and environment |
| `src/` | React app: `pages/app` (admin and staff), `pages/driver`, `pages/track`, `pages/platform` |
| `scripts/local-api.ts` | The same API on Node with an in-memory sheet and fake logins, for `npm run demo` |
| `tests/api.test.ts` | End-to-end tests of the API against the in-memory sheet |

The same `handle(request, deps)` function serves both Supabase and the local demo, so what you try locally is the code that runs in production. Only the Google client and the login provider differ.

## How a delivery is costed

The same code (`domain/cost.ts`) runs in the browser, so staff see every number change as they type, and on the server, which saves the figures. For one delivery:

1. **Distance:** straight line × road factor, one way, doubled for the return.
2. **Time:** distance ÷ average speed × traffic factor, plus time at the customer.
3. **Vehicle:** every active vehicle of the shop, plus hire options, is checked against the load's weight (kg) and volume (cbm). Vehicles that fit are ranked cheapest first; those that do not are shown with the reason.
4. **Cost lines:** fuel (km × L/100 km × the price for that country, fuel type and date), wear (km × rate), driver time (minutes × the loaded monthly cost ÷ working minutes), vehicle hire (days × price per day, for hired vehicles only), helpers, crane or forklift, area tolls and a fixed loading cost. Waiting time at the site is added to the minutes.
5. **Budget:** delivery charge plus the allowed share of the invoice value. Left over or short = budget − cost. The break-even charge is the smallest charge that covers the cost.
6. **What to charge:** the price list (`domain/pricing.ts`) and cost + target margin are shown side by side.

The loaded driver cost is salary + housing + visa cost spread over its months + insurance + gratuity (days per year × daily wage ÷ 12). Fuel prices and work-time rules for the six GCC countries live in `domain/gcc.ts`. The fuel table was checked in October 2026; admins can add newer prices in **Settings → Costs** without a new release.

All the rates come from **Settings**. A hire option has no plate and is a price per day; it is offered only when the load does not fit an owned vehicle or when it is cheaper.

## The Problems list

Unexpected server errors, Google Sheets failures and browser crashes are appended to the platform spreadsheet's `error_log` tab with the client, the person and where it happened. It is limited to 15 entries a minute and the same problem is logged once a minute, so an outage cannot use up the Sheets quota. Logging never stops a request from finishing. **Check all organisations** opens each client's spreadsheet and can add any missing tabs and columns (it never removes anything). Spreadsheets from older versions also get new columns added automatically when they are next read.

## How a request uses the sheets

Each request does one read and as few writes as possible:

1. **Load**: one `values:batchGet` reads every tab the request needs.
2. **Change in memory**: updates and new rows. Columns are matched by header name, so column order does not matter.
3. **Commit**: one `values:batchUpdate` for all changed rows, plus one `append` per tab that has new rows.

Measured in the tests:

- Opening a screen costs 1 read.
- Assigning a delivery costs 1 read and 4 writes (delivery, trip, event, activity log).

All values are written as `RAW`, so text such as `=IMPORTXML(...)` typed into a form is stored as text and never runs as a formula.

## Limits to plan for

| Limit | Value | What the app does |
|---|---|---|
| Sheets reads | 60 a minute per service account | Screens cache data for 30 s. The driver phone checks every 60 s and the tracking page every 2 min, and both stop once a delivery is finished. Google's own back-off is applied on "busy" replies. |
| Sheets writes | 60 a minute per service account | Each action is a single commit |
| Rows | About 10 million cells per spreadsheet | The deliveries tab has about 45 columns, so it holds roughly 200,000 deliveries. Archive older years into a copy. |
| Speed | Each request reads whole tabs | Fine for thousands of rows. Above about 20,000 deliveries, archive the old ones. |

**Rough capacity on one service account:** about 15 people working at once in the office, plus about 10 drivers and customers checking the tracking page. Beyond that:

- Request a higher quota, which is free in Google Cloud.
- Or give each large client its own service account. Quota is counted per account.

**Two edits at the same moment:** new rows (deliveries, events, log) are appended, so they never overwrite each other. If two people change the same delivery in the same second, the later save wins. The status rules (`domain/status.ts`) then reject impossible moves, such as delivering a cancelled delivery.

**Do not sort, insert or delete rows by hand** while the app is in use. A row is found by its position at the moment a request loads, so moving rows during a save would write to the wrong row. Filter views, extra columns at the end, and other tabs are all safe.

## Driver pages offline

- Each tap (accept, decline, picked up, arrived, delivered, failed) is saved on the phone first, with its own ID, and then sent to `POST /driver/sync`.
- With no signal, the updates wait on the phone and the screen moves on as if they had been sent. They are sent in order when the signal returns, retrying every 20 s.
- The server records each ID in `delivery_events.client_id` and skips any it has already applied, so sending twice is harmless.
- Events sent late are marked `offline = TRUE`, so the office can see they were done without signal.
- The last downloaded list of today's deliveries is kept on the phone, so the page opens even without signal.

## Proof of delivery and money

- **Delivering** sends the item quantities (delivered, damaged, returned), photos, the signature and any payment in the same offline-safe update. Images are checked (JPEG, PNG or WebP, under 900 KB each, resized on the phone first) before anything is changed, so a bad photo never leaves a half-saved delivery. While offline they wait on the phone; the queue sends them in batches of up to 2.5 MB.
- **Payments** move `with_driver → handed_in → deposited → cleared` (or `bounced`); transfers start at `to_verify`. A **settlement** records what a driver handed in, the cash expected and counted, and the difference.
- **Reports** (`GET /reports`) return the period's deliveries, trips, payments, settlements, vehicle costs and shift times in one read; the browser adds them up (`src/pages/app/reportMath.ts`), so the screen and the Excel file always match.

## Customer tracking

- Each delivery gets a random tracking token: `<organisation id>.<40 random hex characters>`.
- `GET /track/:token` needs no login. It returns only that one delivery's stage, ETA, the driver's first name, the vehicle plate, the amount to pay and, once delivered, the signature and up to two photos. It never returns addresses, costs or other customers.
- Ratings can only be given after delivery, and only once.

## Moving off Google Sheets later

All data access goes through the `Book` class (`sheets/book.ts`) and the services. Moving to Postgres would mean rewriting `book.ts` and the loads in each service, while the screens, permissions, cost and route logic stay as they are. The tab and column names in `sheets/schema.ts` would map directly to tables.

## Not in this build yet

Left out on purpose, because each needs a paid service:

- **WhatsApp Business API and SMS.** WhatsApp messages are sent from a delivery's page as ready-to-send links. The SMS setting exists, but no provider is connected.
- **Live GPS position of drivers.** The board shows each delivery's status and ETA, not a moving dot.
- **Road-network distances.** Distance is straight line × road factor; a routing API would make it exact.
- **ERP link and e-invoicing** (ZATCA Fatoora, Oman e-invoicing). Reports export to Excel instead.
