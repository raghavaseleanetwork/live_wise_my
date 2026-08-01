# Currency Conversion — Backend Note

**Status:** Frontend shipped. Two backend items requested.
**Date:** 2026-07-31

**Backend work, in priority order:**

| | Item | Why | Priority |
|---|---|---|---|
| §4 | **Daily rate history + 2-year backfill** | Client-approved feature. The client physically cannot do this half — the free rate API has no historical endpoint. | **High** |
| §2 | Reminder emails hardcode `₹` | Non-INR users get emails in the wrong currency. | Low |

Everything else in this document is context and constraints — read §1 before
touching anything, it states an invariant that is easy to break by accident.

---

## 1. What the frontend does now

Changing currency in Settings used to swap only the symbol — ₹100 rendered as
$100. It now converts: ₹100 renders as $1.16, using live daily rates.

**The design rule, which the backend must not break:**

> **Every amount is stored in INR and is never rewritten. Currency is a display
> preference, applied at render time.**

This holds today by default, because no record anywhere is currency-tagged —
there is no currency column on transactions, bills, or budgets in
`server/routes.ts` or the schema. A stored `100` means ₹100, unambiguously.

**Do not add currency conversion server-side, and do not rewrite stored amounts
when a user changes their currency.** Converting stored values would round-trip
real financial history through two conversions (INR → USD → INR returns ₹99.87
for ₹100), and a rate that moves overnight would silently restate what the user
spent last year. The client converts on read; the database stays canonical.

Rates come from a public, key-less endpoint, cached on-device for 24 hours, with
hardcoded fallbacks so conversion works offline. No API key, no server proxy, no
cost.

---

## 2. The one thing to fix: reminder emails show the wrong currency

**File:** `server/routes.ts:3029`

```js
currency: '₹',   // hardcoded
```

The bill-reminder email template takes a `{{CURRENCY}}` placeholder, and the
send path hardcodes `'₹'`. A user on USD therefore sees `$1.16` in the app and
receives an email saying **₹100** for the same bill.

The amount is also formatted with `toLocaleString('en-IN', …)`
(`server/routes.ts:189`), which applies Indian digit grouping (1,00,000) to
every currency.

### Why the client cannot fix this

These emails are sent by the server on its own schedule. More fundamentally,
**the server does not know the user's currency**: the preference is stored only
on the device, under the AsyncStorage key `@lifewise_currency`. There is no
currency field on the user record.

### What is needed

1. **Persist the preference.** Add `preferredCurrency` (ISO 4217, e.g. `"USD"`,
   default `"INR"`) to the user profile, with a `PATCH` on the existing profile
   endpoint. The frontend will write to it on change — tell us the field name
   and we will wire it up.
2. **Convert in the email.** Rates for the seven supported currencies are needed
   server-side for this. Any daily-refreshed source is fine; the client uses
   `https://open.er-api.com/v6/latest/INR` (key-less). Cache it — one fetch per
   day is plenty.
3. **Format per currency.** `en-IN` grouping and the ₹ symbol should follow the
   user's currency, not be hardcoded.

**Supported currencies** (must match `CURRENCIES` in `lib/currency-context.tsx`):
`INR`, `USD`, `EUR`, `GBP`, `JPY`, `AUD`, `CAD`.

**Priority: low.** It affects only the text inside reminder emails. Nothing in
the app is wrong, and no data is at risk. Worth doing before the client
demos email reminders to a non-INR user.

---

## 3. If a currency column is ever added

Should the backend later gain a per-record currency, it must be **the currency
the amount is stored in** (always `INR` for existing rows), **not** the currency
the user was viewing when they created it. Those are different things, and
conflating them silently corrupts every historical amount.

Backfill existing rows to `INR`. Do not infer.

---

## 4. Historical rates — client done, backend needed

**Client approved this (2026-07-31). The frontend half is built. The backend
half is the part that makes it actually useful.**

### 4.1 The problem it solves

With a single current rate, every past amount is restated whenever the rupee
moves. A user reviewing 2025 spending in USD sees last year's totals change
month to month even though no transaction changed. Reports cannot be reconciled
against anything — a bank statement, a previous export, or a screenshot.

