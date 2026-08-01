# Upgraded Users Getting Locked Out — Root Causes, Fixes, and Backend Actions

**Date:** 2026-07-29
**Severity:** 🔴 Critical — users who upgrade are blocked from core features
**Frontend fixes:** ✅ Applied (this document explains them)
**Backend actions required:** §5 — one is a **launch blocker**

---

## 1. The reported problem

A user upgrades to Pro. Then:

- Adding a **voice reminder** → "you don't have a plan, please upgrade"
- Adding a **bill** → same
- **Scanning a bill** → blocked at 3 scans, the Free-tier limit
- Effectively the whole app is unusable despite being on the top plan

The user paid (or test-granted) and got **less** access than before.

---

## 2. Root causes — four separate bugs

All four are frontend. All four are now fixed. They are documented because two of
them have direct backend implications (§5).

### Bug 1 — 🔴 The store silently downgraded users to Free

**The core bug.** In `purchasePlan()`, after a successful RevenueCat purchase, the
plan was taken from the store's entitlements:

```js
const plan = RevenueCat.planFromCustomerInfo(customerInfo);
await setPlanLocally(plan, interval);   // ← could be "free"
```

`planFromCustomerInfo()` only recognises entitlements named exactly `starter`,
`family`, `pro` (matching the `PlanId` union). Anything else is ignored and it
returns `free`.

The RevenueCat dashboard has a **legacy entitlement named `Lifewise-app Pro`**
(created 2026-07-21, before the tier rework), still attached to legacy products
`monthly` / `yearly` / `lifetime`, all still present in the `default` offering.

So: purchase succeeds → entitlement granted as `Lifewise-app Pro` → not
recognised → **`free` written over the user's plan** → every gate blocks them.

The purchase *worked*. The app then told them they had nothing.

**Fix:** a successful purchase never writes `free`. If the store returns no
recognised entitlement, fall back to the plan the user actually requested and log
a loud dev warning naming the misconfiguration.

### Bug 2 — 🔴 Same downgrade on every app launch

`applyCustomerInfo()` runs on startup and on every `CustomerInfo` push. It had the
same flaw, so even a correctly-granted plan was overwritten with `free` seconds
after launch.

**Fix:** `free` from the store is now treated as **ambiguous** and ignored. It can
mean "genuinely lapsed" *or* "entitlement exists under an unrecognised name", and
the client cannot distinguish them. Downgrading on the wrong guess locks out a
paying customer, so the plan is left alone.

> ⚠️ **This is why §5.2 matters.** With the client no longer trusting `free`, a
> genuine lapse must be caught **server-side** via RevenueCat webhooks. Until the
> backend implements that, a cancelled subscription will retain access on-device.
> This is a deliberate trade: wrongly keeping access for a lapsed user is far less
> damaging than wrongly revoking a paying one.

### Bug 3 — 🟠 Startup race wiped the plan

`isTestMode` and the stored plan load from AsyncStorage **asynchronously**, but
the RevenueCat effect fired immediately on mount. At that instant the guard saw
`isTestMode === false`, so the store ran and overwrote the persisted plan before
it had even been read.

**Fix:** both `applyCustomerInfo()` and the store-init effect now wait for
`isLoading === false`.

### Bug 4 — 🟠 Usage counters survived the upgrade

Monthly meters (`billScanPerMonth`, `voiceReminderPerMonth`, `wiseAiPerMonth`, …)
are stored per device, per month. A user who spent their 3 free scans and then
upgraded **kept the count of 3**. On a plan with a real limit this still blocks
them — the exact "limit is 3, fix that" symptom.

**Fix, two parts:**
1. **Upgrades reset the month's meters.** Downgrades keep them.
2. **Unlimited plans no longer increment at all** — a counter that can never gate
   anything shouldn't climb, or a later downgrade instantly locks the user out on
   a month they barely used.

### Not a bug — cumulative limits

`reminders` and `familyMembers` count live rows, not stored meters. Verified: a
user with 12 reminders who upgrades to Pro is immediately allowed, because Pro's
limit is `Infinity`. These were only ever blocked as a *consequence* of Bugs 1–3
putting the user on Free.

---

## 3. Why this was hard to see

Every symptom pointed at the gates, but the gates were correct throughout. All
nine client gates were audited:

| Screen | Gate | Verdict |
|---|---|---|
| `app/scan-bill.tsx:113` | `billScanPerMonth` | ✅ correct |
| `app/voice-reminder.tsx:398` | `voiceReminderPerMonth` | ✅ correct |
| `app/edit-reminder.tsx:95` | `reminders` | ✅ correct |
| `app/family.tsx:147` | `familyMembers` | ✅ correct |
| `app/add-family-member.tsx:68` | `modulesPerMember` | ✅ correct |
| `app/edit-family-member.tsx:74` | `modulesPerMember` | ✅ correct |
| `app/family-documents/[memberId].tsx:39` | `documents` | ✅ correct |
| `app/assistant.tsx:128` | `wiseAiPerMonth` | ✅ correct |
| `app/(tabs)/reports.tsx:686` | `pdfReports` flag | ✅ correct |

Every one reads `currentPlan` from the subscription context. The gates faithfully
enforced Free limits — because the plan had been silently reset to Free upstream.

**The server was never involved.** `server/routes.ts` contains exactly one 403
(admin auth, line 157) and no plan checks anywhere. Nothing server-side blocked
these users.

---

## 4. Frontend changes applied

