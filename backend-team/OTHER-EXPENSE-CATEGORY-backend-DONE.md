# "Other Expense" Category — Backend Done

**Audience:** Frontend team
**Received from backend team:** 2026-08-15
**Status:** ✅ All backend work from `OTHER-EXPENSE-CATEGORY-backend-requirements.md` is implemented, typechecked, and verified live against a local instance connected to the shared MongoDB. Pushed to `origin/main` at commit `7dc6f7a`.
**Files changed (backend):** `server/routes.ts`, `server/categorization-utils.ts`
**One addition beyond the original doc:** a `PATCH /api/transactions/:id` route now exists (see §3) — this was flagged as an open question in the original doc and has been built, since without it `other_expense` only covers manually-entered expenses, not the P2P-transfer-via-SMS case the client actually described.

> ### ✅ Frontend verification on receipt (2026-08-15)
>
> Unlike the payment-history doc received the same day, **every claim in this
> one checks out against `aselea-frontend-fixers`**. Verified:
>
> - `other_expense` present in `CategoryType` (`lib/data.ts:3`) and
>   `CATEGORIES` (`lib/data.ts:122`, label "Other Expense", `swap-horizontal`)
> - `LEAK_EXEMPT_CATEGORIES = ['investment', 'other_expense']` (`lib/data.ts:14`)
> - Wired into the Activity filter row (`app/(tabs)/transactions.tsx:47`),
>   Add Expense (`app/add-expense.tsx:53`), and statement import
>   (`app/import-statement.tsx:106`)
> - The defensive client-side leak filter §2 refers to is at
>   `lib/expense-context.tsx:212`
> - No caller for `PATCH /api/transactions/:id` exists yet — §3 is genuinely
>   new frontend surface
>
> Two follow-ups this creates for us, both optional — see §6.

---

## 1. What's live now

| # | Requirement | Result |
|---|---|---|
| 1 | `other_expense` added to `CategoryType` in both `server/routes.ts` and `server/categorization-utils.ts` | ✅ Exact string, lowercase snake_case, as required |
| 2 | `other_expense` excluded from `GET /api/leaks` (the core fix — main frequency/price-hike/duplicate rules) | ✅ Verified: 5 repeated `other_expense` transactions to the same merchant produced **zero** leak entries |
| 3 | `other_expense` excluded from the ghost-subscription rule (reads `bill.category`, not transaction category) | ✅ Verified: a subscription-type bill tagged `other_expense` with a stale matching transaction did **not** get flagged, while an identical non-exempt bill did |
| 4 | `other_expense` excluded from the AI assistant's leaks snapshot | ✅ Verified on `GET /api/assistant/context`; the same fix was also applied to `POST /api/assistant/chat`, which has its own separate (and previously unfiltered) leaks snapshot — not named in the original doc, but the identical bug, so fixed at the same time |
| 5 | AI prompt updated so the model can pick `other_expense` for P2P transfers | ✅ |
| 6 | Re-categorizer (`updateExistingOthers`) never touches `other_expense` | ✅ Confirmed — it already only ever queried `category: 'others'`, and now also checks a `categoryLockedByUser` flag (see §3) as a second, explicit guard |
| 7 | Category validated against a whitelist on write | ✅ Applied to `POST /api/transactions`, `POST /api/transactions/bulk` (statement/CSV import), and `POST /api/transactions/sync-from-sms`. An unrecognized category string is stored as `others`, never persisted verbatim |

**The proof test** (mixed-category merchant — 3 `food` + 2 `other_expense` transactions to the same merchant name): the merchant still appears as a leak, but `monthlyEstimate` reflects only the 3 `food` transactions, confirming the exclusion happens at the database query, not a post-hoc filter on the response.

> That mixed-merchant test is the one the client-side filter could never have
> fixed — a merchant-level filter can only drop a whole leak row, not correct an
> inflated `monthlyEstimate` inside one. Good catch to test it explicitly.

---

## 2. You can remove the defensive client-side filter

`lib/expense-context.tsx`'s client-side filter that drops leak-exempt categories from the `/api/leaks` response was a stopgap for exactly the gaps this backend work closes (mixed-merchant `monthlyEstimate` inflation, the ghost-subscription rule, the AI snapshot). The server now returns already-correct data on all of those paths, so the filter is redundant. Not required to remove it — a no-op filter over correct data is still correct — but it's safe to remove if you want to simplify.

> **Frontend note:** the filter's own code comment already says "Remove once the
> server-side exclusion is confirmed deployed" — this doc is that confirmation.
> **Recommendation: keep it anyway, for now.** It costs one array pass and it is
> the only thing protecting the user-facing promise if an older server build is
> ever rolled back to, which has happened on this project before (see CLAUDE.md
> on the 2026-07-29 RevenueCat revert). Revisit once the backend is stable in
> production for a release or two.

