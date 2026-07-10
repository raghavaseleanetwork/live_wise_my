# Backend Fix Guide — Bug #15 (Snooze never expires) & Bug #6 (Avatar upload)

**Audience:** Backend team
**Status:** Frontend fixes are already done for both. This document covers what's needed on the backend.
**File to edit:** `server/routes.ts`

---

## Bug #15 — Snoozed reminders never come back (overdue alert bug)

### What this feature is supposed to do
On the Home screen, overdue bills show as an alert. The user can **Snooze** one — meaning "stop showing me this for a while, then show it again automatically once that time is up."

### What's actually happening (confirmed by reading the full route file)

When the user taps Snooze, the app calls:

```
POST /api/bills/:id/actions   { action: 'snooze', minutes / days }
```

Handled at **`server/routes.ts:1916-1951`**. This part works correctly — it computes a `snoozedUntil` timestamp and saves:

```ts
{ $set: { status: 'snoozed', snoozedUntil: snoozedUntil.toISOString(), isPaid: false } }
```

**The bug:** nothing, anywhere in the codebase, ever changes `status` back from `'snoozed'` to `'active'` once `snoozedUntil` has passed. I searched the entire `server/routes.ts` file for any revert/expiry logic and there is none. The frontend's Home screen ([app/(tabs)/index.tsx:789-790](../app/(tabs)/index.tsx#L789)) already correctly filters out anything with `status === 'snoozed'`:

```ts
.filter((b) => !b.isPaid && !['paid', 'snoozed', 'cancelled'].includes(b.status))
.filter((b) => !dismissedReminderIds.includes(b.id))
```

So the frontend is doing exactly what it should with the data it's given — it's just that the data it's given is permanently stuck on `'snoozed'`. **Result: once a user snoozes a bill, it disappears from overdue alerts forever, even though the bill is still unpaid and the snooze period is long over.**

### The fix

The cleanest place to do this is inside the existing `GET /api/bills` handler at **`server/routes.ts:1546-1571`**, since that's the single place all bills pass through before reaching the app. Add a check that flips any expired snooze back to `active` before returning the list (and persist that flip to the database so it's fixed for good, not just patched in the response).

```ts
app.get('/api/bills', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const now = new Date();

    // Revert any snooze whose time has passed back to 'active'
    await bills.updateMany(
      {
        userId,
        status: 'snoozed',
        snoozedUntil: { $lte: now.toISOString() },
      },
      { $set: { status: 'active' } }
    );

    const list = await bills.find({ userId }).toArray();
    const out = list.map((b: any) => ({
      id: b._id.toString(),
      name: b.name,
      amount: b.amount,
      dueDate: b.dueDate,
      category: b.category || 'bills',
      isPaid: b.isPaid || false,
      icon: b.icon || 'flash',
      reminderType: (b.reminderType as ReminderType) || 'bill',
      repeatType: (b.repeatType as RepeatType) || 'monthly',
      status: (b.status as ReminderStatus) || 'active',
      snoozedUntil: b.snoozedUntil,
      reminderDaysBefore: b.reminderDaysBefore || [3, 1, 0],
      imageUrl: b.imageUrl,
      imageKey: b.imageKey,
      source: b.source,
    }));
    return res.json(out);
  } catch (err) {
    console.error('Get bills error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});
```

**Note on `snoozedUntil` type:** double-check whether `snoozedUntil` is stored as an ISO string (as the snooze-action route writes it, `.toISOString()`) consistently everywhere it's set — I found three separate places in the file that write `snoozedUntil` (`server/routes.ts:1587`, `1878`, `1935`). If any of them store a different format (e.g. a raw `Date` object instead of a string), the `$lte` string comparison above will silently misbehave. Worth a quick grep for `snoozedUntil =` / `snoozedUntil:` across the file before shipping this to confirm they're all consistent ISO strings.

**Optional but recommended — a scheduled job instead of (or in addition to) the on-read check above:** the fix above only reverts a snooze when the user happens to open the app and hit `GET /api/bills`. If you want the *reminder notification itself* to fire again once the snooze expires (not just the in-app alert), you'll want a background job (cron/scheduled task) that runs periodically (e.g. every 15 minutes) and does the same `updateMany` sweep across **all users**, not just the currently-logged-in one. Flagging this as a nice-to-have — the on-read fix above is the minimum needed to close the bug as reported.

### How to verify the fix
1. Snooze a bill for a short period (e.g. 1 minute, using the `minutes` field on the snooze action) via the app or directly:
   ```
   POST /api/bills/<id>/actions
   { "action": "snooze", "minutes": 1 }
   ```
