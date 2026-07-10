# Request: Seed test data for QA account

**From:** Raghav (frontend/QA testing)
**Priority:** Needed to test the recent frontend bug fixes on branch `aselea-frontend-fixers`
**Account to seed:** `raghav@gmail.com`

> **Note on credentials:** intentionally not including the account password here. You don't need it — you can insert data directly into the database for this user's ID/email, or add a temporary debug-only seed route. Please don't ask for the password over chat; if a login is genuinely required for some reason, we'll rotate/reset it after testing instead.

---

## Why I need this

I'm testing a batch of frontend bug fixes (purple gradient removal, popup cancel-button fixes, Money Leaks screen, recurrence picker, drop-shadow removal, etc.) and my account currently has **no transactions, bills, or reminders** — so most screens render empty and I can't visually confirm the fixes actually work.

I need enough realistic data seeded into my account to exercise: Home dashboard stats, Reports, Transactions list, Money Leaks detection, and Reminders/Bills.

---

## What to seed

### 1. Transactions (for Home / Reports / Transactions tab / Money Leaks)

Please insert transactions into the `transactions` collection for my user, spread across **this month and last month** (so I can test the "fallback to last month" logic on Home too). Use `POST /api/transactions` (needs my auth token) or insert directly into MongoDB with `userId` set to my account's `_id`.

Suggested mix — aim for realistic Money Leak patterns (some merchants repeated 3+ times):

| Merchant | Category | Amount (₹) | Frequency | Notes |
|---|---|---|---|---|
| Swiggy | `food` | 300–450 | 6–8 times this month, spread across dates | Should trigger a leak (frequent) |
| Zomato | `food` | 250–400 | 3–4 times | Should trigger a leak |
| Netflix | `subscriptions` | 649 | Once/month for 2 months | Tests recurring subscription detection |
| Uber | `travel` | 150–300 | 5+ times | Should trigger a leak |
| Electricity Board | `bills` | 1200–1800 | Once/month for 2 months | **Must NOT appear as a leak** (this is the exact case Bug #10's fix targets) |
| Apollo Pharmacy | `health` | 500–1500 | 2–3 times | **Must NOT appear as a leak** |
| School Fees / Course | `education` | 5000+ | Once | **Must NOT appear as a leak** |
| Salary Credit | `finance`, `isDebit: false` | 60,000–90,000 | Once/month | Income, for Reports income/expense view |
| A few random one-off purchases | `shopping`, `entertainment`, `others` | Various | 1x each | Should NOT count as leaks (only 1 occurrence) |

Please spread dates so:
- Some transactions fall in **the current month** (today's date).
- Some fall in **last month only** (to test the Home screen's "no data this month → show last month" fallback — this needs at least one scenario where **this month has zero or very few transactions** and last month has several).
- At least one transaction dated **today** (to test "Today's Spending").

### 2. Bills / Reminders (for Bills tab, Edit Reminder, Overdue Alerts)

Please add 4–5 entries to the `bills` collection for my user:
- 1 **overdue** bill (due date in the past, `status: 'active'`, `isPaid: false`) — to test the overdue alert + snooze/cancel behavior.
- 1 **upcoming** bill (due date a few days from now).
- 1 **subscription-type** bill (`reminderType: 'subscription'`) with **no matching transaction in 45+ days** — to test the "ghost subscription" leak detection.
- 1–2 bills with `repeatType: 'weekly'` and `repeatType: 'monthly'` — to test the recurrence picker fix.

### 3. (Optional, nice to have) Family member

One entry in the `family` collection linked to my account, so I can also glance at the Family tab while it's here — not a blocker for this round of testing.

---

## How to deliver

Either works:
- **Direct DB insert** (fastest) — insert into `transactions` and `bills` collections with `userId` = my account's ObjectId.
- **Script against the API** — a small script that logs in as me (you'd need my password for this route only — if you go this way, ask me directly and I'll rotate the password after) and calls `POST /api/transactions` / `POST /api/bills` in a loop with the data above.

**Please confirm once done** so I know it's safe to start testing, and let me know roughly how many records you added in case something looks off.

---

## Cleanup

This is test data — please flag it clearly (e.g. `source: 'qa-seed'` on each doc, similar to the existing `source: 'demo-seed'` pattern already used in `server/routes.ts`) so it can be identified and removed later without affecting real data.
</content>
