# Bank Statement Import (PDF + CSV + Excel) — Backend Requirements

**For:** Backend team
**Date:** 2026-08-06
**Frontend status:** **Done and shipped.** `app/import-statement.tsx` now uploads
PDF, CSV and Excel through one picker and implements the full response contract
below — including the password-retry flow for encrypted PDFs.
**Backend status:** CSV works. **PDF and Excel are not implemented** — that is
what this document asks for.

> This supersedes §4 of `app docs/EXPENSE_ENTRY_BACKEND_TODO.md`, which described
> this work while the frontend still refused PDFs client-side. It no longer does.
> Everything needed to build the server side is in this one file.

---

## 1. What changed on the frontend, and what it means for you

Previously the app inspected the file extension and blocked PDFs before upload,
showing "PDF statements are not supported yet." **That block is gone.** The
screen now sends whatever the user picked to the existing endpoint and renders
whatever comes back.

The consequence you need to know about:

> **Users can now upload PDFs today, and they will hit your endpoint.**
> Until PDF parsing exists, every one of those uploads must come back as a
> **422 with a helpful `message`** (§3.3). The app shows your `message` verbatim,
> so that string is your user-facing error text — please make it a good one.

Design rule behind this: **the server decides what it can read, never the app.**
When you ship PDF support, it goes live for every installed client with no app
update, no store review, no version gate. Don't add a "supported formats"
endpoint — the 422 path already covers it.

---

## 2. The endpoint

Unchanged from what CSV already uses. One endpoint handles all formats.

