# Push Notifications — Backend Requirements

**Audience:** Backend team
**Date:** 2026-08-01
**Owner (frontend):** app team
**Status of frontend:** ✅ Fixed and merged. Details in §3. **Nothing works until §4 ships.**

**Related, read alongside:**
- `FAMILY-HUB-NOTIFICATIONS-backend-requirements.md` — the Family Hub notification gap
- `app docs/FAMILY_REMINDERS_BACKEND_SPEC.md` — the `GET /api/reminders/family` projection
- `app docs/FAMILY_RECORDS_PERSISTENCE_SPEC.md` — persisting family records (**hard prerequisite** for §6)
- `CAREGIVER-SYSTEM-backend-requirements.md` — caregiver fan-out

---

## 1. Executive summary

**Push notifications have never worked. Not one has ever been delivered.**

This is not a partial failure or a flaky-delivery problem. Every push send in
production has failed, for every user, for every notification type, since the
feature was written.

The cause is a single type mismatch: **the app registered an *Expo* push token,
and the server sends through *raw Firebase*.** FCM cannot accept an Expo token
and rejects all of them.

It stayed invisible because of how the failure surfaces — see §2.3. The server
logs a **success** line on total failure.

| | Before | After frontend fix | After backend fix (§4) |
|---|---|---|---|
| Token registered | `ExponentPushToken[…]` | **native FCM token** | native FCM token |
| FCM accepts it | ❌ never | ✅ | ✅ |
| Failures visible in logs | ❌ logged as success | ❌ still | ✅ |
| Stale bad tokens purged | ❌ | ❌ | ✅ |
| Push actually delivered | ❌ | ⚠️ new installs only | ✅ |

> ⚠️ **The frontend fix alone is not enough.** Every token currently in
> `push_tokens` is an unusable Expo token. Until §4.1 purges them, existing users
> keep failing — they only recover when the app re-registers, and the dead rows
> stay forever.

---

## 2. Root cause

### 2.1 What the client sent

`lib/notifications.ts` called:

```ts
const expoToken = (await Notifications.getExpoPushTokenAsync()).data;
// → "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
```

That is a handle for **Expo's** push relay (`https://exp.host/--/api/v2/push/send`).
It is meaningful **only** to Expo's servers.

### 2.2 What the server does with it

`server/routes.ts:3085` and `:3189`:

```ts
await messaging.sendEachForMulticast({ tokens, notification: {...}, data: {...} });
```

`messaging` is `firebase-admin`. FCM's API accepts **only** native FCM
registration tokens. Given `ExponentPushToken[...]` it returns, per token:

```
messaging/invalid-registration-token
```

We confirmed the server has **no** Expo fallback anywhere — no `expo-server-sdk`
dependency, no `exp.host` call, no `ExponentPushToken` handling. So there was no
path by which these tokens could ever have been delivered.

### 2.3 Why nobody noticed — read this one carefully

**`sendEachForMulticast` does not throw when sends fail.** It resolves
successfully and reports per-token outcomes inside the result:

```ts
const r = await messaging.sendEachForMulticast({...});
// r.successCount  === 0
// r.failureCount  === tokens.length
// r.responses[i].error.code === 'messaging/invalid-registration-token'
```

The current code **never reads the return value**. So:

- the `try/catch` at `routes.ts:3106` never fires — there is nothing to catch;
- and `routes.ts:3104` then logs

  ```
  [Push] Multi-device send to 3 tokens for user someone@example.com
  ```

That line prints **on 100% failure**. It counts tokens it *attempted*, not
tokens it *delivered*. Any log review would have concluded push was healthy.

**This is the single most important thing to fix after the token itself.** A
correct token with unchecked results just means the next failure is invisible too.

### 2.4 What was NOT the problem

Ruled out during the audit, so nobody re-investigates:

- ✅ `google-services.json` present, project `lifewise-6e740`, package `com.lifewise`
- ✅ `server/firebase-service-account.json` present, **same** project `lifewise-6e740`
- ✅ `firebase-admin@^13.0.2` installed
- ✅ `expo-notifications@^0.32.16` installed, plugin configured in `app.json`
- ✅ Android channels correctly created (all four variants)
- ✅ Permission request flow correct
- ✅ `POST /api/push-token` correctly stores and upserts

