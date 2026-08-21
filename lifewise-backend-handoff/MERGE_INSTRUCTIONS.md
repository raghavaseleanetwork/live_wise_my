# Backend Merge Instructions

You have the up-to-date **frontend**. This package has the up-to-date **backend**.
Your copy is the base — drop these files in, then hand-merge `package.json`.

**Do not** replace your `package.json` with `package.backend.json`. It is included
for reference only, and overwriting will delete any frontend dependency you added.

---

## Step 1 — Copy folders in (safe, no frontend overlap)

Copy these into your project root, replacing what is there:

```
server/          → server/          (entire folder)
shared/          → shared/          (schema.ts)
scripts/         → scripts/         (merge — see note)
```

`scripts/` note: `build.js` is **not** in this package because it is yours and
newer. Every other file in `scripts/` is backend — copy them in.

Also copy to the project root:

```
eng.traineddata      Tesseract OCR language data (bill scanning)
guj.traineddata
hin.traineddata
drizzle.config.ts
ecosystem.config.js
.env.example
```

None of the above touch `app/`, `components/`, `lib/`, `assets/`, or `admin/`.
Your frontend is untouched.

---

## Step 2 — Merge `package.json` by hand

Open your `package.json` and add anything below that is missing. Keep everything
you already have.

### `dependencies`

```json
"express": "^5.0.1",
"mongodb": "^6.12.0",
"jsonwebtoken": "^9.0.2",
"bcryptjs": "^3.0.3",
"multer": "^1.4.5-lts.1",
"socket.io": "^4.8.3",
"firebase-admin": "^13.0.2",
"@aws-sdk/client-s3": "^3.624.0",
"@aws-sdk/client-textract": "^3.624.0",
"@heyputer/puter.js": "^2.5.1",
"tesseract.js": "^7.0.0",
"zod": "^3.24.2",
"@types/jsonwebtoken": "^9.0.7",
"@types/bcryptjs": "^2.4.6"
```

### `devDependencies`

```json
"tsx": "^4.20.6",
"esbuild": "^0.24.0",
"patch-package": "^8.0.0",
"concurrently": "^9.2.1",
"@types/express": "^5.0.0",
"typescript": "~5.9.2"
```

### `scripts`

```json
"postinstall": "patch-package",
"dev": "concurrently -n server,expo -c blue,green \"npm run server:dev\" \"npm run start\"",
"server:dev": "tsx server/index.ts",
"server:build": "esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist",
"server:prod": "node server_dist/index.js",
"seed:admin": "tsx scripts/seed-admin.ts",
"seed:demo": "tsx scripts/seed-demo.ts",
"backfill:exchange-rates": "tsx scripts/backfill-exchange-rates.ts",
"purge:expo-push-tokens": "tsx scripts/purge-expo-push-tokens.ts",
"test:api": "tsx scripts/test-api.ts"
```

`dev` runs server + Expo together. If you already have a `dev` script, keep yours
and use `server:dev` separately.

Then:

```bash
npm install
```

---

## Step 3 — Secrets (sent separately, never in this zip)

Copy `.env.example` to `.env` and fill it in. Values arrive over a separate
secure channel — they are deliberately not in this package.

Required to boot:

| Variable | What it is |
|---|---|
| `MONGODB_URI` | Mongo connection string |
| `MONGODB_DB_NAME` | Database name |
| `JWT_SECRET` | Token signing secret |
| `SERVER_PORT` | Defaults to 5001 |

Feature-specific (server boots without them; those features degrade):

| Variable | Feature |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET` / `AWS_REGION` | File + avatar upload |
| `RESEND_API_KEY` / `REMINDER_EMAIL_FROM` | Reminder + invite email |
| `GOOGLE_VISION_API_KEY` | Bill scan OCR — see Known Issues |
| `PUTER_AUTH_TOKEN` | Bill scan LLM parsing — see Known Issues |
| `REVENUECAT_WEBHOOK_SECRET` | Subscription webhooks |

You also need **`server/firebase-service-account.json`** for push notifications.
It is not in this package (it holds a private key). Generate your own from the
Firebase console, or request it separately.

---

## Step 4 — Run

```bash
npm run server:dev     # backend only, port 5001
npm run dev            # backend + Expo together
```

Check it is alive:

```bash
curl http://localhost:5001/api/settings
```

---

## Known issues (inherited, not caused by this merge)

**1. Bill scan falls back to regex — extraction is unreliable**

The scan pipeline is Google Vision OCR → Tesseract OCR → Puter LLM → regex.
Two of the four stages are currently down in production:

- **Google Vision returns 403** — billing is not enabled on GCP project
  `152932967230`. Enable it (1000 units/month are free) at
  `https://console.cloud.google.com/billing/linkedaccount?project=152932967230`
- **Puter returns 401 `reauth_required`** — the token expired. Puter GUI session
  tokens expire every few months and cannot be refreshed server-side.
  Re-mint: log in at puter.com → DevTools console → `puter.authToken` → copy
  into `PUTER_AUTH_TOKEN`.

With both down, every scan falls through to regex, which returns vendor
`"Scanned Bill"` and frequently the wrong amount. Fixing Google Vision alone
materially improves results.

Durable fix worth considering: replace all three stages with a single
Anthropic API call that reads the bill image directly and returns structured
JSON — no OCR stage, no expiring token, no GCP billing.

**2. Monorepo caveat**

Backend and frontend share one `package.json` and one `node_modules`. There is
no clean split. Any future dependency change touches both sides — coordinate,
or extract `server/` into its own project with its own `package.json`.

---

## Excluded from this package (deliberately)

| Path | Why |
|---|---|
| `.env` | Live secrets |
| `server/firebase-service-account.json` | Live Firebase private key |
| `google-services.json` | Firebase client config |
| `server/routes.ts.tmp` | Stray temp file |
| `server_dist/`, `node_modules/` | Build output |
| `scripts/build.js` | Frontend — yours is newer |
| `patches/` | Only patch is `expo-asset` — frontend, you have it |
