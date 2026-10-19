# Delivery platform (Farwings)

A web app for building-materials traders to plan deliveries, know what each one costs before it leaves, and track drivers and customers. It serves many client companies, each with several shops.

- **Logins:** Supabase Auth
- **Database:** Google Sheets, one spreadsheet per client company
- **API:** a single Supabase Edge Function
- **Four kinds of user:** platform admin (Farwings), staff (with admins as staff plus Team and Settings), drivers, and customers (tracking link)

## Try it now (no accounts needed)

```bash
npm install
npm run demo
```

Open http://localhost:5173. The sign-in page lists the demo accounts.

| Sign in as | To see |
|---|---|
| `admin@farwings.dev` (password `platform-demo`) | Platform admin: organisations and the Problems list |
| `salim@technicalhardware.om` | Admin of Technical Hardware: deliveries, vehicles, team, settings |
| `fatma@technicalhardware.om` | Staff at Ghala: create, cost and assign deliveries |
| `hamad@technicalhardware.om` | Staff at Rusayl: only Rusayl data |
| `92000001` / `92000002` | Drivers. Open them in a phone-sized window. |

- The password for all client accounts is `demo-pass-1`.
- Demo data is saved in `.local-data.json`. Delete that file to start over.
- The demo company has about two months of finished deliveries, so **Reports** and **Money** show real-looking figures from the first click.
- The demo has two example orders from the client's brief: a 100 kg, 50 OMR order about 100 km away, and a 48 cbm, 500 OMR order that needs a hired truck. Open **New delivery** and pick *Musannah Date Farm* or *Muscat Towers Fit-out* to see every calculation.

## What staff see for each delivery

Distance and time, every vehicle (own or hired) that could carry the load with the reason when one cannot, each cost line with its working (fuel, wear, driver time, hire, loading), the budget from the delivery charge and the invoice value, what is left over or short, and the charge that would break even. All rates are set by the admin under **Settings → Costs**.

## What else is in it

| Area | What it does |
|---|---|
| **GCC costing** | Country and city set the currency, time zone and fuel price (Oman, UAE, Saudi Arabia, Qatar, Kuwait, Bahrain). Fuel follows the official price table by date, or your own prices. Driver cost includes housing, visa, insurance and end-of-service gratuity, not just salary. Helpers, crane or forklift, waiting time and area tolls are costed per job. Midday work bans and city truck bans are flagged on the delivery form. |
| **Pricing** | A price list (base, per km, per 100 kg, per cbm, helpers, crane, forklift, waiting, minimum, free over an order value) next to "cost plus your margin". One tap uses either, and the quote can be copied for WhatsApp. Own vehicle against hired truck is compared for every order. |
| **Proof of delivery** | The driver records what was delivered, damaged or returned per item, takes photos and gets the receiver's signature on the phone, even without signal. The customer sees the signature and photos on their tracking link. A printable bilingual delivery note with a QR code goes with the goods. |
| **Money** | Cash, cheques (with post-dated dates and cheque photos) and bank transfers collected at the door. Drivers hand in to the office, which counts the cash and records any difference. Cheques are tracked to deposited, cleared or bounced. |
| **Fleet costs** | Fuel (drivers can log it from their phone), repairs, tyres and fines per vehicle, compared with the cost per km the calculator uses. |
| **Reports** | Cost and charges by customer, area, vehicle, driver and month; deliveries over budget; on-time rate; hours on shift; cash differences; km saved by route planning. Downloads as a multi-sheet Excel file. |

## Commands

| Command | Does |
|---|---|
| `npm run demo` | Local API with sample data, plus the web app |
| `npm run dev` | Web app against your real Supabase (needs `.env`) |
| `npm test` | API tests: roles, shop and client separation, capacity and hire costing, GCC fuel and work-ban rules, pricing, proof of delivery, collections, fleet costs, reports, offline sync, tracking, problems log, quota use |
| `npm run build` | Type-check and build into `dist/` |

## Going live

Follow **[SETUP.md](SETUP.md)**: Google service account → Supabase project → deploy the `api` function → upload `dist/` to Hostinger (or any static host).

**[ARCHITECTURE.md](ARCHITECTURE.md)** covers:

- How the sheets are used
- Roles
- Google's limits and what the app does about them
- Offline driver updates
- What is not built yet