Configuration was never the issue. It was the token type, and only that.

---

## 3. Frontend changes already made (no action needed — context only)

### 3.1 Native FCM token — `lib/notifications.ts`

```diff
- const expoToken = (await Notifications.getExpoPushTokenAsync()).data;
+ const devicePushToken = (await Notifications.getDevicePushTokenAsync()).data;
```

`getDevicePushTokenAsync()` returns the **native FCM registration token** on
Android and the **APNs token** on iOS — exactly what `firebase-admin` expects.

Also added: a `typeof … === 'string'` guard, since `.data` is typed as a union
(web push returns an object) and would otherwise POST `[object Object]`.

> **Contract note:** the app speaking FCM and the server speaking FCM must stay
> in lockstep. If you ever migrate the server to `expo-server-sdk`, this client
> line must change back **in the same release**. Only one can be true at a time.

### 3.2 New `tokenType` field on registration

`POST /api/push-token` now includes a discriminator:

```json
{
  "token": "fMEr…:APA91b…",
  "platform": "android",
  "tokenType": "fcm"
}
```

This exists **so you can purge the old rows** (§4.1). Without it there is no
reliable way to tell a stale Expo row from a live FCM one.

### 3.3 Notification tap routing — `app/_layout.tsx`

Taps are now resolved most-specific-first, with a generic fallback:

| `data.type` | Opens |
|---|---|
| `reminder` + `billId` | `/bill-details/<billId>` |
| `family-reminder` + `memberId` + `sourceKind` + `sourceId` | `/family-reminder/<composite id>` |
| `medication` + `memberId` + `medId` | `/medicine-details/<memberId>/<medId>` |
| `caregiver-invite` | `/caregiver-invites` |
| *anything with* `data.route` | that route |
| nothing matched | `/notifications` |

Two things to know:

1. **`medication` was previously unhandled.** The server has always sent
   `type: 'medication'` (`routes.ts:3192`), but the client only handled
   `reminder` and `family-reminder`. Tapping a medicine push did nothing.
2. **`data.route` is your escape hatch.** Include it and taps land correctly for
   a brand-new notification kind **with no client release**. Please set it on
   every push you add. See §5.2.

---

## 4. Backend changes required

### 4.1 🔴 P0 — Purge stale Expo tokens

Every row currently in `push_tokens` is unusable. Delete them:

```js
// One-off migration
db.push_tokens.deleteMany({ token: /^ExponentPushToken\[/ });
```

Clients re-register automatically on next launch (`_layout.tsx` calls
`registerForPushNotifications` on every authenticated start), so **no user
action is needed** — but until this runs, sends waste quota on tokens that
cannot succeed.

Then enforce it going forward, in `POST /api/push-token`:

```js
if (typeof token !== 'string' || token.startsWith('ExponentPushToken[')) {
  return res.status(400).json({ message: 'Expected a native FCM token' });
}
```

Reject rather than store. A stored bad token is a silent permanent failure for
that device.

### 4.2 🔴 P0 — Read the send result and prune dead tokens

**This is the fix that prevents the next silent outage.** Replace both call
sites (`routes.ts:3085` and `:3189`) with a shared helper:

```ts
/**
 * Sends to every device a user owns and prunes tokens FCM rejects.
 *
 * `sendEachForMulticast` RESOLVES even when every send fails — per-token errors
 * live in `responses[]`. Not reading them is what hid a total push outage.
 */
async function sendPushToUser(userId: string, payload: {
  title: string;
  body: string;
  data: Record<string, string>;
  imageUrl?: string;
}): Promise<{ sent: number; failed: number }> {
  const messaging = getFirebaseMessaging();
  if (!messaging) {
    console.warn('[Push] Firebase not configured; skipping send.');
    return { sent: 0, failed: 0 };
  }

  const tokenDocs = await pushTokens
    .find({ userId })
    .project({ token: 1, _id: 0 })
    .toArray();
  const tokens = tokenDocs.map((t: any) => t.token).filter(Boolean);
  if (!tokens.length) return { sent: 0, failed: 0 };

  // FCM caps multicast at 500 tokens per call.
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

  let sent = 0, failed = 0;
  const dead: string[] = [];

  for (const chunk of chunks) {
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',        // MUST match the client channel — see §5.1
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
        },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
      // All values MUST be strings — see §5.3.
      data: payload.data,
    });

    sent += res.successCount;
    failed += res.failureCount;

    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code;
      console.error('[Push] send failed', { code, message: r.error?.message });
      // Permanently invalid → remove. Do NOT prune on transient errors
      // (`unavailable`, `internal`, quota) or you delete good tokens
      // during an FCM incident.
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-argument'
      ) {
        dead.push(chunk[i]);
      }
    });
  }

  if (dead.length) {
    await pushTokens.deleteMany({ userId, token: { $in: dead } });
    console.log(`[Push] Pruned ${dead.length} dead token(s) for ${userId}`);
  }

  console.log(`[Push] user=${userId} sent=${sent} failed=${failed}`);
  return { sent, failed };
}
```

> ⚠️ **Delete the old success log.** `[Push] Multi-device send to N tokens`
> (`routes.ts:3104`) is actively misleading — it reports attempts as successes.
> Log `sent`/`failed` as above instead.

### 4.3 🟠 P1 — Do not let a push failure mark a reminder as delivered

Currently a `reminder_logs` row is written after the send regardless of outcome,
so a failed push is never retried and the user simply never hears about that
bill.

Recommendation: keep writing the log for the **in-app** row (which did succeed),
but record the push outcome separately so a genuine failure is diagnosable:

```js
await reminderLogs.insertOne({
  userId, billId, channel, dayOffset,
  sentAt: new Date(),
  push: { sent, failed },   // NEW
});
```

Full retry logic is out of scope here — visibility first.

### 4.4 🟠 P1 — Replace `setInterval` with a real scheduler

`startReminderScheduler()` (`routes.ts:2963`) is a bare `setInterval` inside the
web process. Consequences:

- **Dies with the process.** A deploy or crash during a reminder's 5-minute
  window means those reminders are **permanently** missed — `reminder_logs`
  prevents replay, and the window has passed.
- **Fires N times on N instances.** If the API is ever scaled past one instance,
  every user gets duplicate pushes. The `reminder_logs` dedupe is
  read-then-write with no unique index, so concurrent instances race straight
  through it.
- **Scans every unpaid bill for every user, every 60 seconds**, with no
  date-bounded query.

Minimum hardening, in priority order:

1. **Add a unique index** — this alone stops multi-instance duplicates:
   ```js
   db.reminder_logs.createIndex(
     { userId: 1, billId: 1, channel: 1, dayOffset: 1 },
     { unique: true }
   );
   ```
   Then treat a duplicate-key error as "already sent" and skip.
2. **Bound the query** — only load bills whose due date is near, not all of them.
3. Move to a real job runner (Agenda / BullMQ / an external cron hitting a
   protected endpoint) so schedules survive restarts.

### 4.5 🟡 P2 — Respect user notification preferences

`settings.reminderSettings` (`soundEnabled`, `vibrationEnabled`) is stored
server-side and honoured for **local** notifications only. Server pushes ignore
it, so a user who turned sound off still gets a sounding push.

When sending, read the user's settings and set:
- `android.notification.channelId` → `default` / `reminders_silent` /
  `reminders_novibrate` / `reminders_silent_novibrate` (exact ids in §5.1)
- `apns.payload.aps.sound` → omit entirely when sound is off

---

## 5. Payload contract — follow exactly

### 5.1 Android channel IDs

The client pre-creates exactly four channels (`lib/notifications.ts:15-23`).
`android.notification.channelId` **must** be one of:

| ID | Sound | Vibration |
|---|---|---|
| `default` | ✅ | ✅ |
| `reminders_novibrate` | ✅ | ❌ |
| `reminders_silent` | ❌ | ✅ |
| `reminders_silent_novibrate` | ❌ | ❌ |

> ⚠️ **An unknown `channelId` means Android silently drops the notification on
> Android 8+.** Not a warning — a total drop. If you send `channelId: 'bills'`,
> nothing arrives and nothing errors.

