# Bill Scanning — Wrong Date Extracted

**Created:** 2026-08-20
**Updated:** 2026-08-20 — **STILL BROKEN after the deployed fix. Confirmed reproduction below (§0). Please reopen.**
**Status:** 🔴 Open — backend fix required
**Priority:** High — client-reported, affects every scanned bill
**Frontend:** ✅ No changes needed (one condition — see §6)

---

## 0. ⚠️ CONFIRMED REPRODUCTION — read this first

Tested after your fix was deployed. **The date is still wrong, and we now have
the exact cause.**

### The bill

```
Date:            Aug 20, 2026     <- invoice date
Payment Terms:   100
Due Date:        Sep 10, 2026     <- THIS is what should be extracted
```

### The result

| | |
|---|---|
| Bill's printed Due Date | **Sep 10, 2026** |
| App displayed | **27/8/2026** |
| Confidence reported | 95% |

### The cause — arithmetic proof

`27/8/2026` is **not** on the bill anywhere. It is not the due date, not the
invoice date, and not a DD/MM swap. We computed it:

```
invoice date (Aug 20, 2026) + 7 days = Aug 27, 2026 = 27/8/2026   ← EXACT MATCH
```

**The extractor is ignoring the "Due Date" line entirely and generating a
fallback of `invoice date + 7 days`.**

Note it also ignored `Payment Terms: 100` (Aug 20 + 100 = Nov 28), so it is not
using the terms field either. It is a hardcoded 7-day default.

### Why this is conclusive

- This bill is **not** a DD/MM ambiguity case — the dates are written in
  unambiguous long form (`Sep 10, 2026`), so Cause A cannot explain it.
- It is **not** Cause B either — Cause B would have returned the *invoice* date
  (`20/8/2026`). It returned neither date on the bill.
- The frontend was re-audited for this specific behaviour: **no `+7`, no
  `setDate`, no `addDays`, no default-due logic exists anywhere in
  `app/scan-bill.tsx`** (grep returns zero matches). The client cannot produce
  this value.

### What we think happened

The label-matching from your Cause B fix is not matching `Due Date:` on this
layout — likely because the value sits in a right-aligned table column, so the
label and value may be far apart in the OCR text, or on separate lines.

When the match fails, the code falls through to a `+7 days` default **and
reports 95% confidence anyway** — which is arguably the worse bug: a
manufactured date presented as a high-confidence extraction.

### Two asks

1. **Fix the label matching** so `Due Date: Sep 10, 2026` is found on this
   layout. This exact bill is a good regression test — the dates are in long
   form, so nothing else can be blamed.
2. **Do not silently substitute a date.** If no due date is found, return
   `dueDate: null` and a **low confidence score**. The app already handles
   `null` correctly — it shows "Not available" and prompts the user to pick a
   date. A wrong date shown at 95% confidence is worse than an honest blank,
   because the user has no reason to check it.

---

## 1. The reported bug

> "There is an error in the scanning. It is not fetching the right date of the
> bill. If the bill includes a date, it is not fetching the right date."

A user scans a bill that clearly shows a date. The scan succeeds, but the date
shown in the app is **not the date printed on the bill**.

---

## 2. Why this is a backend fix

The date is extracted **entirely server-side**. The client is a pure
pass-through and performs **no date parsing, no format detection, and no
transformation**.

Full audit in §5. Short version:

```js
// app/scan-bill.tsx:290 — stores the server's response VERBATIM
const resJson = await res.json();
setEditingData(resJson.preview);
```

**Whatever `preview.dueDate` the server returns is exactly what the app displays
and stores.** If the date is wrong, the server sent it wrong.

---

## 3. The three possible causes

There are three distinct bugs that produce "wrong date". They need different
fixes, so identify which one first — §7 has tests that distinguish them in
minutes.

### Cause A: DD/MM vs MM/DD misparsing ⚠️ *most likely*

Indian bills are **DD/MM/YYYY**. Most date libraries default to US
**MM/DD/YYYY**.

| Printed on bill | Correct (DD/MM) | If parsed as MM/DD | Wrong by |
|---|---|---|---|
| `05/08/2026` | 5 August 2026 | 8 May 2026 | ~3 months |
| `01/12/2026` | 1 December 2026 | 12 January 2026 | ~11 months |
| `10/07/2026` | 10 July 2026 | 7 October 2026 | ~3 months |

This is the most dangerous case because the result is still a **valid,
plausible-looking date** — nothing errors, it is simply wrong.

**Diagnostic:** when the day is **> 12** (e.g. `25/08/2026`), MM/DD parsing is
impossible, so most libraries fall back to the correct reading. **If dates are
wrong for days 1–12 but correct for 13–31, that confirms Cause A.**

Fix: parse explicitly as DD/MM/YYYY rather than relying on a locale default.

### Cause B: the wrong date field is picked

A bill typically prints several dates:

```
Invoice Date:     01/08/2026     <- issue date
Due Date:         15/08/2026     <- what we want
Statement Period: 01/07 - 31/07
Payment Date:     05/08/2026
```

