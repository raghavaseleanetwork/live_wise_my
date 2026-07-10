# Bug #10 — Money Leak Detection: Backend Fix Guide

**Audience:** Backend team
**Status:** Frontend part is already fixed. This document covers the two remaining backend-only issues.
**File to edit:** `server/routes.ts`
**Endpoint:** `GET /api/leaks`
**Route location:** `server/routes.ts`, lines **2385–2513**

---

## 1. Background — what this feature does

The "Money Leaks" screen in the app (`app/(tabs)/leaks.tsx`) shows the user a list of spending patterns that are quietly costing them money — e.g. ordering food too often, a subscription that got more expensive, a subscription they forgot to cancel.

All of the detection logic runs **server-side** in the `GET /api/leaks` route. The frontend does no calculation — it only displays whatever this endpoint returns. So every issue described below must be fixed on the server; there is nothing the frontend can do to work around them.

### How the endpoint currently works (read this before changing anything)

```
server/routes.ts:2385  app.get('/api/leaks', authMiddleware, async (req, res) => {
```

Step by step:

1. **Fetch data** (lines 2388–2395): loads the user's debit transactions (excluding a hardcoded list of categories — see Issue 1) and all their bill reminders.
2. **Group by merchant** (lines 2397–2412): builds a `merchantFreq` map — for each merchant name, counts how many times they were paid, total amount, and the list of individual amounts (newest first).
3. **Detection rule 1 — Frequency leaks** (lines 2418–2449): if a merchant was paid **3+ times**, it's flagged as a leak. Also checks if the latest payment is 15%+ higher than the previous one ("price hike").
4. **Detection rule 2 — Ghost subscriptions** (lines 2453–2477): if a bill is marked `reminderType: 'subscription'` but no matching transaction has occurred in 45+ days, it's flagged as "Inactive."
5. **Detection rule 3 — Duplicate/double charge** (lines 2481–2507): if the same merchant was charged the identical amount twice within 24 hours, flags a possible double-charge.
6. Leaks are sorted by `monthlyEstimate` descending and returned as JSON.

The frontend (`app/(tabs)/leaks.tsx`) renders each of these as a `LeakCard`, sums `monthlyEstimate` across all leaks for the "Potential Savings" hero number, and multiplies by 12 for "yearly savings."

---

## 2. Issue 1 (main bug) — Important payments are wrongly flagged as leaks

### What's wrong

Product requirement: **"Important payments and investments should NOT be counted as leaks. Only unnecessary or extra spending should be considered."**

The current exclusion list only filters out 4 categories:

```ts
// server/routes.ts:2389-2393
transactions.find({
  userId,
  isDebit: true,
  category: { $nin: ['investment', 'tax', 'rent', 'savings'] }
}).sort({ date: -1 }).toArray(),
```

This means any transaction NOT in `['investment', 'tax', 'rent', 'savings']` is fair game for leak detection — **including essential, non-discretionary spending** such as:

- **Electricity/water/gas bills** (category `bills`) — the same provider is paid every month, so it will almost always hit the "3+ times = leak" rule and get flagged.
- **Medical/health payments** (category `health`) — e.g. a monthly pharmacy or clinic payment.
- **Insurance premiums** — currently has no dedicated category in the schema (see Issue 1b below), so it likely falls under `finance` or `others` and is not excluded.
- **Education / school fees** (category `education`).
- **Loan EMIs** — same as insurance, no dedicated category exists yet.

**Real-world failure example:** a user pays their electricity bill (category `bills`) every month via the same merchant. After 3 months, `merchantFreq['ElectricityBoard'].count >= 3` is true, so the app tells them: *"You keep paying this merchant — save up to ₹X/year by cutting back."* This is actively wrong and undermines trust in the feature — you cannot "cut back" on electricity.

### Where the category list comes from

`CategoryType` is defined identically in two places (keep them in sync if you touch this):