---

## 3. New: `PATCH /api/transactions/:id`

The original doc's §5 flagged a real gap: most `other_expense` candidates (P2P UPI transfers) arrive via SMS sync and are never shown a category picker, so there was no way to mark one as `other_expense` after the fact. This route closes that gap.

```
PATCH /api/transactions/:id
Auth: required (Bearer token)
Body: { "category": "other_expense" }

200 → the updated transaction, e.g.:
{
  "id": "...", "merchant": "...", "amount": 5000, "category": "other_expense",
  "categoryLockedByUser": true, "updatedAt": "2026-08-15T08:06:25.008Z", ...
}
400 → { "message": "category is required" }         (category missing from body)
400 → { "message": "Invalid category" }              (category not in the whitelist)
404 → { "message": "Not found" }                      (id doesn't exist, or isn't owned by the requester)
```

Every successful `PATCH` also sets `categoryLockedByUser: true` on the document. You don't need to read or send this field — it's an internal guard so the AI re-categorizer will never overwrite a category a user explicitly chose, even if that logic changes shape later. All verified: valid update, invalid category, and not-found/not-owned were each tested and return the codes above.

**Suggested frontend use:** a "change category" action on a transaction row (e.g. long-press or a menu item), most useful on SMS-synced rows that were auto-categorized as `others` or something incorrect. Not required for this feature to ship — the category-at-creation-time flow (Add Expense) already works end-to-end — but without this route, users still can't fix the exact case the client described in their original request.

> **Frontend note:** confirmed no caller exists yet. This is the one piece of
> real remaining frontend work from this doc — see §6. The
> `categoryLockedByUser` design is a good call: it means we can build the
> picker without worrying that the nightly re-categorizer will silently undo a
> user's choice.

---

## 4. Open product question — not decided, still yours to make

The original doc's §6 raised a real question: today, `other_expense` only excludes a transaction from **Leaks**. It still counts toward **Total Spent** and the **monthly budget**, same as any other category. A ₹10,000 self-transfer or loan repayment tagged `other_expense` will still inflate both of those numbers.

This was intentionally **not** built in this pass — it's a bigger change (touches reports and budget aggregation, not just leaks) and the original doc recommended shipping the leaks fix first and deciding on this separately. If the client also wants Other Expense excluded from spend/budget totals, that's a follow-up, likely via a separate `isTransfer`/`excludeFromSpending` flag rather than overloading the category field further (a category and a "does this count as spending" flag are different concepts). Let us know if/when this should be scheduled.

> **Frontend note — this needs a client decision, and it's the more important
> open item than anything in §6.** The scenario is easy to hit: a user
> self-transfers ₹10,000, tags it Other Expense, and their "Total Spent" still
> reads ₹10,000 higher while Leaks correctly ignores it. That inconsistency is
> arguably more confusing than the original bug. Worth putting to the client as
> a direct question: *"should Other Expense also be excluded from Total Spent
> and your monthly budget, or only from Leaks?"* Agreed on the backend team's
> design instinct — a separate `excludeFromSpending` flag, not more category
> overloading.

---

## 5. No frontend changes required to pick this up

Everything above matches the contract the frontend already shipped and merged on `aselea-frontend-fixers` — same category string, same `CATEGORIES` map keys, same response shapes. `GET /api/leaks` output for users with no `other_expense` data is unchanged (verified byte-for-byte equivalent behavior on a clean test account). Old app builds that don't know about `other_expense` will keep rendering it as "Others" with a grey icon, as designed — no crash risk.

---

## 6. Remaining frontend work (optional, 2026-08-15)

Nothing here blocks the feature — it already works end-to-end for
manually-entered expenses. These are the two things that would make it cover
the full case the client described:

| # | Item | Priority |
|---|---|---|
| 1 | **Build the "change category" action on a transaction row**, calling `PATCH /api/transactions/:id`. Without it, SMS-synced P2P transfers — the client's actual complaint — still can't be re-tagged. | **Recommended** — this is the gap that matters |
| 2 | Remove the defensive leak filter at `lib/expense-context.tsx:212` | Low — see §2; recommendation is to keep it for now |
| 3 | Answer the §4 product question with the client | **Ask before it becomes a bug report** |

---

## 7. Related documents

- `OTHER-EXPENSE-CATEGORY-backend-requirements.md` — the original request this answers.
- `lib/data.ts` — `CategoryType`, `LEAK_EXEMPT_CATEGORIES`, and the `CATEGORIES` display map that must stay in sync with the server whitelist.
