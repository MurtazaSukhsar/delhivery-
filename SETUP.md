# Setup guide

This takes about 30 minutes the first time. You need a Google account, a Supabase account and Node.js 20 or newer.

There are three parts:

1. **Google**: a service account that can edit spreadsheets, and the spreadsheets themselves.
2. **Supabase**: logins, plus one Edge Function called `api` that reads and writes the sheets.
3. **The web app**: a static site you host anywhere.

> Try it first without any of this: `npm install` then `npm run demo`, and open http://localhost:5173. The demo keeps its data in `.local-data.json` instead of Google Sheets and has its own sign-ins, which are listed on the sign-in page.

---

## 1. Google

### 1.1 Service account

1. Go to https://console.cloud.google.com and create a project, for example `farwings-delivery`.
2. Go to **APIs & Services → Library**, search for **Google Sheets API** and click **Enable**. No other API is needed.
3. Go to **IAM & Admin → Service accounts → Create service account**. Name it `delivery-api`. Skip the optional role and user steps.
4. Open the new account, go to **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   - Keep this file private. Anyone who has it can edit every spreadsheet shared with it.
5. Note the account's email, which looks like `delivery-api@farwings-delivery.iam.gserviceaccount.com`.

### 1.2 Platform spreadsheet (one, for Farwings)

1. In Google Drive, create a blank spreadsheet called **Delivery platform**.
2. Click **Share** and add the service account email as **Editor**. Untick "Notify people".
3. Copy the spreadsheet ID from its URL, which is the part between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`

The app creates the `organizations` tab itself on first use.

### 1.3 One spreadsheet per customer company

Do this for each new client, such as Technical Hardware:

1. Create a blank spreadsheet, for example **Technical Hardware – deliveries**. It can be in your Drive or in the client's.
2. Share it with the service account email as **Editor**.
3. Keep its link. You will paste it when you create the organisation in the app (step 4). The app adds all the tabs and headers.

---

## 2. Supabase

### 2.1 Project

1. Create a new project at https://supabase.com/dashboard. Choose the region closest to Oman, for example `ap-south-1` (Mumbai) or `me-central-1` if offered.
   - Use a **new** project. Do not reuse the one that holds your other product.
2. Go to **Authentication → Sign In / Providers**:
   - Keep **Email** enabled.
   - Turn **off** "Allow new users to sign up". Only admins create accounts, from inside the app.
   - "Confirm email" can stay on, because the app creates users as already confirmed.
3. Go to **Authentication → Users → Add user → Create new user**. Enter your own email and a strong password, and tick **Auto confirm user**. This is the platform admin account.

### 2.2 Deploy the API function

Install the Supabase CLI (https://supabase.com/docs/guides/cli), then from this folder run:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF          # shown in Project Settings → General

cp supabase/functions/.env.example supabase/functions/.env
# edit supabase/functions/.env:
#   GOOGLE_SERVICE_ACCOUNT_JSON = the whole downloaded JSON file on one line
#   PLATFORM_SHEET_ID          = the ID from step 1.2
#   SUPER_ADMIN_EMAILS         = the email you created in step 2.1
#   PHONE_LOGIN_DOMAIN         = leave as is unless you have a reason

supabase secrets set --env-file supabase/functions/.env
supabase functions deploy api --no-verify-jwt
```

`--no-verify-jwt` is intended. The function checks every token itself, and it has to let the public tracking page through without a login.

To put the JSON key on one line, you can run:

```bash
node -e "console.log(JSON.stringify(require('./downloaded-key.json')))"
```

Then delete the downloaded key file from your computer once it is stored in Supabase.

**Delivery photos and signatures** are kept in a private Supabase Storage bucket called `delivery-proof`. The function creates it the first time a driver sends a photo, using the service role key that Supabase gives every Edge Function, so there is nothing to set up. The free Supabase plan includes 1 GB of storage; photos are resized on the phone to about 150–300 KB each, which is roughly 4,000–6,000 deliveries with two photos and a signature. Check usage under **Storage** in the Supabase dashboard, and move to a paid plan or delete old photos before it fills up.

