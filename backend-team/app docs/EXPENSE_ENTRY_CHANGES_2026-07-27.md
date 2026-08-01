# Expense Entry — Change Request (supplement to EXPENSE_ENTRY_BACKEND_TODO.md)

**For:** Backend team
**Date:** 2026-07-27
**Read this first, then the main doc.** This is a short delta, not a replacement. `EXPENSE_ENTRY_BACKEND_TODO.md` remains the full specification — every endpoint, payload and schema detail lives there. This document says **what changed since it was written** and **what that changes about your priorities.**

---

## TL;DR

Bank statement **CSV import shipped** after the main doc was written. That flips one item from "nice to have later" into **a live bug that duplicates real financial data**, and it changes the recommended order of work.

| | Before | Now |
|---|---|---|
| CSV import (doc §5 / Method 5) | Deferred, not built | **Shipped and working** |
| Dedup key (doc §2) | Priority 2, precautionary | **Priority 1 — live bug** |
| Schema fields (doc §1) | Priority 1 | Priority 2 (unchanged in substance) |
| PDF import (doc §4) | 8-bank parser promised | Rescoped: HDFC + ICICI, convenience only |
| Bulk endpoint (doc §3) | Future load pattern | Real load pattern today |

**Nothing already specified in the main doc was withdrawn.** No payload shape changed. No endpoint contract changed.

---

## 1. THE URGENT ONE — `dedupeKey` is being sent and dropped

### What changed

The import screen (`app/import-statement.tsx`) is live. Every imported row now includes a `dedupeKey` in its `POST /api/transactions` body:

```json
{
  "merchant": "Swiggy Order",
  "amount": 450,
  "category": "food",
  "date": "2026-07-05T00:00:00.000Z",
  "isDebit": true,
  "source": "import",
  "dedupeKey": "csv_1a2b3c_4d5e_1f"
}
```

`POST /api/transactions` (`server/routes.ts:1466`) destructures only `merchant, amount, category, date, upiId, isDebit, description`. **`dedupeKey` is silently discarded and the row is a bare `insertOne`.**

### Why this is now urgent rather than theoretical

Users re-import overlapping date ranges as a matter of course — import June, then next month import "last 3 months" because that is the export their bank offers. **Every overlapping transaction is inserted again.** Their ledger, budgets, category totals and money-leak detection all silently double-count.

This is worse than the §1 field-dropping problem: §1 loses a *preference* the user can re-enter, and the frontend already papers over it locally. §2 corrupts *financial records* and there is no client-side workaround — only the server can enforce uniqueness.

### What to do

Exactly what §2 of the main doc already specifies. Nothing has changed about the design:

1. Store `dedupeKey` on the transaction document when present.
2. Add the partial unique index — **the `partialFilterExpression` is not optional**, or every Quick Add row (no key) collides on `null`:

```js
db.transactions.createIndex(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
)
```

3. When `dedupeKey` is present, upsert on `(userId, dedupeKey)` with `$setOnInsert` — identical to the `smsId` logic already working in `POST /api/transactions/sync-from-sms` (`server/routes.ts:1522`). When absent, insert as today.

**Treat the key as an opaque string.** Do not try to reproduce the hash server-side — it is FNV-1a over `date|merchant|paise` computed in `buildDedupeKey()` (`lib/parse-statement.ts`), and it deliberately excludes category and member so re-categorising a row does not make it look new. Just store and match it.

**No frontend change needed.** The app already sends it correctly.

---

## 2. Bulk endpoint (doc §3) — now a real load pattern

`addTransactionsBulk()` posts **one HTTP request per row, in chunks of 5**, because no bulk endpoint exists. That was hypothetical when the main doc was written. It runs on every import now — a 200-row statement is 200 requests.

Contract is unchanged from main doc §3 (`POST /api/transactions/bulk`). Adopting it is ~10 lines of frontend change once it exists.

Not urgent for correctness, only for performance and partial-failure behaviour. **Do §1 above first.**

---

## 3. PDF import (doc §4) — rescoped down

The main doc restates the product doc's promise of parsers for 8 Indian banks. **That is no longer necessary.**

CSV import now covers **every bank**, because every bank offers some CSV/delimited export. The import screen detects a PDF and directs the user to their CSV export instead, so there is no user-facing dead end.

That makes PDF a **convenience feature, not a gap**. Recommendation: scope it to **HDFC and ICICI only** (the two clean tabular formats) and let the existing "use CSV instead" message handle everything else. Password-protected SBI PDFs stay out of scope — they need a decryption step most JS PDF libraries do not provide.

If you do build it, `lib/parse-statement.ts` is a working reference for the column-mapping problem. It already handles:

- header-name variants — `Withdrawal Amt.` / `Debit` / `Amount (INR)` / `Narration` / `Particulars` / `Transaction Remarks`
- separate debit+credit columns **or** a single signed amount column
- accounting negatives `(1,234.00)` and `Dr` / `Cr` suffixes
- leading account-summary junk rows before the real header
- delimiter detection (comma / tab / semicolon / pipe) and quoted fields containing commas

Matching its behaviour keeps PDF and CSV imports consistent for the user.

### One thing to copy exactly: date handling

**Statement dates are calendar dates, not instants.** Build them at **UTC midnight**.

This bit us on the client and is worth stating plainly so it does not bite you too. Using local-time construction and then serialising to UTC shifts every date backwards in India (UTC+5:30): `05/07/26` becomes `2026-07-04`, and **rows dated the 1st land in the previous month**, silently corrupting monthly reports while looking correct in a list.

Also: **assume day-first.** `01/02/2026` is 1 February in every Indian bank statement, never 2 January. Do not hand slash-dates to a default date parser that reads month-first.

---

## 4. Unchanged, still needed

These are exactly as specified in the main doc — no revision:

| Doc § | Item | Status |
|---|---|---|
| §1 | Persist + return `memberId`, `paymentMode`, `receiptUrl`, `source` | Still needed. Lets `lib/expense-overlay.ts` be deleted. |
| §5 | Recurring template CRUD | Still needed. Templates are device-local and lost on reinstall. |
| §6 | Receipt image upload | Still low priority. No UI depends on it. |
| §7 | Two doc claims that do not match the build (OCR is Textract not on-device ML Kit; voice is server transcription not `SFSpeechRecognizer`) | Still worth correcting before this text reaches App Store privacy copy. |

Migration decision also unchanged (client, 2026-07-27): **no backfill.** Legacy transactions keep `memberId: null`.

---

## Revised priority order

| Priority | Item | Why this position |
|---|---|---|
| **1** | §2 dedup key | Live bug corrupting financial data. Client already sends the key — smallest change, largest correctness win. |
| **2** | §1 schema fields | Member + payment mode visibly do not persist. Retires a client-side workaround. |
| 3 | §3 bulk endpoint | Live load pattern; perf and partial-failure handling. |
| 4 | §5 recurring CRUD | Closes a real "lost on reinstall" data-loss path. |
| 5 | §4 PDF parsing | Convenience only now that CSV covers every bank. |
| 6 | §6 receipt upload | Nothing depends on it. |

---

## Testing note

The CSV parser is unit-tested against **synthetic** fixtures (8 formats plus edge cases and dedup stability). **No real bank export has been parsed, and no screen has been rendered on a device.** Real exports have quirks synthetic fixtures do not.

If you have access to genuine statement exports, running one per bank through the flow would be the single highest-value verification available right now — for both sides of this integration.