Channel sound/vibration is **immutable after creation**, which is why there are
four rather than one mutable channel. Do not invent new IDs without a matching
client change.

### 5.2 Always include `route`

Every push should carry a `data.route` the client can navigate to. This is what
lets you add notification kinds without a client release (§3.3).

### 5.3 All `data` values must be strings

FCM rejects the whole message if any `data` value is a number, boolean, null, or
object.

```js
// ❌ rejected — amount is a number
data: { type: 'reminder', amount: 2350, billId: id }

// ✅
data: { type: 'reminder', amount: '2350', billId: String(id) }
```

### 5.4 Reference payloads

**Bill reminder**
```json
{
  "notification": { "title": "Electricity Bill", "body": "Your Electricity Bill is due today." },
  "android": { "priority": "high", "notification": { "channelId": "default" } },
  "data": {
    "type": "reminder",
    "billId": "665f…",
    "route": "/bill-details/665f…"
  }
}
```

**Medicine dose**
```json
{
  "notification": { "title": "Time for Papa's medicine", "body": "Take Metformin (1 tablet) - Morning" },
  "android": { "priority": "high", "notification": { "channelId": "default" } },
  "data": {
    "type": "medication",
    "memberId": "665a…",
    "medId": "med_17…",
    "route": "/medicine-details/665a…/med_17…"
  }
}
```
> `memberId` and `medId` are **required** — the client needs both to route.

**Family Hub reminder** (§6)
```json
{
  "notification": { "title": "Doctor Appointment · Papa", "body": "Cardiology check-up in 1 day" },
  "android": { "priority": "high", "notification": { "channelId": "default" } },
  "data": {
    "type": "family-reminder",
    "memberId": "665a…",
    "sourceKind": "appointment",
    "sourceId": "apt_17…",
    "route": "/family-reminder/fam:appointment:665a…:apt_17…"
  }
}
```
> All three of `memberId` / `sourceKind` / `sourceId` are required — the client
> rebuilds the composite id from them via `makeFamilyReminderId`.

**Caregiver invite** (§7)
```json
{
  "notification": { "title": "Caregiver invite", "body": "Asha invited you to help care for Papa." },
  "android": { "priority": "high", "notification": { "channelId": "default" } },
  "data": { "type": "caregiver-invite", "inviteId": "inv_…", "route": "/caregiver-invites" }
}
```

**Silent sync** (no visible notification — already handled by the client)
```json
{
  "android": { "priority": "high" },
  "data": { "type": "sync", "memberId": "665a…" }
}
```
> Send **`data` only, no `notification` block**, or the user sees a blank alert.

---

## 6. Coverage gap: most Family Hub reminders cannot push at all

You asked for *all* notifications to be push. Today only **two** things push:

| Notification | Pushes? | Why |
|---|---|---|
| Bill / subscription reminders | ✅ | server-side (`bills`) |
| Family **medicine** reminders | ✅ | server-side (on `family_members`) |
| Family appointments, bills, tasks, routines, check-ins, travel, documents, subscriptions, expenses, health logs, stock | ❌ | **device-only AsyncStorage** |
| Caregiver invites & alerts | ❌ | no fan-out exists (§7) |

This is **structural, not a bug**. Those 11 features live only in the user's
phone storage (`lib/family-records.ts`). The server has never seen them, so it
cannot schedule or push them. No amount of push fixing changes that.

**Prerequisite:** `app docs/FAMILY_RECORDS_PERSISTENCE_SPEC.md` (persist the
records) → then `app docs/FAMILY_REMINDERS_BACKEND_SPEC.md` (project them at
`GET /api/reminders/family`) → then push them.

Note `GET /api/reminders/family` **does not exist yet** — it currently 404s, and
the client handles that by falling back to its local projection.

### ⚠️ Cutover warning — double-fire

The client keeps a **sticky** flag (`lib/family-reminders-api.ts`). The moment
`GET /api/reminders/family` returns a **non-empty** array, the client:

1. permanently stops scheduling family reminders locally, and
2. cancels the OS-pending ones it already queued.

So the ordering is strict:

> **The endpoint must not return real rows until server-side push for those same
> reminders is live in the same release.**

- Return rows **before** push works → the client stops scheduling, the server
  doesn't send → **users get nothing at all.**