To check it works, open `https://YOUR-PROJECT-REF.supabase.co/functions/v1/api/health` in a browser. It should return `"ok":true`, and `google_key`, `platform_sheet` and `super_admins` should all be `true`.

---

## 3. The web app

```bash
cp .env.example .env
# VITE_SUPABASE_URL      = https://YOUR-PROJECT-REF.supabase.co
# VITE_SUPABASE_ANON_KEY = Project Settings → API → anon / publishable key
npm install
npm run build
```

Upload the contents of the `dist` folder to any static host. Every path must fall back to `index.html`:

- **Hostinger** (or any Apache host): in hPanel open **File Manager → public_html** and upload everything inside `dist`, including the hidden `.htaccess` file. It already sends every address to the app. If you cannot see `.htaccess`, switch on "Show hidden files" in the File Manager settings.
- **Netlify** and **Cloudflare Pages**: `public/_redirects` already does this.
- **Vercel**: `vercel.json` already does this.
- **Your own server (nginx)**: use `try_files $uri /index.html;`

### Publishing a fix later

When something is fixed in the code (for example from the **Problems** list):

- A change under `src/` (screens): run `npm run build` and upload `dist` to Hostinger again, replacing the old files.
- A change under `supabase/functions/` (rules, costs, Google Sheets): run `supabase functions deploy api --no-verify-jwt`. No upload to Hostinger is needed.

In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to the address where you host the app.

---

## 4. First sign-in

There are four kinds of person, and each sees only their own screens:

| Who | Signs in with | Sees |
|---|---|---|
| **Platform admin** (you, Farwings) | the email from step 2.1 | **Organisations** and **Problems** |
| **Admin** (the client's owner or manager) | email | Everything staff see, plus **Team** and **Settings** |
| **Staff** (office) | email | **Deliveries**, **Customers**, **Vehicles** (view only) |
| **Driver** | phone number | The driver pages on their phone |
| *Customer* | no sign-in | A private tracking link for their own delivery |

1. Open the app and sign in with the platform admin email. You land on **Organisations**.
2. Click **New organisation** and fill in:
   - The company name and a short name.
   - The spreadsheet link from step 1.3.
   - The client's first admin: their name, their email or phone, and a password.
3. Give the client admin their sign-in. They then, in this order:
   - **Settings → Shops**: add their shops. **Settings → Costs**: fuel price, driver salary, speed and the share of the invoice a delivery may cost. These numbers drive every calculation staff see.
   - **Vehicles**: add their own vehicles with weight and cargo space (cbm), and a **hire option** for large orders (a truck they rent for a day, with its price per day).
   - **Team**: add office staff and drivers.

Drivers open the same web address on their phone and sign in with their phone number and password.

## 5. Watching for problems

The platform admin's **Problems** tab lists what broke for any client while they were working: a spreadsheet that can no longer be opened, a server error, or a screen that crashed in someone's browser. Each entry shows the client, the person, where it happened and what to do. **Organisations → Check all organisations** opens every client's spreadsheet and reports any that is missing or missing tabs; one click adds the missing tabs and columns.

---

## Things to know before going live

- **Do not sort, delete or insert rows** in the app's spreadsheets while people are using the app. Rows are found by their position when a request starts. Use filter views to look at data instead. You may add columns at the end and read or chart anything you like.
- **Do not rename the header row** or the tabs.
- Google allows about **60 reads and 60 writes a minute** for the whole platform, because there is one service account. The app is built around this; see `ARCHITECTURE.md`. If a screen says "Google Sheets is busy", wait a minute. You can request a higher quota for free in Google Cloud under **APIs & Services → Google Sheets API → Quotas**.
- Back up a spreadsheet with **File → Make a copy**, or use **File → Version history** to undo mistakes.
- **Check the cost settings with the client** under **Settings → Costs**: country and city, fuel (automatic GCC prices or their own), the driver's real monthly cost (salary, housing, visa, insurance, gratuity), helper and crane rates, and the price list. Fuel prices change monthly in the UAE and yearly in Saudi Arabia; add new prices there when they are announced.
