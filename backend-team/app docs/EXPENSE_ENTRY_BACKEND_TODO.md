# iOS Expense Entry — Backend Work Required

> **⚠️ Read `EXPENSE_ENTRY_CHANGES_2026-07-27.md` first.** CSV statement import shipped after this document was written. That makes §2 (dedup key) a **live bug corrupting financial data**, not a precaution, and it reorders the priorities at the end of this file. This document is still the full specification — payloads and contracts here are all current — but the change doc has the correct order of work.

**For:** Backend team
**Date:** 2026-07-27
**Context:** The **frontend for expense entry is built and working** — Quick Add, receipt-scan-to-expense, voice-to-expense, and recurring templates. It currently runs against the **existing** `POST /api/transactions` endpoint, which accepts only a subset of the fields the app sends. This document lists **only the backend work** needed to make it complete and multi-device.

Source of truth: `LifeWise_Product_Logic_with_Timeline.pdf` §1–2 ("iOS vs Android — Key Platform Difference" and "iOS Expense Entry — 6 Smart Methods").

> **The app is already sending the full payload today.** Extra fields are silently dropped by the current route. Nothing below requires a frontend change to *start* working — once you persist and return the fields, they light up. The one exception is the bulk endpoint in §3, which needs a small frontend switch.

---

## Why this exists (read this first)

Apple sandboxes the SMS inbox. **No third-party iOS app can read SMS**, so the Android auto-track path (`lib/sms-reader.ts` → `POST /api/transactions/sync-from-sms`) has no iOS equivalent. The product doc's answer is six alternative entry methods. Four are now built on the client:

| # | Method | Frontend status | Backend work needed |
|---|--------|-----------------|---------------------|
| 1 | Manual Quick Add | **Built** — `components/QuickAddSheet.tsx` | §1 fields, §2 dedup |
| 2 | Receipt / bill camera scan | **Built** — expense path added to `app/scan-bill.tsx` | §1 fields |
| 3 | Voice input | **Built** — `lib/parse-voice-expense.ts` | §1 fields |
| 4 | Bank statement PDF import | **Blocked** — UI built, parsing needs you | **§4** |
| 5 | CSV / Excel import | **Built (CSV)** — `lib/parse-statement.ts` | §2, §3 |
| 6 | Recurring templates | **Built local-only** — `lib/recurring-expenses.ts` | §5 |

**CSV import is live and works end-to-end today.** It parses fully on-device and saves through the existing endpoint, so it needs nothing from you to function — but it is currently posting one request per row (see §3) and **has no duplicate protection** (see §2), which matters most for import.

**PDF import is the one thing on this list the frontend cannot do at all.** React Native cannot extract PDF text; the screen detects a PDF and tells the user to use CSV instead. Making PDF work requires §4. Excel (.xls/.xlsx) is likewise rejected with a "re-export as CSV" message.

---

## 1. Extend the transaction document (highest priority)

### 1.1 The problem

`POST /api/transactions` (`server/routes.ts:1466`) destructures only:

```js
const { merchant, amount, category, date, upiId, isDebit, description } = req.body;
```

`GET /api/transactions` (`server/routes.ts:1446`) likewise returns only those seven fields.

The app now sends **four more**, and they are being dropped:

```
memberId      string | null    // which family member this expense belongs to
paymentMode   "upi" | "cash" | "card" | "netbanking"
receiptUrl    string           // attached bill/receipt image, "" when none
source        "manual" | "sms" | "scan" | "voice" | "import" | "recurring"
```

**Consequence today:** the user picks "Papa" and "Cash" in Quick Add, saves, and both vanish on the next refresh. The frontend currently papers over this with a local AsyncStorage cache (`lib/expense-overlay.ts`) — **that file exists only because of this gap and should be deleted once §1 ships.**

### 1.2 What to do

Accept and persist all four fields on `POST /api/transactions`, and return them from `GET /api/transactions`.

**Exact payload the app sends today:**