All in `lib/subscription-context.tsx`. `tsc` + `eslint` clean.

| # | Change | Fixes |
|---|---|---|
| 1 | Successful purchase never writes `free`; falls back to the requested plan + dev warning | Bug 1 |
| 2 | `applyCustomerInfo()` ignores `free` as ambiguous; warns on unrecognised entitlements | Bug 2 |
| 3 | Store waits for `isLoading === false` before touching plan state | Bug 3 |
| 4 | Upgrades clear the month's usage meters | Bug 4 |
| 5 | `incrementUsage()` no-ops on unlimited plans | Bug 4 |

Also fixed earlier the same day:
- Trial no longer overrides a **higher** owned plan (a Pro user in a Family trial
  was capped at Family — 100 WiseAI messages instead of 300, no medicine
  interaction)
- "Trial" badge and banner no longer shown to users who own something better

---

## 5. Backend actions required

### 5.1 🔴 LAUNCH BLOCKER — the dashboard misconfiguration

**This is not code. Someone must fix the RevenueCat dashboard.**

The `default` offering still contains three legacy packages (`$rc_monthly`,
`$rc_annual`, `$rc_lifetime`) pointing at legacy products (`monthly`, `yearly`,
`lifetime`) attached to a legacy entitlement **`Lifewise-app Pro`**.

**Required:**
1. Remove the three legacy packages from the `default` offering
2. Confirm every remaining package maps to an entitlement named exactly
   `starter`, `family`, or `pro` — **lowercase**
3. Either delete the `Lifewise-app Pro` entitlement or detach it from anything
   purchasable

Frontend change #1 stops this from locking users out, but it is a **safety net,
not a fix**. While the dashboard is wrong, purchases still grant the wrong
entitlement and the server will see inconsistent data once webhooks exist.

### 5.2 🔴 RevenueCat webhook consumer — now load-bearing

Previously "high priority". Frontend change #2 makes it **required**.

Because the client no longer trusts a `free` reading from the store, **only the
server can detect a genuine lapse**. Without webhooks, a cancelled or expired
subscription keeps working on-device indefinitely.

Handle at minimum:

| Event | Action |
|---|---|
| `INITIAL_PURCHASE` | Set `plan` from entitlement; `planSource: "store"` |
| `RENEWAL` | Update `planRenewsAt` |
| `CANCELLATION` | `planStatus: "cancelled"` — keep access until expiry |
| `EXPIRATION` | `plan: "free"`, `planStatus: "expired"` ← **the one that matters here** |
| `PRODUCT_CHANGE` | Update `plan` to the new tier |
| `BILLING_ISSUE` | Flag the account; do **not** revoke immediately (grace period) |

Verify the `Authorization` header against the dashboard shared secret — the
endpoint is public. `app_user_id` is the LifeWise `user.id`; the app already calls
`Purchases.logIn(user.id)` after auth.

**On unrecognised entitlements:** log and ignore. Do **not** guess a tier, and do
**not** downgrade to Free — that reintroduces Bug 1 server-side.

### 5.3 🟠 Move usage counters server-side

Meters are per-device. They reset on reinstall, don't sync across devices, and are
user-editable. Once §5.2 exists, move them to the server (`userId + yearMonth`)
and have the client read them from `GET /api/subscription/me`.

**When you do:** apply the same two rules as frontend change #4/#5 — reset the
month's meters on upgrade, and don't increment on unlimited plans. Otherwise
Bug 4 reappears server-side.

### 5.4 🟠 Confirm the plan-limit contract before enabling enforcement

When server-side enforcement is turned on, it must return:

```json
{ "error": "plan_limit", "limitKey": "billScanPerMonth", "recommendedPlan": "starter" }
```

with HTTP **403**.

> ⚠️ **Do not enable enforcement yet.** Only 1 of the 5 endpoints that will
> return this is currently wired on the client (`app/scan-bill.tsx`). The other
> four turn it into a generic error — and `app/voice-reminder.tsx` turns it into
> *"This needs a backend fix — please report it"*, which will generate false bug
> reports at your team. Frontend work item F1/F2 covers this; **coordinate before
> switching enforcement on.**

---

## 6. Testing checklist

After the next build:

- [ ] Activate Pro → all Pro perks available immediately
- [ ] **Force-close and reopen** → still Pro *(this is the critical one — Bugs 2 & 3)*
- [ ] Use 3 scans on Free → upgrade → scanning works *(Bug 4)*
- [ ] Voice reminder works on Pro
- [ ] Add a bill / reminder works on Pro
- [ ] Family members unlimited on Pro
- [ ] WiseAI shows 300/month on Pro, not 100
- [ ] Settings badge reads "Pro", not "Trial · Family"

Watch the dev console for:

```
[LifeWise/RevenueCat] Unrecognised entitlement(s) [...] — expected "starter"/"family"/"pro"
```

**That warning firing means §5.1 is still unfixed**, even though the app now works.

---

## 7. Summary

| | Status |
|---|---|
| App gates | ✅ Were always correct — never the cause |
| Server | ✅ Not involved — no plan checks exist |
| Plan persistence | ✅ Fixed (4 bugs) |
| RevenueCat dashboard | ❌ **Still misconfigured — §5.1** |
| Webhook consumer | ❌ **Now required — §5.2** |
| Server-side counters | ⬜ Future work — §5.3 |
| Server enforcement | ⚠️ **Do not enable yet — §5.4** |