2. Wait over a minute.
3. Call `GET /api/bills` (or just reopen/refresh the app).
4. **Before fix:** the bill's `status` stays `"snoozed"` forever.
5. **After fix:** the bill's `status` should now read `"active"` again, and it should reappear as an overdue alert on the Home screen (assuming its due date has passed and it isn't in the user's locally-dismissed list, which is a separate, already-working, on-device mechanism).

---

## Bug #6 — Avatar upload fails ("Failed avatar")

### What's already fixed on the frontend
I found and fixed a real bug in `lib/upload-avatar.ts`: the code was stripping the `file://` prefix off the photo's URI before uploading:

```ts
// OLD (buggy):
const cleanUri = uri.startsWith('file://') ? uri.replace('file://', '') : uri;
```

On Android, React Native's `FormData` needs that `file://` prefix intact to correctly read and stream the file — stripping it can cause the upload to silently fail or send a broken/empty file. This has been fixed; the app now sends the URI exactly as the image picker provides it. **No action needed here from the backend team** — mentioned for context so you know this half of the bug is already handled.

### What still needs backend confirmation

The upload route itself, **`server/routes.ts:1304-1337`**:

```ts
app.post(
  '/api/avatar',
  authMiddleware,
  upload.single('avatar'),
  async (req: any, res: any) => {
    try {
      if (!S3_BUCKET) {
        return res.status(500).json({ message: 'S3 bucket not configured. Set AWS_S3_BUCKET.' });
      }
      ...
```

This route requires an **AWS S3 bucket** to actually store the uploaded photo, configured via the `AWS_S3_BUCKET` environment variable (and implicitly `AWS_REGION`, referenced elsewhere in the file for the same S3 client).

**The issue:** I checked `.env.example` in this repo and `AWS_S3_BUCKET` / `AWS_REGION` are **not listed there at all** — meaning there's no documentation confirming these are actually set on the running server. If they're missing, every avatar upload will fail immediately with `"S3 bucket not configured. Set AWS_S3_BUCKET."`, regardless of the frontend fix.

### What we need from you
1. **Confirm** whether `AWS_S3_BUCKET` and `AWS_REGION` are set in the production/dev server's environment right now.
2. If they're **not set**: an AWS S3 bucket needs to be created (or an existing one designated) for avatar storage, with:
   - Public-read access for the uploaded objects (the route builds a public URL: `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/avatars/...`), or a CDN/CloudFront in front of it if public-read buckets aren't allowed under your AWS setup.
   - IAM credentials with `s3:PutObject` permission for the server process.
3. If they **are** already set: please do a live test — upload a photo through the app (or `POST /api/avatar` directly with a test image) and confirm you get back a working image URL. If it fails even with the bucket configured, check server logs around `console.error('Upload avatar error:', err)` (line 1333) for the actual AWS error (permissions, region mismatch, bucket policy, etc.) and share that with us.
4. **Please add `AWS_S3_BUCKET` and `AWS_REGION` to `.env.example`** once confirmed, so this doesn't stay undocumented for the next person who hits this bug.

### How to verify the fix (once confirmed configured)
1. In the app: Edit Profile → tap the avatar circle → pick a photo from gallery.
2. **Before fix:** `"Failed Upload: ..."` error, likely `"S3 bucket not configured"` or a broken-file error from the old `file://` stripping bug (now fixed on our side).
3. **After fix:** photo uploads successfully, avatar updates immediately in the app, and the returned URL (check `PUT /api/auth/me`'s response or `GET /api/auth/me`) should be a working `https://<bucket>.s3.<region>.amazonaws.com/avatars/...` link that loads as an image in a browser.

---

## Summary checklist

- [ ] **Bug #15:** Add the expired-snooze revert check to `GET /api/bills` (code above). Double-check `snoozedUntil` is stored as a consistent ISO string everywhere it's written (3 locations, listed above).
- [ ] **Bug #15 (optional):** Consider a scheduled job for snooze expiry so push notifications also re-fire, not just the in-app list.
- [ ] **Bug #6:** Confirm `AWS_S3_BUCKET` / `AWS_REGION` are set on the server. Set up the bucket + IAM permissions if missing.
- [ ] **Bug #6:** Live-test an avatar upload end-to-end and report back the result (success, or the exact server-side error if it still fails).
- [ ] **Bug #6:** Add `AWS_S3_BUCKET` / `AWS_REGION` to `.env.example` for future reference.

**Questions?** Ping the frontend owner of this feature before changing the `snoozedUntil` storage format, since three separate routes write to that field and any format change needs to stay consistent across all of them.
</content>