```ts
// server/routes.ts:56
// lib/data.ts:3 (frontend, for reference only — do not edit this one)
type CategoryType =
  'health' | 'bills' | 'family' | 'work' | 'tasks' | 'subscriptions' |
  'finance' | 'habits' | 'travel' | 'events' | 'food' | 'shopping' |
  'transport' | 'entertainment' | 'education' | 'investment' | 'others';
```

### The fix

**Step A — Widen the exclusion list.** Change line 2392 from:

```ts
category: { $nin: ['investment', 'tax', 'rent', 'savings'] }
```

to something like:

```ts
category: { $nin: ['investment', 'tax', 'rent', 'savings', 'bills', 'health', 'education', 'finance'] }
```

Recommended exclusion set (discuss with product before finalizing, since some of these categories may contain a *mix* of essential and discretionary spend):

| Category to exclude | Reasoning |
|---|---|
| `investment` | Already excluded — wealth-building, not a leak |
| `tax` | Already excluded — legally required |
| `rent` | Already excluded — essential housing cost |
| `savings` | Already excluded — user is saving, not wasting |
| `bills` | Utilities (electricity/water/gas) are necessary and recurring by nature — recurrence alone shouldn't flag them |
| `health` | Medical spending should never be discouraged |
| `education` | School/course fees are not discretionary |
| `finance` | Likely contains EMI/loan repayments — needs review of what's actually stored here (see Issue 1b) |

**Do NOT exclude** `subscriptions`, `entertainment`, `shopping`, `food`, `travel` — these are exactly the categories the feature is designed to catch (Netflix, Swiggy, impulse shopping, etc.).

**Step B — Also filter bill-based ghost-subscription detection (lines 2453–2477).** This loop already only looks at `bill.reminderType === 'subscription'`, which is good — but double check no `bills`-category items slip in through this path too. If `reminderType` can be `'bill'` for a subscription-like recurring utility, make sure the exclusion still holds.