- Ship push **without** the client flag latching → **every reminder fires twice.**

Returning `[]` is safe and does not trigger cutover — the client explicitly
treats an empty array as "server has nothing", falls back to local, and clears
any stale flag.

---

## 7. Coverage gap: caregiver notifications do not exist

Grepping the whole server for caregiver push fan-out returns **zero** results.
There are also **no `/api/caregiver*` routes at all**.

For "someone sends your family a notification" to work, a caregiver event must
resolve to **the other user's** `push_tokens` — a different account from the one
that triggered it. That is the piece nothing currently does.

Needed:
- caregiver invite → push to the invitee (`type: 'caregiver-invite'`)
- invite accepted → push to the inviter
- member reminder due → push to **all** connected caregivers, not just the owner
- emergency alert (missed medicine / no activity) → push to all caregivers

Currently emergency alerts fire a **local** notification on the primary user's
own device only (`app/family-emergency/[memberId].tsx`). Reaching anyone else's
phone is entirely backend work.

See `CAREGIVER-SYSTEM-backend-requirements.md`. **Open product question, please
confirm before building:** should *every* caregiver get *every* reminder, or
should it be per-caregiver opt-in? Don't guess — a 3am medicine alert to five
relatives is a support ticket.

---

## 8. Acceptance criteria

Push is "working" when all of these pass **on a real device with a dev build**
(`npx expo run:android` — `expo-notifications` does **not** run in Expo Go, so
none of this is testable there):

**P0 — the outage fix**
- [ ] `db.push_tokens.find({ token: /^ExponentPushToken\[/ }).count() === 0`
- [ ] New registrations store a native FCM token (no `ExponentPushToken[` prefix)
- [ ] `POST /api/push-token` rejects an Expo-format token with 400
- [ ] Logs show `sent=N failed=0` — and the old "Multi-device send to N tokens" line is gone
- [ ] A bill reminder arrives on a physical device **with the app closed**
- [ ] Tapping it opens that bill's detail screen
- [ ] A medicine reminder arrives, and tapping it opens the medicine detail screen
- [ ] Uninstall the app → send → the token is auto-pruned via `registration-token-not-registered`

**P1 — reliability**
- [ ] Unique index on `reminder_logs` exists
- [ ] Two server instances running simultaneously produce exactly **one** push
- [ ] Restarting the server mid-window does not permanently lose a reminder

**P2 — coverage**
- [ ] Sound-off preference produces a silent push (correct `channelId`)
- [ ] Family Hub reminders push (requires §6 chain)
- [ ] Caregiver events reach the *other* user's device (requires §7)

### Suggested smoke test

```js
// One-off, against a known-good device token from push_tokens
const messaging = getFirebaseMessaging();
const r = await messaging.sendEachForMulticast({
  tokens: ['<paste a real token>'],
  notification: { title: 'Test', body: 'Push is working' },
  android: { priority: 'high', notification: { channelId: 'default' } },
  data: { type: 'reminder', route: '/notifications' },
});
console.log(r.successCount, r.failureCount, JSON.stringify(r.responses, null, 2));
```

If `failureCount > 0`, `responses[0].error.code` names the exact problem.
**Always print `responses` — that is where the truth is.**

---

## 9. Priority order

1. **§4.1** — purge Expo tokens, reject them on write *(without this, nothing else matters)*
2. **§4.2** — read `responses[]`, prune dead tokens, fix the misleading log
3. **§3.3/§5** — confirm payloads match the contract (`channelId`, string `data`, `route`)
4. **§4.4** — `reminder_logs` unique index + bounded query
5. **§4.3** — record push outcome on the reminder log
6. **§4.5** — honour sound/vibration preferences
7. **§6** — Family Hub persistence → projection → push *(mind the cutover)*
8. **§7** — caregiver fan-out *(confirm the product question first)*

Steps 1–2 are small and unblock **all** push. Everything after is coverage.

---

## 10. Questions for the frontend team

Anything ambiguous here, ask before building — particularly:
- the §6 cutover ordering (getting it wrong means silence or double notifications)
- the §7 caregiver policy question
- any new `data.type` you want to add, so tap routing is handled