```json
{
  "merchant": "Dinner",
  "amount": 1250,
  "category": "food",
  "date": "2026-07-27T14:30:00.000Z",
  "upiId": "",
  "isDebit": true,
  "description": "Dinner",
  "memberId": "66a1f0c2e4b09a1234567890",
  "paymentMode": "upi",
  "receiptUrl": "",
  "source": "manual"
}
```

**Validation notes — please do not reject on these:**
- `memberId` is `null` for "me"/unassigned. It is **not** required. Validate it against the `family` collection for the same `userId` when non-null; on mismatch store `null` rather than 400 — a stale member id must not block an expense.
- `paymentMode` defaults to `"upi"` if absent or unrecognised.
- `source` defaults to `"manual"`. Store it verbatim; it is what will let Reports break spending down by entry method later.
- `receiptUrl` is `""` today. Image upload is not built — see §6.

### 1.3 Migration

**Decision already made (client, 2026-07-27): do not backfill.** Existing transactions keep `memberId: null`, which the app renders as unassigned. No migration script. `GET` should emit `memberId: null` (not `undefined`) for legacy rows so the client's null-handling is uniform.

---

## 2. Deduplication key for non-SMS sources

### 2.1 The problem

`POST /api/transactions/sync-from-sms` already dedupes correctly, upserting on `(userId, smsId)` (`server/routes.ts:1522`). **`POST /api/transactions` has no dedup at all** — it is a bare `insertOne`.

This is tolerable for Quick Add (a user double-tapping Save is rare and self-evident) but it is **actively broken for import**, where users routinely re-import overlapping date ranges. Importing June then Jan–Jun produces six months of duplicates.

**This is live now, not hypothetical** — CSV import shipped in Module 2. The client already computes and sends `dedupeKey` on every imported row (`buildDedupeKey()` in `lib/parse-statement.ts`); the server currently ignores it, so re-importing the same statement duplicates every transaction. **Nothing on the frontend needs to change — just honour the field.**

### 2.2 What to do

Add an optional `dedupeKey` (string) to the transaction document, unique per `userId` when present:

```
db.transactions.createIndex(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
)
```

When `dedupeKey` is supplied, upsert on `(userId, dedupeKey)` with `$setOnInsert` — mirroring the `smsId` logic that already works. When absent, insert as today.

**The key the client already sends** is built from `date_yyyy_mm_dd + "|" + lowercased_alphanumeric_merchant + "|" + amount_in_paise`, hashed with FNV-1a and prefixed `csv_`. It deliberately **excludes** category and member, so re-categorising a row does not make it look new. Treat it as an opaque string — do not try to reproduce the hash server-side; just store and match it.

The partial index matters: without `partialFilterExpression`, every Quick Add row with no key collides on `null`.

---

## 3. Bulk transaction endpoint

### 3.1 The problem

`addTransactionsBulk()` in `lib/expense-context.tsx` currently **posts one request per row, in chunks of 5**, because no bulk endpoint exists. A 200-row statement import is 200 HTTP requests. It works, but it is slow, partially-failing, and wasteful.

CSV import is shipped and calls this on every import, so this is a real load pattern in production now, not a future one.

### 3.2 What to do

```
POST /api/transactions/bulk
Authorization: Bearer <token>

{ "transactions": [ { ...same shape as §1.2, plus dedupeKey }, ... ] }

200 OK
{ "saved": 187, "skipped": 13, "failed": 0 }
```

Use `bulkWrite` with `ordered: false` and the §2 upsert semantics, exactly like `sync-from-sms` does. `skipped` = dedupe hits.

**This is the single highest-value endpoint on this list** after §1. Frontend change to adopt it is ~10 lines in `addTransactionsBulk`.

---

## 4. PDF statement parsing (Method 4 — blocked on you)

The import UI is **built and shipped** (`app/import-statement.tsx`). CSV works today. PDF is detected and politely refused, because the client physically cannot parse it. This section is what turns that refusal into a working feature.

### 4.1 Recommendation: do this server-side, and CSV is already done

The product doc names `react-native-pdf` for PDF parsing. **That library is a viewer — it does not extract text.** React Native has no good PDF text-extraction story. You already run AWS Textract for `POST /api/bills/scan/preview`, and Node has real PDF libraries, so **parse on the server**.