**Step C (recommended, needs product input) — Add dedicated categories for Insurance and Loan/EMI.** Right now there's no `insurance` or `loan`/`emi` category in `CategoryType`. If the product team wants those explicitly excluded (per the requirement "important payments... should not be counted"), you'll need to:
1. Add `'insurance'` and `'loan'` (or similar) to the `CategoryType` union in **both** `server/routes.ts:56` and `lib/data.ts:3` (frontend — coordinate this change, don't edit `lib/data.ts` unilaterally).
2. Add them to the `$nin` exclusion list above.
3. Confirm with product/frontend how these categories get assigned to transactions (manual selection? bill-scan auto-detection?) — this may be a separate small feature, flag it if scope is unclear.

---

## 3. Issue 2 — `monthlyEstimate` is not actually a monthly figure (math bug)

### What's wrong

Line 2422:

```ts
const monthlyEstimate = Math.round(data.total / (data.count > 30 ? 1 : 1)); // Simplified for now
```

Look closely: **both branches of the ternary divide by `1`.** This is leftover placeholder code (note the developer's own comment: `// Simplified for now`) that was never finished. The result is:

```
monthlyEstimate = Math.round(data.total)
```

i.e. it's just the **sum of every transaction ever made at that merchant**, not a per-month average. This directly feeds:
- The `leakAmount` shown on each card ("₹X per month" — [leaks.tsx](../app/(tabs)/leaks.tsx) `LeakCard` component, label "per month").
- The `yearlyPrediction` (`monthlyEstimate * 12` at line 2444) — which compounds the error by 12x.
- The "Potential Savings" hero number and "yearly savings" figure on the main leaks screen (sums `monthlyEstimate` across all leaks).

**Real-world failure example:** a user has been using the app for 6 months and ordered food from the same restaurant 20 times totaling ₹6,000 (~₹1,000/month average). The current code reports `monthlyEstimate = ₹6,000` — 6x too high — and then `yearlyPrediction = ₹72,000`, an absurd and alarming number that erodes user trust.

### The fix

You need the actual **time span** the transactions cover, then divide total spend by the number of months in that span (minimum 1 month to avoid division by zero or inflated numbers for brand-new data).

Suggested approach — track the earliest and latest transaction date per merchant while building `merchantFreq` (around lines 2398–2412), then compute a true monthly average:

```ts
// When building merchantFreq (lines 2397-2412), also track the earliest date:
const merchantFreq: Record<string, {
  count: number; total: number; category: CategoryType;
  amounts: number[]; lastDate: Date; firstDate: Date;
}> = {};

txList.forEach((t: any) => {
  const merchant = String(t.merchant || 'Unknown');
  const txDate = new Date(t.date);
  if (!merchantFreq[merchant]) {
    merchantFreq[merchant] = {
      count: 0, total: 0,
      category: (t.category as CategoryType) || 'others',
      amounts: [], lastDate: txDate, firstDate: txDate,
    };
  }
  merchantFreq[merchant].count++;
  merchantFreq[merchant].total += t.amount;
  merchantFreq[merchant].amounts.push(t.amount);
  if (txDate > merchantFreq[merchant].lastDate) merchantFreq[merchant].lastDate = txDate;
  if (txDate < merchantFreq[merchant].firstDate) merchantFreq[merchant].firstDate = txDate;
});
```

Then, where `monthlyEstimate` is calculated (line 2422):

```ts
const spanDays = Math.max(1, (data.lastDate.getTime() - data.firstDate.getTime()) / (1000 * 60 * 60 * 24));
const spanMonths = Math.max(1, spanDays / 30);
const monthlyEstimate = Math.round(data.total / spanMonths);
```

This gives a real "amount per month" based on how long the pattern has actually been observed, instead of the raw lifetime total.

**Note:** `data.count > 30` in the original dead code hints the original author may have intended "if there are more than 30 transactions, assume ~1/day and divide differently." That assumption is fragile (it conflates "many transactions" with "long time span," which aren't the same thing). The date-span approach above is more correct and doesn't need that special case — recommend replacing it entirely rather than patching the `? 1 : 1`.

---

## 4. Summary checklist for the backend team

- [ ] **Issue 1:** Widen the `$nin` category exclusion list at `server/routes.ts:2392` to include `bills`, `health`, `education`, `finance` (confirm `finance` scope with product first — see table above).
- [ ] **Issue 1 (optional/needs product sign-off):** Add `insurance` / `loan` categories to `CategoryType` in both `server/routes.ts:56` and `lib/data.ts:3` if the product team wants those explicitly separated out; coordinate with frontend before changing the shared type.
- [ ] **Issue 2:** Replace the broken `monthlyEstimate` calculation at `server/routes.ts:2422` with a real date-span-based monthly average (sample code above). Also track `firstDate` per merchant while building `merchantFreq` (lines 2397–2412).
- [ ] After fixing, sanity-check `yearlyPrediction` (`monthlyEstimate * 12`, line 2444) and the ghost-subscription leak (line 2470, uses `bill.amount` directly — that one is already correct and does not need changes).
- [ ] Test with a demo account that has: (a) a recurring bill payment (should NOT appear as a leak after the fix), (b) a food-delivery merchant paid 5+ times over 2 months (should appear, with a monthly estimate close to total/2), (c) a subscription with no recent activity (ghost-subscription leak, unaffected by this fix).

## 5. How to verify the fix (for QA / backend team, no frontend changes needed)

1. Call `GET /api/leaks` with a valid auth token for a test user that has a `bills`-category transaction paid 3+ times.
   - **Before fix:** appears in the response as a leak.
   - **After fix:** does not appear.
2. Check `monthlyEstimate` on a merchant with transactions spread across 2+ months — it should be roughly `total ÷ number of months`, not the raw `total`.
3. The frontend "How It Works" card (already updated, no action needed) tells users bills/health/education/insurance/EMIs/investments are never counted — the backend behavior must now match what that text promises.

---

**Questions?** Ping the frontend/product owner of this feature before changing the shared `CategoryType` union, since it's duplicated in `lib/data.ts` and any mismatch between frontend and backend category strings will silently break category filtering across the whole app (not just leaks).
</content>
