  # "Other Expense" Category — Backend Requirements

  **Audience:** Backend team
  **Feature:** Add an `other_expense` category that is excluded from Leaks Analysis
  **Source:** Client request — "Add 'Other Expense' Category (Leaks Logic)", discussed in project meeting
  **Status:** ✅ Frontend is **done and merged**. ❌ Backend work below is **not started** and is required for the feature to actually work.
  **Files to edit:** `server/routes.ts`, `server/categorization-utils.ts`
  **Date:** 2026-08-15

  ---

  ## 1. What the client asked for

  > Add a new expense category: **Other Expense**.
  > If the user transfers money to another person or records an expense that should not be considered a financial leak, it should be categorized as Other Expense.
  > **Ensure these transactions are excluded from Leaks Analysis.**

  In plain terms: users need an escape hatch. Sending ₹5,000 to a friend, repaying a family member, or moving money between their own accounts is not "wasteful spending," but today the leak detector sees a repeated debit to the same payee and flags it. The user needs a way to say *"this one is not a leak"* and have the system respect it permanently.

  ---

  ## 2. Why this cannot be fixed on the frontend alone

  **Leak detection runs entirely server-side.** The app performs no leak calculation — it calls `GET /api/leaks` and renders whatever comes back.

  ```
  lib/expense-context.tsx:183   fetchWithAuth(token, '/api/leaks')
  app/(tabs)/leaks.tsx:71       const { leaks, isLoading } = useExpenses();
  ```

  The exclusion rule that decides what is eligible to be a leak is a **MongoDB query filter on the server**:

  ```ts
  // server/routes.ts:2441
  category: { $nin: ['investment', 'tax', 'rent', 'savings'] }
  ```

  Until `other_expense` is added to that list, transactions tagged as Other Expense will keep appearing in Leaks Analysis regardless of what the app does.

  ---

  ## 3. What the frontend has already shipped

  These changes are live on branch `aselea-frontend-fixers`. The backend work must line up with them exactly.

  | File | Change |
  |---|---|
  | [lib/data.ts:3](../lib/data.ts#L3) | Added `'other_expense'` to the `CategoryType` union |
  | [lib/data.ts](../lib/data.ts) | Added `LEAK_EXEMPT_CATEGORIES` + `isLeakExempt()` helper |
  | [lib/data.ts](../lib/data.ts) | Added `other_expense` to `CATEGORIES` map — label "Other Expense", color `#0EA5E9`, icon `swap-horizontal` |
  | [app/add-expense.tsx](../app/add-expense.tsx) | Added `other_expense` to the category chip row + an explanatory hint shown when it is selected |
  | [app/(tabs)/transactions.tsx](../app/(tabs)/transactions.tsx) | Added an "Other Expense" filter chip |
  | [app/import-statement.tsx](../app/import-statement.tsx) | Added `other_expense` to the categories offered when correcting an imported row |
  | [lib/expense-context.tsx](../lib/expense-context.tsx) | **Defensive client-side filter** — drops leak-exempt categories from the `/api/leaks` response |
  | `locales/*.json` (all 7) | New keys: `addExpense.categoryOtherExpense`, `addExpense.otherExpenseHint`, `transactions.filterOtherExpense`; updated `leaks.neverCountedText` |

  ### ⚠️ About the defensive client-side filter

  The frontend now filters leak-exempt categories out of the `/api/leaks` response as a safety net, so the user-facing promise holds even before the backend ships.

  **This is a stopgap, not the fix.** It only removes leaks whose top-level `category` field is `other_expense`. It does **not** help when:

  - a leak is grouped under a merchant whose transactions are *mixed* (some `other_expense`, some not) — the server has already blended the amounts together, and the `monthlyEstimate` returned is inflated by money that should never have been counted;
  - the leak came from the **ghost subscription** rule (rule 2), which reads `bill.category`, not the transaction category;
  - the "Potential Savings" hero number was computed from those inflated amounts.

  Only the server-side exclusion produces correct numbers. Please do not treat the client filter as "already handled."

  ---

  ## 4. Required backend changes

  ### 4.1 Add `other_expense` to the `CategoryType` union — **2 files**

  The server declares its own copy of the type in two places. Both must be updated or TypeScript will reject the new value.

  **File: `server/routes.ts`, line 56**

  ```ts
  // BEFORE
  type CategoryType = 'health' | 'bills' | 'family' | 'work' | 'tasks' | 'subscriptions' | 'finance' | 'habits' | 'travel' | 'events' | 'food' | 'shopping' | 'transport' | 'entertainment' | 'education' | 'investment' | 'others';

  // AFTER
  type CategoryType = 'health' | 'bills' | 'family' | 'work' | 'tasks' | 'subscriptions' | 'finance' | 'habits' | 'travel' | 'events' | 'food' | 'shopping' | 'transport' | 'entertainment' | 'education' | 'investment' | 'other_expense' | 'others';
  ```

  **File: `server/categorization-utils.ts`, line 4** — identical change.

  > **Naming is not negotiable.** The value must be exactly `other_expense` — lowercase, snake_case. The frontend `CategoryType` union, the `CATEGORIES` lookup map, the icon component, and the filter chips all key off this exact string. `otherExpense`, `Other Expense`, `other-expense`, or `OTHER_EXPENSE` will all render as an unstyled fallback ("Others", grey icon) in the app.

  ---

  ### 4.2 Exclude `other_expense` from `GET /api/leaks` — **the core fix**

  **File: `server/routes.ts`, line 2441**

  ```ts
  // BEFORE
  const [txList, billList] = await Promise.all([
    transactions.find({
      userId,
      isDebit: true,
      category: { $nin: ['investment', 'tax', 'rent', 'savings'] }
    }).sort({ date: -1 }).toArray(),
    bills.find({ userId }).toArray()
  ]);

  // AFTER
  const LEAK_EXEMPT_CATEGORIES = ['investment', 'tax', 'rent', 'savings', 'other_expense'];

  const [txList, billList] = await Promise.all([
    transactions.find({
      userId,
      isDebit: true,
      category: { $nin: LEAK_EXEMPT_CATEGORIES }
    }).sort({ date: -1 }).toArray(),
    bills.find({ userId }).toArray()
  ]);
  ```

  Pulling the list into a named constant matters because it is needed again in 4.3 and 4.4, and because Bug #10 (see `BUG-10-money-leak-detection.md`) proposes extending this same list. Keeping one constant prevents the three copies from drifting apart.

  **Why filtering at the query is correct and sufficient for rules 1 and 3:** excluded transactions never enter `txList`, so they never enter the `merchantFreq` map (lines 2446–2461), so they cannot contribute to the frequency-leak rule, the price-hike check, or the duplicate-charge rule, and they cannot inflate `monthlyEstimate`. This is the single highest-value line in this document.

  ---

  ### 4.3 Exclude `other_expense` from the ghost-subscription rule

  **File: `server/routes.ts`, lines 2502–2527**

  Rule 2 iterates over **bills**, not transactions, and reads `bill.category`. The query filter in 4.2 does not touch it — a bill reminder categorized as `other_expense` would still be flagged as an "Inactive" subscription leak.

  ```ts
  // BEFORE
  billList.forEach((bill: any) => {
    if (bill.reminderType === 'subscription' && bill.status !== 'cancelled') {

  // AFTER
  billList.forEach((bill: any) => {
    if (LEAK_EXEMPT_CATEGORIES.includes(bill.category)) return;
    if (bill.reminderType === 'subscription' && bill.status !== 'cancelled') {
  ```

  ---

  ### 4.4 Exclude `other_expense` from the AI assistant's leaks snapshot

  **File: `server/routes.ts`, lines 2619–2643**

  The AI assistant endpoint builds its **own** leak summary with a separate query that has *no* category filter at all. Without this fix the assistant will still tell the user "you're spending a lot at [friend's name]" even though the Leaks screen correctly hides it — an inconsistency users will notice and report as a bug.

  ```ts
  // BEFORE
  const leakList = await transactions
    .find({ userId: (req as any).userId, isDebit: true })
    .toArray();

  // AFTER
  const leakList = await transactions
    .find({
      userId: (req as any).userId,
      isDebit: true,
      category: { $nin: LEAK_EXEMPT_CATEGORIES }
    })
    .toArray();
  ```

  > Note: this query currently excludes *nothing* — not even `investment`, `tax`, `rent`, or `savings`, which the main endpoint does exclude. Adding the shared constant here fixes that pre-existing inconsistency at the same time.

  ---

  ### 4.5 Protect `other_expense` from AI re-categorization

  **File: `server/categorization-utils.ts`**

  Two things to do here.

  **(a) Add the category to the AI prompt** so the model can pick it for obvious person-to-person transfers (line 16):

  ```ts
  const prompt = `Categorize these Indian financial transactions: health, bills, family, work, tasks, subscriptions, finance, habits, travel, events, food, shopping, transport, entertainment, education, investment, other_expense, others.
    ...
    Rules:
    ...
    - 'other_expense' for person-to-person UPI transfers, money sent to an
      individual (not a business/merchant), self-transfers between the user's own
      accounts, lending or repaying money to a person.
    - 'others' only if absolutely unclear.`;
  ```

  **(b) Verify the background re-categorizer does not overwrite user choices.**

  Good news — `updateExistingOthers()` at line 71 already scopes itself correctly:

  ```ts
  const others = await db.collection('transactions').find({
    userId,
    category: 'others'      // ← only touches 'others', never 'other_expense'
  }).toArray();
  ```

  Because it queries for the literal string `'others'`, a transaction the user manually tagged `other_expense` will **not** be picked up and rewritten. **Please do not "helpfully" broaden this query** (e.g. to a regex, or to `$in: ['others', 'other_expense']`) — that would silently undo the user's explicit decision and reintroduce the exact bug this feature exists to fix.

  This is the single most important invariant in the whole feature: **once a user tags a transaction `other_expense`, nothing automated may ever change it.** The same rule applies to the AI trigger route `POST /api/transactions/categorize-others`.

  ---

  ### 4.6 Validate the category on write (recommended)

  **File: `server/routes.ts`, lines 1475–1500** — `POST /api/transactions`

  The category is currently written straight through with no whitelist check:

  ```ts
  // server/routes.ts:1485
  category: (category as CategoryType) || 'others',
  ```

  The `as CategoryType` cast is a compile-time lie — at runtime any string a client sends is persisted verbatim. A typo like `other-expense` would be stored and would then be invisible to the `$nin` exclusion, silently reappearing as a leak.

  Suggested hardening:

  ```ts
  const VALID_CATEGORIES = [
    'health', 'bills', 'family', 'work', 'tasks', 'subscriptions', 'finance',
    'habits', 'travel', 'events', 'food', 'shopping', 'transport',
    'entertainment', 'education', 'investment', 'other_expense', 'others',
  ];

  const rawCategory = String(category || '').toLowerCase();
  const safeCategory = VALID_CATEGORIES.includes(rawCategory)
    ? (rawCategory as CategoryType)
    : 'others';
  // ...
  category: safeCategory,
  ```

  Apply the same normalization to the SMS sync route (`POST /api/transactions/sync-from-sms`, line 1503) and the statement-import route.

  ---

  ## 5. Gap that blocks the client's main use case

  **There is currently no way to change a transaction's category after it is created.** There is no `PATCH /api/transactions/:id` route on the server, and no edit-category UI in the app.

  This matters because the client's example is *"if the user transfers money to another person."* Most such transfers arrive automatically via **SMS sync** and get auto-categorized — the user never sees a category picker for them. So the flow the client actually described is:

  1. User sends ₹5,000 to a friend over UPI.
  2. The bank SMS is parsed and synced; it lands as `others` (or gets AI-labelled `family`/`finance`).
  3. It repeats a few times → **it shows up as a money leak.**
  4. User wants to mark it "Other Expense" → **currently impossible.**

  Only manually-added expenses (via Add Expense) can be tagged at creation time. Those are the minority.

  **Recommendation:** add an update route so the app can ship a "change category" action on a transaction row.

  ```
  PATCH /api/transactions/:id
  Auth: required (must verify the transaction belongs to req.userId)
  Body: { "category": "other_expense" }
  Response 200: the updated transaction object
  Response 400: invalid category (not in VALID_CATEGORIES)
  Response 404: not found, or not owned by this user
  ```

  Implementation notes:
  - Validate `category` against `VALID_CATEGORIES` (§4.6).
  - Scope the update by `{ _id, userId }` so one user cannot edit another's row.
  - Consider setting a `categoryLockedByUser: true` flag on manual edits, and having the AI re-categorizer skip any document with that flag. This makes the §4.5 invariant explicit in data rather than relying on the query happening to be narrow.

  Please confirm whether this is in scope. **Without it, the feature only covers manually-entered expenses** and the client's stated use case (P2P transfers, which arrive via SMS) remains unsolved.

  ---

  ## 6. Open product question — is a category the right mechanism?

  Worth raising before this is built, because it changes the data model.

  A category and a "not a leak" flag are two different concepts, and this request conflates them:

  | Concern | With `other_expense` as a category | What the user probably expects |
  |---|---|---|
  | Excluded from Leaks | ✅ yes (after this doc) | ✅ yes |
  | Counted in total monthly spend | ✅ **still counted** | ❔ probably not, for a self-transfer |
  | Shown in category breakdown / reports | ✅ appears as its own slice | ❔ maybe |
  | Counted against monthly budget | ✅ **still counted** | ❔ probably not |

  Moving ₹10,000 between your own accounts is not spending at all. Tagged as `other_expense`, it will still inflate "Total Spent" on the dashboard and eat the user's monthly budget — the user will likely report *that* as the next bug.

  **The two options:**

  - **(A) Category only — what this document specifies.** Cheap, matches the client's literal wording, ships fast. Transfers still count as spending.
  - **(B) Add a separate `isTransfer` / `excludeFromSpending` boolean** on the transaction, independent of category. Then reports, budget, and leaks can each decide whether to include it. More correct, more work, touches the reports and budget aggregations too.

  **Recommendation: build (A) now** — it is exactly what was asked for and it unblocks the leaks complaint — **but check with the client whether transfers should also be excluded from total spend and budget.** If yes, (B) should be scheduled as a follow-up rather than retrofitted later, since by then users will have data tagged under (A).

  ---

  ## 7. Data migration

  **None required.** This is purely additive:

  - No existing document changes.
  - No index changes (`category` is already queried with `$nin`; adding one more value to the array does not alter the index requirement).
  - Existing transactions keep their current categories.
  - Old app versions that don't know `other_expense` will fall back to rendering it as "Others" (the frontend does `CATEGORIES[cat] || CATEGORIES.others`), so there is no crash risk during a staged rollout.

  Deploy order does not matter — frontend and backend are independently safe. If the backend ships first, nothing changes until users start tagging. If the frontend ships first (as it has), the defensive client filter provides partial cover until the server catches up.

  ---

  ## 8. Test plan

  Please verify each of these before marking done.

  | # | Test | Expected result |
  |---|---|---|
  | 1 | `POST /api/transactions` with `category: "other_expense"` | 201; document stored with exactly `other_expense` |
  | 2 | `POST /api/transactions` with `category: "bogus_value"` | Stored as `others` (after §4.6) |
  | 3 | Create **5+** transactions to the same merchant, all `other_expense`; call `GET /api/leaks` | That merchant does **not** appear anywhere in the response |
  | 4 | Same merchant, 5 transactions: 3 tagged `food`, 2 tagged `other_expense` | Merchant appears as a leak, but `monthlyEstimate` reflects **only the 3 food transactions** — this is the test that proves the fix is at the query, not a post-filter |
  | 5 | Create a subscription-type **bill** with `category: "other_expense"`, no matching tx for 45+ days | Does **not** appear as an "Inactive" ghost-subscription leak (§4.3) |
  | 6 | Trigger `POST /api/transactions/categorize-others` with `other_expense` transactions present | Those transactions are **unchanged** (§4.5) |
  | 7 | Call the AI assistant endpoint with `other_expense` transactions present | The `leaks` snapshot passed to the model excludes them (§4.4) |
  | 8 | Existing users with no `other_expense` data | `GET /api/leaks` output is byte-identical to before the change (no regression) |
  | 9 | Old app build (pre-`other_expense`) reads a transaction tagged `other_expense` | Renders as "Others" with grey icon, no crash |

  ---

  ## 9. Summary checklist

  - [ ] §4.1 — `other_expense` added to `CategoryType` in `server/routes.ts:56`
  - [ ] §4.1 — `other_expense` added to `CategoryType` in `server/categorization-utils.ts:4`
  - [ ] §4.2 — **`other_expense` added to the `$nin` exclusion in `GET /api/leaks` (server/routes.ts:2441)** ← the actual fix
  - [ ] §4.3 — Ghost-subscription rule skips leak-exempt bill categories
  - [ ] §4.4 — AI assistant leaks snapshot uses the same exclusion list
  - [ ] §4.5a — AI prompt updated to recognise P2P transfers
  - [ ] §4.5b — Confirmed the re-categorizer never overwrites `other_expense`
  - [ ] §4.6 — Category validated against a whitelist on write
  - [ ] §5 — **Decision needed:** ship `PATCH /api/transactions/:id` so users can re-tag SMS-imported transfers?
  - [ ] §6 — **Decision needed (client):** should Other Expense also be excluded from total spend and monthly budget?
  - [ ] §8 — All 9 tests pass

  ---

  ## 10. Contact

  Frontend side is complete and merged on `aselea-frontend-fixers`. If any naming or shape needs to change, tell the frontend team **before** implementing — the string `other_expense` is hardcoded in the app's type union, category map, and locale files, so a rename requires a coordinated release.