Correct behaviour: **an expense is converted at the rate that applied on the day
it happened.** A ₹10,000 expense from 1 July stays $120.00 forever, even after
the rate moves to 0.0116.

### 4.2 What the client already does

- Records the daily rate table into AsyncStorage every time it fetches
  (`recordTodaysRates`), keeping 730 days.
- `formatAmountOn(amount, date)` / `convertForDisplayOn(amount, date)` convert
  using the rate for that date.
- Missing days (weekends, holidays) fall back to the **most recent earlier**
  entry. Never forward — using a future rate to value a past expense is the
  restatement bug itself.
- Dates with no history at all fall back to the current rate, i.e. exactly the
  old behaviour. Nothing regresses; accuracy improves as history accrues.
- Totals sum per-row converted values rather than converting the total once,
  so a section header agrees with the rows beneath it.

### 4.3 Why the backend is needed anyway

**The client can only accumulate history from the day it is installed.** It has
no way to learn what the rate was before that.

The free endpoint in use (`open.er-api.com`) has **no historical API** —
verified, `GET /v6/2025-06-02/INR` returns 404. So for a new install, or any
device that has not been opened for a while, every older transaction still falls
back to today's rate. That is precisely the case the client asked to fix.

The backend can fix it for everyone at once, and only needs to do it once.

### 4.4 What to build

**A daily rate history, served to clients.**

```
GET /api/exchange-rates/history?from=2025-01-01&to=2026-07-31
```

```json
{
  "base": "INR",
  "rates": {
    "2026-07-30": { "USD": 0.0116, "EUR": 0.0107, "GBP": 0.0092,
                    "JPY": 1.78, "AUD": 0.0180, "CAD": 0.0163 },
    "2026-07-29": { "USD": 0.0117, "…": 0 }
  }
}
```

- **Base is always INR**, matching storage (§1).
- Keys are `YYYY-MM-DD`. Omit days with no data rather than sending nulls; the
  client already falls back to the most recent earlier day.
- Include all seven supported currencies per day.

**Implementation:**

1. **A daily job** that fetches and stores one row per day. Any provider with a
   historical endpoint works — exchangerate-api's paid tier, Open Exchange
   Rates, or the ECB reference feed (free, no key, but EUR-based so rates must
   be re-expressed against INR).
2. **A one-time backfill** of the past 2 years. This is the single highest-value
   piece of this whole section — it is the only way old transactions ever get an
   accurate rate, and it cannot be done client-side at all.
3. **Cache hard.** A past day's rate never changes, so it is immutable once
   written. Serve with a long `Cache-Control` and this endpoint costs almost
   nothing.

**Table sketch:**

```sql
CREATE TABLE exchange_rates (
  rate_date  DATE NOT NULL,
  currency   CHAR(3) NOT NULL,
  rate       NUMERIC(18,8) NOT NULL,   -- 1 INR = rate units of `currency`
  PRIMARY KEY (rate_date, currency)
);
```

`NUMERIC`, not float: JPY (~1.78) and USD (~0.0116) differ by two orders of
magnitude, and binary floats accumulate visible error when these are summed
across thousands of rows.

### 4.5 Rate direction — the one easy thing to get wrong

`rate` means **"1 INR = `rate` units of `currency`"**.

Most providers quote the inverse (1 USD = 86.2 INR). If the inverse is stored by
mistake, every converted amount is wrong by a factor of ~7,400 and it will not
look like a rounding problem. Sanity check after backfill: `USD` should be
around **0.011**, `JPY` around **1.8**. If USD comes out near 86, it is
inverted.

### 4.6 What NOT to do

- **Do not convert amounts server-side.** Send rates; the client converts. This
  keeps §1's invariant intact.
- **Do not store a rate on each transaction row.** The rate belongs to a date,
  not to a record. Per-row snapshots duplicate the same number thousands of
  times and drift when a provider corrects a day's figure.
- **Do not backfill missing days by interpolation.** Carry the last known rate
  forward, as the client does. An invented midpoint is a number that was never
  true on any market.
