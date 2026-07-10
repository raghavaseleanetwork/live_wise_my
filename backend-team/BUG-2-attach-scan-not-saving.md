# Bug #2 — Attach Scan photo never actually saves to the reminder

**Audience:** Backend team
**File to edit:** `server/routes.ts`
**Route:** `PUT /api/bills/:id`
**Exact location:** `server/routes.ts:1864-1879`

---

## What this feature is supposed to do

On the Bill/Reminder Detail screen, if a reminder has no photo attached yet, it shows an **"Attach Official Bill Scan"** button. Tapping it takes the user to the Scan Bill screen (already carrying the reminder's ID), lets them scan or upload a photo, and should save that photo onto the **existing** reminder — so next time they open Bill Detail, the photo is there instead of the "no scan attached" placeholder.

## What's actually happening (root cause confirmed by reading the full flow)

I traced this end-to-end across both the app and the server:

1. User taps "Attach Official Bill Scan" → app navigates to `scan-bill.tsx` with `?billId=<id>` in the URL ([app/bill-details/[billId].tsx:465](../app/bill-details/[billId].tsx#L465)).
2. User scans/uploads a photo → app calls `POST /api/bills/scan/preview`. This route (`server/routes.ts:1599` onward) uploads the image to S3 and returns a `preview` object that **does correctly include** `imageUrl` and `imageKey` (confirmed at both success paths: `server/routes.ts:1725-1726` and `server/routes.ts:1781-1782`).
3. Because a `billId` was present, the app then calls `PUT /api/bills/:id` with that entire preview object spread into the request body, including `imageUrl` ([app/scan-bill.tsx:238-250](../app/scan-bill.tsx#L238)):
   ```ts
   const res = await fetch(url, {
     method: 'PUT',
     ...
     body: JSON.stringify({
       ...editingData,   // includes imageUrl, imageKey from the scan preview
       status: existingBill.status,
       isPaid: existingBill.isPaid
     }),
   });
   ```
4. **The bug is here.** `PUT /api/bills/:id` (`server/routes.ts:1864-1879`) explicitly whitelists which fields it will actually update:
   ```ts
   const update: any = {};
   if (body.name !== undefined) update.name = body.name;
   if (body.amount !== undefined) update.amount = Number(body.amount);
   if (body.dueDate !== undefined) update.dueDate = body.dueDate;
   if (body.category !== undefined) update.category = body.category;
   if (body.isPaid !== undefined) update.isPaid = body.isPaid;
   if (body.icon !== undefined) update.icon = body.icon;
   if (body.reminderType !== undefined) update.reminderType = body.reminderType;
   if (body.repeatType !== undefined) update.repeatType = body.repeatType;
   if (body.status !== undefined) update.status = body.status;
   if (body.snoozedUntil !== undefined) update.snoozedUntil = body.snoozedUntil;
   if (body.reminderDaysBefore !== undefined) update.reminderDaysBefore = body.reminderDaysBefore;
   ```
   **`imageUrl` and `imageKey` are not in this list.** The request succeeds (`200 OK`, `{ ok: true }`), so the app thinks it worked and returns the user to Bill Detail — but the photo URL was silently discarded and never written to the database.

## Real-world effect

The user scans a bill, sees no error, gets returned to Bill Detail — and the screen **still shows "Digital Summary Available" / "Attach Official Bill Scan"** as if nothing happened, because the bill's `imageUrl` in the database is still empty. It looks completely broken even though every other part of the pipeline (upload, OCR extraction, S3 storage) worked correctly.

## The fix

Add two lines to the existing whitelist in `PUT /api/bills/:id` (`server/routes.ts:1864-1879`), following the exact same pattern as every other field there:

```ts
app.put('/api/bills/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;
    const update: any = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.amount !== undefined) update.amount = Number(body.amount);
    if (body.dueDate !== undefined) update.dueDate = body.dueDate;
    if (body.category !== undefined) update.category = body.category;
    if (body.isPaid !== undefined) update.isPaid = body.isPaid;
    if (body.icon !== undefined) update.icon = body.icon;
    if (body.reminderType !== undefined) update.reminderType = body.reminderType;
    if (body.repeatType !== undefined) update.repeatType = body.repeatType;
    if (body.status !== undefined) update.status = body.status;
    if (body.snoozedUntil !== undefined) update.snoozedUntil = body.snoozedUntil;
    if (body.reminderDaysBefore !== undefined) update.reminderDaysBefore = body.reminderDaysBefore;
    if (body.imageUrl !== undefined) update.imageUrl = body.imageUrl;       // ADD THIS
    if (body.imageKey !== undefined) update.imageKey = body.imageKey;       // ADD THIS
    const result = await bills.updateOne({ _id: toId(id), userId: (req as any).userId }, { $set: update });
    ...
```

That's the entire fix — no schema migration needed, since `imageUrl`/`imageKey` are already valid fields on the `bills` collection (they're written correctly by `POST /api/bills/scan/commit` for brand-new bills, at `server/routes.ts:1829-1837` onward — this bug **only** affects updating an *existing* bill, not creating a new one from scratch).

## How to verify the fix

1. Pick (or create) a bill/reminder that has no `imageUrl` set.
2. Call `PUT /api/bills/<id>` directly with a body like:
   ```json
   { "imageUrl": "https://example-bucket.s3.amazonaws.com/test.jpg", "imageKey": "bills/test/test.jpg" }
   ```
3. **Before fix:** `GET /api/bills` afterward still shows `imageUrl: null` for that bill — confirms the field was dropped.
4. **After fix:** `GET /api/bills` shows the `imageUrl` you sent — confirms it's now persisted.
5. End-to-end: in the app, open a reminder with no scan attached → tap "Attach Official Bill Scan" → scan any bill photo → go back to Bill Detail → it should now show "Official Bill" with the photo, instead of "Digital Summary Available."

## Scope check — confirmed this is backend-only

The frontend is already sending the correct data (`editingData` from the scan preview genuinely includes `imageUrl`/`imageKey`) and the scan/upload/OCR pipeline works correctly end-to-end. This is purely a missing field in one server-side whitelist — no frontend changes are needed once this ships.
</content>