Also: the doc promises parsers for 8 Indian banks with per-bank accuracy ratings, budgeted at 3 hrs total. That estimate is not realistic — each bank format is its own parser with its own fixtures, and banks redesign statements. The doc itself concedes CSV is "near 100% accurate" and lists "advise user to export CSV if PDF fails" as the fallback.

**CSV shipped first for exactly that reason, and it already covers every bank.** So PDF is now a convenience feature, not a blocker — scope it to HDFC and ICICI (the two clean tabular formats) and let the existing "use CSV instead" message handle the rest. That is a much smaller job than the doc's 8-bank promise, and the user-facing gap is already closed.

You can reuse the client's column-mapping logic as a reference: `lib/parse-statement.ts` already handles the header-name variants (`Withdrawal Amt.` / `Debit` / `Amount (INR)`), separate-vs-signed amount columns, DD/MM day-first dates, accounting negatives `(1,234.00)`, `Dr`/`Cr` suffixes, and leading account-summary junk rows. Matching its behaviour keeps PDF and CSV imports consistent.

Password-protected SBI PDFs ("prompt for DOB password" per the doc) need a decryption step most JS PDF libraries do not provide out of the box. Scope that separately.

### 4.2 Endpoints

```
POST /api/transactions/import/preview     multipart: file=<pdf|csv|xls>, [password]
→ 200 { "rows": [ { "date", "description", "amount", "isDebit",
                    "suggestedCategory", "dedupeKey" } ],
        "meta": { "bank": "HDFC", "format": "pdf", "rowsFound": 212,
                  "confidence": "high", "dateRange": {...} } }
→ 422 { "message": "Could not read this statement. Try the CSV export instead." }
→ 401 { "message": "This PDF is password protected.", "needsPassword": true }
```

Preview must **not** write anything — the user reviews and unchecks rows first (doc Method 4, Step 4). Commit goes through §3's bulk endpoint.

Reuse the existing categorisation engine (`server/categorization-utils.ts`) for `suggestedCategory` — the keyword map (SWIGGY→food, MEDPLUS→health, etc.) is what the doc asks for and it already exists.

### 4.3 iOS Share Sheet

Method 4 Step 1 has the user share a statement from their bank app into LifeWise. `CFBundleDocumentTypes` is **now declared** in `app.json` (CSV, plain text, PDF) so LifeWise is offered in the iOS Share Sheet — **frontend work, already done**, noted so nobody redoes it.

Caveat: declaring the type registers the app as a handler, but wiring the received file into the import screen still needs testing on a real device, and a full "Share to LifeWise" extension would be a separate native target that Expo config plugins do not handle cleanly. Not blocking — the in-app file picker works today.

---

## 5. Recurring expense templates (Method 6)

### 5.1 Current state

Built and working, but **stored in AsyncStorage** (`lib/recurring-expenses.ts`). Known limitations, all caused by having no endpoint:

- templates do not sync across devices
- they are lost on reinstall
- due-date detection only advances while the app is open

The confirmed *expense* posts to the server normally, so the ledger is always correct — only the template definition is device-local.

### 5.2 What to do

Standard CRUD on a `recurringExpenses` collection:

```
GET    /api/recurring                → [ RecurringExpense ]
POST   /api/recurring                → RecurringExpense
PUT    /api/recurring/:id            → RecurringExpense
DELETE /api/recurring/:id            → 204
POST   /api/recurring/:id/handled    { period: "2026-07" } → 204
```

```
RecurringExpense {
  id, userId, name, amount, category,
  dayOfMonth: 1-31,
  memberId: string | null,
  paymentMode?: PaymentMode,
  lastHandledPeriod: "YYYY-MM" | null,
  createdAt
}
```

`lastHandledPeriod` is how the client knows to stop offering an occurrence — set it for **both** confirm and skip. The ledger records the difference; the template only needs to know not to ask again this month.

**`dayOfMonth` must clamp, not roll over.** A template set to the 31st fires on Feb 28 — never Mar 3. The client already does this; match it server-side.