If OCR takes the first date it finds, it usually grabs the **invoice date**.

Fix: match on the **label**, not position — `due date`, `payment due`, `pay by`,
`last date`, `due on` (case-insensitive) — and only fall back to another date
when no due-date label is found.

### Cause C: timezone rollover ⚠️ *see §4*

If the date is consistently **exactly one day late**, it is not A or B — it is
the timestamp's time-of-day. Details below.

---

## 4. Required response format

Return `dueDate` as a full ISO 8601 UTC timestamp at **midnight**:

```json
{
  "preview": {
    "name": "Electricity Bill",
    "amount": 1240,
    "dueDate": "2026-08-15T00:00:00.000Z",
    "category": "bills"
  },
  "metadata": { "confidence": 0.92 }
}
```

### ⚠️ Why midnight UTC matters

The app renders with `toLocaleDateString('en-IN')`, converting to **IST
(UTC+05:30)**. A late-day UTC time rolls the date forward. Verified by
execution:

| Server sends | App displays (IST) | |
|---|---|---|
| `2026-08-05T00:00:00Z` | `5/8/2026` | ✅ correct |
| `2026-08-05T19:00:00Z` | `6/8/2026` | ❌ off by one day |
| `2026-08-05T23:30:00Z` | `6/8/2026` | ❌ off by one day |

Anything from `18:30:00Z` onward shifts the displayed date. `T00:00:00.000Z` is
always safe.

Please also avoid a bare date-only string (`"2026-08-15"`) — the full timestamp
is unambiguous and matches what the rest of the API already returns.

### `null` when no date is found

```json
{ "preview": { "dueDate": null } }
```

Already handled — the app shows "Not available" and lets the user pick a date
manually.

---

## 5. Frontend code audit

All references are `app/scan-bill.tsx`, **verified against the file on
2026-08-20**.

**Step 1 — receive and store verbatim** (line 290)

```js
const resJson = await res.json();
setEditingData(resJson.preview);   // no transformation whatsoever
```

**Step 2 — display as-is** (lines 671 and 716)

```js
editingData?.dueDate
  ? new Date(editingData.dueDate).toLocaleDateString('en-IN')
  : t('scanBill.notAvailable')
```

Two render sites — the summary grid (671) and the edit form row (716). Both read
the same value; neither modifies it.

**Step 3 — manual correction only** (line 799)

```js
if (date) setEditingData((prev) => ({ ...prev, dueDate: date.toISOString() }));
```

Fires **only when the user taps the date field and picks a date**. Not part of
the scan path.

**Step 4 — send the same object back** (line 414)

```js
body: JSON.stringify({ preview: editingData })
```

### Audit result

- ✅ Exactly **one** write to `dueDate` in the scan flow — the manual picker (799)
- ✅ **No** parsing, format detection, or transformation client-side
- ✅ The server's response is displayed and re-sent **verbatim**

### Code reference table

| What | Location |
|---|---|
| Server response stored (no transformation) | `scan-bill.tsx:290` |
| Date display — summary grid | `scan-bill.tsx:671` |
| Date display — edit form | `scan-bill.tsx:716` |
| Manual date picker (user edit only) | `scan-bill.tsx:799` |
| Sent on commit | `scan-bill.tsx:414` |

---

## 6. The one condition on "no frontend changes"

**If you return midnight UTC as specified in §4, no client change is needed and
this is closed.**

If you cannot return midnight UTC, tell us — we would then need to normalise the
timestamp client-side, which **would** require an app release. Midnight UTC
avoids that entirely and is the recommended path.

Everything else — the review screen, the edit form, the manual date picker,
validation, saving — is already built and working.

---

## 7. How to verify

1. Scan a bill with a **day ≤ 12** (e.g. `05/08/2026`) → app must show
   `5/8/2026`, **not** `8/5/2026`. *(Tests Cause A.)*
2. Scan a bill with a **day > 12** (e.g. `25/08/2026`) → should already work;
   confirms the previously-correct path is not broken.
3. Scan a bill printing **both an invoice date and a due date** → app must show
   the **due date**. *(Tests Cause B.)*
4. Confirm `dueDate` ends with `T00:00:00.000Z` in the response. *(Tests Cause C.)*
5. Scan a bill with **no date at all** → `dueDate: null` → app shows
   "Not available".
6. Save, reopen from bill details → the date must still match the bill.

For each, compare the date **printed on the bill** against the date **shown in
the app**. They must match exactly.

---

## 8. Scope note

We do not have a failing bill image on the frontend side, so §3's causes are
inferences from the code path rather than a confirmed diagnosis of one specific
bill. The tests in §7.1 and §7.2 will identify the actual cause within minutes.

If you have the OCR text and parsed output for a bill that failed, that would
settle it immediately.

---

## 9. Note on this repo

`server/` in the frontend checkout is **stale** — this branch is
`aselea-frontend-fixers`. Please treat `main` and the deployed API as the source
of truth, not this copy. (Same caveat as the caregiver-invites doc, where it
previously caused a false "route does not exist" report.)
