# Bug #16 — Some SMS transactions are missed / risk of duplicates: Backend Guide

**Audience:** Backend team
**Status:** Frontend part is **already fixed**. This document covers what changed on the client and the one backend change required to keep it safe.
**File to edit:** `server/routes.ts`
**Endpoint:** `POST /api/transactions/sync-from-sms`
**Route location:** `server/ro
utes.ts`, around lines **1484–1540**

---

## 1. Background — the client complaint

Client reported: *"the app sometimes does not read all of the user's SMS."* This was confirmed. Real bank transaction SMS were being missed.

### Why it happened (frontend cause — now fixed)

The device SMS read was capped at the **200 newest inbox messages across all senders**. On a busy inbox (OTPs, promos, delivery updates), a genuine bank SMS could be pushed past position 200 and never read. The date filter ran *after* that cap, so it could never recover the lost messages.

### What the frontend now does (already merged)

The client now reads **incrementally by date** instead of by a fixed count:

- It stores a "last sync" watermark (epoch ms) locally.
- On each sync it asks the device for **every SMS since that watermark** (`minDate` filter), not the newest N.
- The watermark advances only to the newest message actually read, and only moves forward.
- Because incremental reads re-send overlapping messages by design, **every parsed transaction now includes a stable `smsId`** (the Android inbox message id) so the backend can deduplicate.

Frontend files changed (for reference): `lib/sms-reader.ts`, `lib/sms-sync-task.ts`, `lib/parse-sms.ts`.

---

## 2. What this means for the backend

The incremental read **intentionally re-sends messages the backend has already stored.** This is safe **only if the backend deduplicates on `smsId`.** The good news: that logic already exists. This doc is mostly to (a) confirm it, and (b) fix one gap.

### How the endpoint currently works

```
server/routes.ts:1484  app.post('/api/transactions/sync-from-sms', authMiddleware, ...)
```

For each incoming transaction it builds a bulk op:

```ts
// server/routes.ts:1512-1526
if (smsId) {
  return {
    updateOne: {
      filter: { userId, smsId },
      update: { $setOnInsert: doc },
      upsert: true,
    },
  };
} else {
  // Fallback for manual or legacy sync without smsId
  return {
    insertOne: { document: doc },
  };
}
```

This is correct: when `smsId` is present, a re-sent message hits the same `(userId, smsId)` filter and is skipped (no duplicate). ✅

---

## 3. Required backend change — add a unique index on `(userId, smsId)`

**This is the one thing you must do.**

The upsert above prevents duplicates **only under a race-free sequence**. With `bulkWrite(..., { ordered: false })` and concurrent syncs (e.g. foreground sync + a retry firing together), two upserts for the same `(userId, smsId)` can both pass the "does it exist?" check and **both insert** — creating a duplicate. A unique index makes the database enforce it atomically.

Add this index to the `transactions` collection (run once, e.g. in your migration/startup index-ensure code):

```js
db.collection('transactions').createIndex(
  { userId: 1, smsId: 1 },
  {
    unique: true,
    // Only enforce uniqueness for docs that actually have an smsId, so manual/
    // legacy transactions (smsId: null) are not forced unique against each other.
    partialFilterExpression: { smsId: { $type: 'string' } },
  }
);
```

> ⚠️ Before creating the index, **de-duplicate existing rows** or the `createIndex` will fail. See section 5.

With this index in place, a duplicate upsert throws a duplicate-key error instead of inserting. Because the bulk write is `{ ordered: false }`, the rest of the batch still succeeds; you just need to not treat that specific error as a fatal failure (see section 4).

---

## 4. Recommended — handle duplicate-key errors gracefully in the response

`bulkWrite` with `ordered: false` throws a `MongoBulkWriteError` if any op hits the new unique index. The successful ops still commit, but the current code's `synced`/`skipped` math will be wrong (or it may 500). Wrap it so duplicates count as "skipped," not "failed":

```ts
let result;
try {
  result = await (transactions as any).bulkWrite(ops, { ordered: false });
} catch (err: any) {
  // Duplicate-key (11000) from the unique index just means "already synced".
  // The write result is still on the error object; use it.
  if (err?.code === 11000 || err?.writeErrors) {
    result = err.result ?? err;
  } else {
    throw err;
  }
}

const synced   = (result.upsertedCount || 0) + (result.insertedCount || 0);
const skipped  = txs.length - synced;
return res.json({ synced, skipped, message: `${synced} synced, ${skipped} duplicates skipped` });
```

Net effect: re-sent messages are silently skipped, `synced` reflects only genuinely new transactions, and the endpoint never errors just because the client re-sent overlaps.

---

## 5. One-time cleanup before adding the unique index

If duplicates already exist in production (they may, because of the old `insertOne` fallback path), the `createIndex` will fail until you remove them. Collapse duplicates, keeping the oldest of each `(userId, smsId)` group:

```js
// Pseudocode — run once as a migration. Test on a copy first.
const dupes = await db.collection('transactions').aggregate([
  { $match: { smsId: { $type: 'string' } } },
  { $group: {
      _id: { userId: '$userId', smsId: '$smsId' },
      ids: { $push: '$_id' },
      count: { $sum: 1 },
  }},
  { $match: { count: { $gt: 1 } } },
]).toArray();

for (const d of dupes) {
  const [, ...remove] = d.ids;           // keep first, remove the rest
  await db.collection('transactions').deleteMany({ _id: { $in: remove } });
}
```

Then create the index from section 3.

---

## 6. Payload contract (what the client now sends)

`POST /api/transactions/sync-from-sms`

```jsonc
{
  "transactions": [
    {
      "merchant": "Swiggy",
      "amount": 349.0,
      "date": "2026-07-13T12:30:00.000Z",
      "isDebit": true,
      "category": "food",
      "description": "Rs 349 debited ... Swiggy ...",  // truncated SMS body
      "upiId": "AX-SBIINB",                             // sender address (optional)
      "smsId": "482"                                     // NEW — Android inbox _id, use for dedup
    }
  ]
}
```

- `smsId` is a **string** and is now present on all SMS-sourced transactions. It is unique per device inbox. Treat missing/null `smsId` as a manual/legacy transaction (do not force-unique those).
- The client may re-send any `smsId` it has sent before. That is expected and must be idempotent.

---

## 7. Checklist for the backend team

- [ ] De-duplicate existing `(userId, smsId)` rows (section 5).
- [ ] Add the partial unique index on `(userId, smsId)` (section 3).
- [ ] Wrap `bulkWrite` to treat duplicate-key errors as skips, not failures (section 4).
- [ ] Confirm `synced` / `skipped` counts are correct when the client re-sends overlaps.
- [ ] No response-shape change needed — `{ synced, skipped, message }` stays the same.

---

## 8. Summary

| | Before | After |
|---|---|---|
| SMS read | Newest 200, all senders → bank SMS missed | Everything since last sync (`minDate`) |
| Dedup key sent | `smsId` was **not** sent by the parser → fell into `insertOne` → duplicates | `smsId` sent on every SMS transaction |
| DB safety | Upsert only; race can duplicate | Partial unique index enforces it |

The frontend change is live. The backend needs the **unique index + graceful duplicate handling** so the now-expected re-sends stay idempotent.