### 5.3 Deliberate design decision — do not "fix" this

The doc says "App auto-adds it every month on the correct date." **The implementation does not auto-save**, and this is intentional: the doc's own Step 2 says the notification reads *"Tap to confirm or edit"*, rent is the field most likely to change month-to-month, and silently writing money movements the user never approved erodes trust in the ledger. The due date produces a **pending** entry confirmed with one tap.

If you add a server-side scheduler later, please keep it generating pending confirmations, not committed transactions.

---

## 6. Receipt image storage (not built)

`receiptUrl` is in the schema and always `""` today. Method 1 lists "Receipt Photo — optional" and Method 2 says "Receipt image saved as attachment (optional)".

You already have `@aws-sdk/client-s3` as a dependency and multipart handling for bill scans. A presigned-upload endpoint would be the natural fit:

```
POST /api/uploads/receipt  → { uploadUrl, publicUrl }
```

The client then PUTs the image and sends `publicUrl` as `receiptUrl`. Low priority — no UI depends on it yet.

---

## 7. Two doc claims that do not match the built app

Flagging these because they will end up in App Store privacy copy if nobody catches them.

1. **OCR is not on-device.** The doc says receipt scanning uses "Google ML Kit OCR (runs on-device, free, no API call)" and that "No data sent to server." The actual implementation posts the image to `POST /api/bills/scan/preview` and uses **AWS Textract**. The privacy claim is wrong as written. Either correct the doc or move to genuine on-device OCR (needs a config plugin; will not run in Expo Go).

2. **Voice is not `SFSpeechRecognizer`.** The doc specifies `@react-native-voice/voice` with Apple's on-device engine and "no API cost." The app records via `expo-av` and uploads to `POST /api/reminders/voice/parse` for server transcription — so it does cost per use and audio does leave the device. **Recommend keeping the current approach** (it handles Hindi/Gujarati/Marathi code-mixing better than `SFSpeechRecognizer` would) and correcting the doc.

Note the *expense parsing* on top of the transcript **is** fully on-device (`lib/parse-voice-expense.ts`) — no extra API call, no added latency.

---

## Priority order

| Priority | Item | Why |
|---|---|---|
| **1** | §2 dedup key | **CSV import is live and duplicates on re-import today.** The client already sends the key; you only need to honour it. Smallest change, biggest correctness win. |
| **2** | §1 fields | Member + payment mode are visibly broken without it. Lets `lib/expense-overlay.ts` be deleted. |
| 3 | §3 bulk endpoint | Live import currently fires one request per row. Real load pattern now. |
| 4 | §5 recurring CRUD | Removes a real "lost on reinstall" data-loss path. |
| 5 | §4 PDF parsing | Convenience only — CSV already covers every bank. |
| 6 | §6 receipt upload | No UI depends on it yet. |

§2 moved ahead of §1 because §1 is a *missing* feature (fields silently dropped, worked around client-side) whereas §2 is a *correctness bug* that duplicates real financial data on a flow users can run today.

---

## Frontend files referenced

| File | Role |
|---|---|
`lib/data.ts` | `Transaction`, `PaymentMode`, `ExpenseSource` types |
`lib/expense-context.tsx` | `addTransaction()` / `addTransactionsBulk()` — the only place expenses are created |
`lib/expense-overlay.ts` | **Temporary.** Delete once §1 ships; instructions in its header |
`lib/parse-voice-expense.ts` | On-device Hinglish expense parsing (no backend involvement) |
`lib/parse-statement.ts` | On-device CSV parsing + `buildDedupeKey()` — the key §2 must honour |
`app/import-statement.tsx` | Methods 4 & 5 UI — file picker, review list, bulk import |
`lib/recurring-expenses.ts` | Local template storage; replace with §5 endpoints |
`components/QuickAddSheet.tsx` | Method 1 UI |
`app/scan-bill.tsx` | Method 2 — "Already paid — save as expense" |
`app/voice-reminder.tsx` | Method 3 — "Already spent — save as expense" |
`app/recurring-expenses.tsx` | Method 6 UI |