```
POST /api/transactions/import/preview
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| Field | Type | Notes |
|---|---|---|
| `file` | file | The statement. `.pdf`, `.csv`, `.xls`, `.xlsx`. |
| `password` | string | **Optional.** Only sent on a retry, after you replied `needsPassword` (§3.4). |

**Preview writes nothing.** The user reviews rows and unchecks what they don't
want; the commit is a separate call to the bulk endpoint (§6). Do not create
transactions here.

### Content-Type warning

The app derives the MIME type from the **file extension**, not from what the OS
reported. Android's document picker routinely reports files in Downloads as
`application/octet-stream`. If you gate on `Content-Type` you will reject valid
statements — **sniff the bytes** (`%PDF-` magic number, `PK` for xlsx) or trust
the filename, but do not trust the multipart content-type alone.

### Size limit

Set it generously — a 12-month PDF statement can exceed 10 MB. If you reject on
size, use **413**; the app has a specific message for that ("try a shorter date
range"). Anything else reads as a generic failure.

---

## 3. Responses

### 3.1 Success — 200

```jsonc
{
  "rows": [
    {
      "date": "2026-07-14T00:00:00.000Z",  // ISO 8601. See §4 on timezone.
      "description": "UPI/SWIGGY/428101234567",
      "amount": 415.50,                     // Always POSITIVE. Sign lives in isDebit.
      "isDebit": true,                      // true = money out. Credits are ignored by the app.
      "suggestedCategory": "food",          // Must be one of §5's exact strings.
      "dedupeKey": "a3f1c9…"                // See §4. Critical.
    }
  ],
  "meta": {
    "rowsFound": 212,
    "rowsSkipped": 3,      // Rows present but unreadable. Shown as "3 rows unreadable".
    "bank": "HDFC",        // Optional. Shown in the review header if present.
    "format": "pdf",       // Optional.
    "confidence": "high"   // Optional, currently unused by the UI.
  }
}
```

`rows` and `meta` are both required. The app reads `meta.rowsSkipped` and
`meta.bank`; other `meta` fields are accepted and ignored, so you may add to it
freely.

**Return credits too** (`isDebit: false`). The app filters them out itself and
reports "N credits ignored" — that count is reassuring to users, and it's how
they can tell the parse didn't silently lose half the statement.

### 3.2 Nothing readable — 200 with an empty array

If the file parsed but contained no transactions, return `200` with
`"rows": []`. The app shows "No transactions found." Prefer this over a 422 when
the file itself was structurally fine.

### 3.3 Unsupported or unparseable — 422

```jsonc
{ "message": "PDF statements aren't supported yet. Please use your bank's CSV export." }
```

**The `message` is displayed to the user exactly as written.** Write it for a
non-technical person and always name the way forward. Use this for: format not
supported, bank layout unrecognised, file corrupt, scanned/image-only PDF.

Good: `"We couldn't read this HDFC statement. Please try the CSV export from net banking."`
Bad: `"Parse error: unexpected token at offset 4171"`

### 3.4 Password-protected PDF — 401 with `needsPassword`

```jsonc
{ "message": "This PDF is password protected.", "needsPassword": true }
```

**`needsPassword: true` is mandatory on this response.** The app treats 401 as
"session expired, sign out" by default — this flag is the only thing that
distinguishes a locked PDF from an expired token. Without it, a user uploading
an SBI statement gets told their session died.

Flow:

1. App uploads with no `password` → you reply 401 + `needsPassword: true`.
2. App prompts the user and **re-uploads the same file** with a `password` field.
3. Wrong password → reply 401 + `needsPassword: true` again. The app re-prompts
   with "That password did not work."
4. Correct → 200 as normal.

There is no attempt limit on the client; add server-side rate limiting if you
want one. **Never log or persist the password.**

### 3.5 Other statuses

| Status | App behaviour |
|---|---|
| 401 *without* `needsPassword` | "Session expired. Sign out and sign in again." |
| 413 | "File too large — try a shorter date range." |
| any other non-2xx | "Upload failed (error N). Please try again." |

---

## 4. `dedupeKey` — the one field that must be exactly right

This is the highest-risk part of the feature. It is what stops a user
re-importing July's statement and doubling every expense.

**Requirements:**

1. **Deterministic.** The same transaction in the same statement, parsed twice,
   must produce a byte-identical key. No timestamps, no random salt, no
   row index.
2. **Format-independent.** The *same transaction* imported from the PDF and from
   the CSV **must produce the same key.** Users do try both. This is the
   requirement most likely to be missed — build it into your test fixtures.
3. **Stable against cosmetic differences.** Normalise before hashing: collapse
   whitespace, upper-case, strip punctuation the two formats disagree on.
4. Scoped per user.

**Suggested recipe** (match `lib/parse-statement.ts`'s `sha1Hex()` if you want
parity with the retired client parser):

```
sha1( userId + "|" + YYYY-MM-DD + "|" + amountInPaise + "|" + normalisedDescription )
```

where `normalisedDescription` = upper-cased, non-alphanumerics collapsed to
single spaces, trimmed. Use the **date only, not the time** — PDFs frequently
carry no time component while CSVs do, and including time would break
requirement 2.

The app sends your `dedupeKey` straight back on commit (§6) rather than
recomputing it, so whatever you generate here is what gets indexed.

### Date and timezone

Return ISO 8601. The app renders with `timeZone: 'UTC'`, so **emit dates at
UTC midnight** (`2026-07-14T00:00:00.000Z`). If you emit local-midnight
`+05:30`, transactions display one day early. Indian statements are day-first
(`14/07/2026`) — never parse them as US month-first.

---

## 5. `suggestedCategory` — allowed values

Must be one of these exact lowercase strings. Anything else falls back to
`others` on the client:

```
food  transport  health  bills  shopping  entertainment
subscriptions  education  travel  investment  finance  family  others
```

Reuse the existing keyword engine in `server/categorization-utils.ts` — the
SWIGGY→food / MEDPLUS→health map already there is exactly what's wanted. When
unsure return `others`; the user can correct any row with one tap, and a wrong
confident guess is worse than an honest `others`.

---

## 6. Commit step (unchanged, for context)

After review, the app calls `addTransactionsBulk()` with the selected rows,
passing your `dedupeKey` through untouched. That path already exists — see §3 of
`app docs/EXPENSE_ENTRY_BACKEND_TODO.md`. Nothing about it changes here.

---

## 7. Scope recommendation

Do **not** attempt the product doc's "8 bank parsers with accuracy ratings, 3
hours". That estimate isn't realistic — each bank layout is its own parser with
its own fixtures, and banks redesign statements without notice.

Suggested order:

| Step | Work | Why |
|---|---|---|
| **1** | Return a good 422 for PDF **now** | Users can already upload PDFs. Until this lands they get a generic failure. **Smallest change, do it first.** |
| 2 | Text-layer PDF for HDFC + ICICI | Cleanest tabular layouts, largest user share. |
| 3 | Password-protected PDFs (§3.4) | SBI mails these by default. |
| 4 | Excel `.xls`/`.xlsx` | Nearly free — same column mapping as CSV. |
| 5 | More banks, as they come up | Driven by real 422 logs, not guesses. |

Scanned/image-only PDFs need OCR. You already run AWS Textract for
`POST /api/bills/scan/preview`, so it's reachable — but treat it as separate
work, and until then return a 422 telling the user to use CSV.

### Implementation notes

- **Parse server-side. React Native cannot extract PDF text at all** — that's
  why this is your job and not the app's. (`react-native-pdf`, named in the
  product doc, is a *viewer*; it does not extract text.)
- `lib/parse-statement.ts` in the app repo is a **working, retired CSV parser**
  kept specifically as your reference. It already handles the header variants
  (`Withdrawal Amt.` / `Debit` / `Amount (INR)`), separate-vs-signed amount
  columns, day-first dates, accounting negatives `(1,234.00)`, `Dr`/`Cr`
  suffixes, and the account-summary junk rows banks put above the real header.
  Matching its behaviour keeps PDF and CSV imports consistent — which §4's
  requirement 2 needs anyway.
- Most JS PDF libraries don't decrypt password-protected files out of the box.
  Check this before committing to a library.

---

## 8. Test checklist

- [ ] CSV still works exactly as before (no regression).
- [ ] PDF with no parser → 422, and the `message` reads well in the app.
- [ ] Android upload reporting `application/octet-stream` is accepted.
- [ ] Locked PDF with no password → 401 **with `needsPassword: true`**.
- [ ] Locked PDF, wrong password → 401 with `needsPassword: true` again.
- [ ] Locked PDF, correct password → 200.
- [ ] **Same statement as PDF and as CSV → identical `dedupeKey` per row.**
- [ ] Re-importing the same file → all rows skipped as duplicates, none doubled.
- [ ] Credits returned with `isDebit: false`, not dropped.
- [ ] A 14 July transaction displays as 14 July in the app (not 13).
- [ ] Oversized file → 413, not 500.

---

## 9. Frontend reference

| File | Role |
|---|---|
| `app/import-statement.tsx` | The whole import screen. Implements this contract. |
| `lib/parse-statement.ts` | Retired CSV parser — column-mapping reference for you. |
| `lib/expense-context.tsx` | `addTransactionsBulk()` — the commit path. |
| `lib/data.ts` | `Transaction` type and the `CategoryType` union in §5. |

Questions on anything here: the response shapes in §3 are what the app actually
branches on, so if a field needs to change, flag it before building — it's a
coordinated change, not a server-only one.
