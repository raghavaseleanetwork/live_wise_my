# Bug #17 — Reminder notifications not delivered + wrong app icon: Backend Guide

**Audience:** Backend team
**Reported by:** Client, 2026-08-07 (with screenshots showing two different icons for the same app)
**Status:** Investigated and confirmed. **All fixes are backend-only.** No frontend/app changes are required.
**File to edit:** `server/routes.ts` (all changes), plus one optional index.
  
---

## 0. TL;DR — what to change

| # | Problem | Location | Severity |
|---|---|---|---|
| 1 | "3 days before" / "1 day before" reminders almost never fire | `routes.ts` ~3029 | **Critical** |
| 2 | FCM send failures are never detected — logs say "success" when nothing was delivered | `routes.ts` 3119, 3223 | **Critical** |
| 3 | Dead push tokens are never removed | `routes.ts` 3119, 3223 | High |
| 4 | Push notifications have no app icon set | `routes.ts` 3126, 3223 | High |
| 5 | A random third-party image is attached to every reminder | `routes.ts` 3084 | Medium |
| 6 | No `channelId` — user sound/vibration settings ignored | `routes.ts` 3126, 3223 | Medium |
| 7 | Reminders due during a server restart are skipped forever | `routes.ts` 3249 | Medium |
| 8 | `tokenType` sent by the client is discarded | `routes.ts` 1208 | Low |

**Confirm before starting:** the app side is already correct and needs no rebuild. The Android
notification icon drawables exist and are registered in the manifest — verified:

```
android/app/src/main/res/drawable-*/notification_icon.png        ✓ present
android/app/src/main/AndroidManifest.xml:25-28                   ✓ registered
android/app/src/main/res/values/colors.xml:6                     ✓ #4F46E5
```

The bug is that the **server never references them**.

---

## 1. Background — the two notification paths

The app delivers notifications two ways, and they behave differently:

| Path | Who creates it | Icon used | Code |
|---|---|---|---|
| **Local** | The app schedules it on the device | ✅ Correct app icon | `lib/notifications.ts` |
| **Server push** | Server → Firebase → device | ❌ Whatever FCM picks | `server/routes.ts` |

The client's screenshots show one notification with the correct logo (local) and one with a
different logo (server push). **This is the entire icon complaint.** Fixing the server payload
fixes it; nothing in the app needs to change.

---

## 2. Bug 1 — Advance reminders almost never fire (**start here**)

### Current code — `server/routes.ts` ~3018-3034

```ts
const msDiff = baseDate.getTime() - now.getTime();
const daysLeftRaw = msDiff / (24 * 60 * 60 * 1000);
const daysLeft = Math.max(0, Math.round(daysLeftRaw));

const reminderDays: number[] = Array.isArray(bill.reminderDaysBefore) && bill.reminderDaysBefore.length
  ? bill.reminderDaysBefore
  : [3, 1, 0];

if (!reminderDays.includes(daysLeft)) continue;

const billTimeWithinWindow =
  baseDate.getTime() >= now.getTime() - 60 * 1000 &&
  baseDate.getTime() <= windowEnd.getTime();          // windowEnd = now + 5 minutes

if (!billTimeWithinWindow && daysLeft !== 0) {

  continue;                                            // <-- kills the reminder
}
```

### Why it fails

`windowEnd` is `now + 5 minutes`. For a bill due in 3 days, `baseDate` is ~72 hours away, so
`billTimeWithinWindow` is **always false**, and the `continue` discards it. The only reminders
that survive are `daysLeft === 0`.

Verified by extracting this exact logic and running it:

```
due in exactly 3 days    → SKIP (daysLeft=3, due not within 5-min window)
due in 3 days + 2 hours  → SKIP (daysLeft=3, due not within 5-min window)
due in 1 day  + 6 hours  → SKIP (daysLeft=1, due not within 5-min window)
due today (in 2 hours)   → FIRE (daysLeft=0)
```

**Effect:** a user's `[3, 1, 0]` schedule behaves as `[0]`. This is the client's "reminders are
not coming" report.

### The fix

An advance reminder should fire at a sensible **time of day** on the correct day — not at the
bill's exact due timestamp. Replace the window check with a send-hour check:

```ts
// Advance reminders (daysLeft > 0) are day-based, not minute-based: they should
// arrive at a predictable hour on the right day, NOT only if the bill's due
// timestamp happens to land inside the 5-minute scheduler window. The old check
// compared against `now + 5 minutes`, which is never true for a bill days away,
// so every "3 days before" / "1 day before" reminder was discarded.
const REMINDER_SEND_HOUR = 9; // 09:00 local server time

let shouldSend: boolean;
if (daysLeft === 0) {
  // Same-day: keep the existing behaviour — fire near the actual due time.
  shouldSend =
    baseDate.getTime() >= now.getTime() - 60 * 1000 &&
    baseDate.getTime() <= windowEnd.getTime();

  // Also catch same-day bills whose time already passed while the server was
  // down or busy; the reminderLogs dedup below stops repeats.
  if (!shouldSend && baseDate.getTime() < now.getTime()) shouldSend = true;
} else {
  // Advance reminder: fire once, in the scheduler tick at the send hour.
  shouldSend = now.getHours() === REMINDER_SEND_HOUR && now.getMinutes() < 5;
}

if (!shouldSend) continue;
```

> The existing `reminderLogs` dedup (`{ userId, billId, channel, dayOffset }`, ~3042) already
> guarantees one send per bill per day-offset, so the 5-minute `now.getMinutes() < 5` band
> cannot produce duplicates even though the scheduler ticks every 60s.

**Decision needed:** `REMINDER_SEND_HOUR = 9` is a suggestion. If reminders should respect each
user's timezone, that hour must be computed per user — the current scheduler uses server time
only. Flag this back if per-user timezones are required.

---

## 3. Bug 2 — FCM failures are invisible (**fix alongside Bug 1**)

### Current code — `server/routes.ts` 3119-3138

```ts
await messaging.sendEachForMulticast({
  tokens,
  notification: { title, body, imageUrl },
  android: { notification: { imageUrl, priority: 'high' } },
  data: { type: 'reminder', billId: meta.billId, route: meta.route },
});
console.log(`[Push] Multi-device send to ${tokens.length} tokens for user ${user.email}`);
```

### Why it fails

`sendEachForMulticast` **resolves successfully even when every individual send fails.** Per-token
outcomes live in `response.responses[]`, which this code never reads. The log line prints
"Multi-device send to N tokens" unconditionally — so a 100% delivery failure and a 100% success
look **identical in the logs**.

This is not hypothetical. `lib/notifications.ts:168-180` documents a previous total push outage
(Expo tokens being sent to FCM) that stayed hidden for exactly this reason. The blindness was
never fixed.

### The fix

```ts
const response = await messaging.sendEachForMulticast({ /* ...payload... */ });

if (response.failureCount > 0) {
  const failures = response.responses
    .map((r, i) => ({ r, token: tokens[i] }))
    .filter((x) => !x.r.success);

  for (const f of failures) {
    console.error(
      `[Push] FAILED for ${user.email} token ${f.token.slice(0, 12)}…: ` +
      `${f.r.error?.code} ${f.r.error?.message}`
    );
  }
}

console.log(
  `[Push] Reminder for ${user.email}: ${response.successCount} delivered, ` +
  `${response.failureCount} failed (of ${tokens.length} tokens).`
);
```

**Apply this to BOTH send sites: line ~3119 (bills) and line ~3223 (medicines).**

---

## 4. Bug 3 — Dead push tokens are never removed

When a user reinstalls the app or clears data, FCM issues a **new** token. The old row stays in
`pushTokens` forever. Every future send includes it and fails — invisibly, because of Bug 2.
Over time most tokens for a user are dead.

Grep confirms no cleanup exists anywhere:

```
grep -n "invalid-registration-token|not-registered|deleteOne({ token" server/routes.ts
→ (no matches)
```

### The fix — inside the failure loop from Bug 2

```ts
// FCM tells us definitively when a token is gone. Anything else (network,
// quota, internal) is transient and must NOT delete the token.
const DEAD_TOKEN_CODES = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
];

const deadTokens = failures
  .filter((f) => DEAD_TOKEN_CODES.includes(f.r.error?.code ?? ''))
  .map((f) => f.token);

if (deadTokens.length) {
  await pushTokens.deleteMany({ token: { $in: deadTokens } });
  console.log(`[Push] Removed ${deadTokens.length} dead token(s) for ${user.email}.`);
}
```

> Only these three codes mean "this token is permanently gone". Deleting on a transient error
> (e.g. `messaging/server-unavailable`) would unregister a working device.

---

## 5. Bugs 4, 5, 6 — Wrong icon, random image, no channel (**one payload fix**)

### Current code — `server/routes.ts` 3084 and 3119-3137

```ts
const imageUrl = bill.imageUrl || `https://api.dicebear.com/7.x/shapes/png?seed=${bill.category || 'bill'}&backgroundColor=4f46e5`;

await messaging.sendEachForMulticast({
  tokens,
  notification: { title, body, imageUrl },
  android: {
    notification: {
      imageUrl,
      priority: 'high',
      // no icon
      // no channelId
      // no color
    },
  },
  data: { /* ... */ },
});
```

### Three problems

**4 — No `icon`.** The Android build ships `notification_icon` (verified present in all five
density folders and registered in `AndroidManifest.xml:25-28`). The payload never names it.

> **Worth understanding, because it explains the "sometimes right, sometimes wrong" behaviour:**
> the manifest's `default_notification_icon` only applies to **data-only** messages that the app
> itself renders. When the payload contains a `notification` block — as both send sites do — FCM
> builds the notification in the Android system process **while the app is backgrounded**, and in
> that path the manifest default is not reliably applied; an explicit `icon` in the payload is.
> That is why the same app produces the correct logo sometimes (local / foreground) and a
> different one at other times (server push while backgrounded), exactly as the screenshots show.
> Setting `icon` explicitly makes it deterministic in every case.

**5 — `api.dicebear.com` generates a random abstract shape** and attaches it as the notification's
large image. It is not the LifeWise logo, it is a third-party avatar generator. It also makes
notification rendering depend on an external service being reachable.

**6 — No `channelId`.** The app registers four channels for the user's sound/vibration
preferences (`lib/notifications.ts:17-25`):

```
"default"                      sound + vibration
"reminders_novibrate"          sound, no vibration
"reminders_silent"             silent, vibration
"reminders_silent_novibrate"   silent, no vibration
```

Server pushes name none, so Android uses its own default and the user's saved preference is
ignored for every server-sent reminder.

### The fix

```ts
// Do NOT generate a random avatar. dicebear returns an abstract shape that is
// not the app logo, and it made notification rendering depend on a third-party
// service. Only use an image the bill actually has.
const imageUrl = bill.imageUrl || undefined;

await messaging.sendEachForMulticast({
  tokens,
  notification: { title, body },
  android: {
    notification: {
      // Must match res/drawable-*/notification_icon.png, which the app already
      // ships and declares in AndroidManifest.xml. Without this FCM picks its
      // own icon, which is why the same app showed two different logos.
      icon: 'notification_icon',
      color: '#4F46E5',                  // matches res/values/colors.xml
      channelId: 'default',              // see note below
      priority: 'high',
      ...(imageUrl ? { imageUrl } : {}),
    },
  },
  data: {
    type: 'reminder',
    billId: meta.billId,
    route: meta.route,
  },
});
```

**Apply the same `icon` / `color` / `channelId` block to the medicine send at ~3223**, which
currently sets none of them:

```ts
// BEFORE (routes.ts:3223)
await messaging.sendEachForMulticast({
  tokens,
  notification: { title, body },
  data: { type: 'medication', route }
});

// AFTER
await messaging.sendEachForMulticast({
  tokens,
  notification: { title, body },
  android: {
    notification: {
      icon: 'notification_icon',
      color: '#4F46E5',
      channelId: 'default',
      priority: 'high',
    },
  },
  data: { type: 'medication', route },
});
```

> **On `channelId`:** hardcoding `'default'` fixes the icon and restores high-importance
> delivery, but always uses the sound+vibration channel. Honouring the user's actual preference
> requires the server to know it — those settings currently live only in the app's AsyncStorage
> (`@lifewise_reminder_settings`). **Decision needed:** either accept `'default'` for now, or the
> app must start syncing that preference to the server. Flag this back if per-user sound
> preference on server pushes is required — it is the one item in this document that would need a
> frontend change.

---

## 6. Bug 7 — Reminders are skipped when the server restarts

`server/routes.ts:2997-3249` runs the scheduler with `setInterval` inside the API process:

```ts
const REMINDER_CHECK_INTERVAL_MS = 60_000;
setInterval(async () => { /* ... */ }, REMINDER_CHECK_INTERVAL_MS);
```

There is no catch-up. If the process restarts (deploy, crash, host recycle) at the moment a
reminder was due, that reminder is **never sent** — `reminderLogs` only prevents duplicates, it
never detects a miss.

### Options

**A — Catch-up on the same day (simplest, recommended).** In the fix for Bug 1, the same-day
branch already includes:

```ts
if (!shouldSend && baseDate.getTime() < now.getTime()) shouldSend = true;
```

That alone recovers same-day reminders missed during downtime, because dedup stops repeats. For
advance reminders, widen the send-hour check to "at or after the send hour, if not already sent":

```ts
shouldSend = now.getHours() >= REMINDER_SEND_HOUR;
```

Dedup on `{ userId, billId, channel, dayOffset }` guarantees it still sends only once.

**B — Move to a real job scheduler** (BullMQ / Agenda / an external cron hitting an endpoint).
Correct long-term, especially if the API ever runs more than one instance — note that **today,
multiple instances would each run their own scheduler and send duplicate reminders**, and only
the `reminderLogs` dedup prevents it, racily.

**Decision needed:** A or B. A is a few lines; B is the right answer if you run more than one
API instance.

---

## 7. Bug 8 — `tokenType` is discarded

`server/routes.ts:1208`:

```ts
const { token, platform } = req.body as { token?: string; platform?: 'ios' | 'android' | 'web' };
```

The client explicitly sends a third field (`lib/notifications.ts:241`):

```ts
body: JSON.stringify({ token: pushToken, platform, tokenType: 'fcm' }),
```

It is dropped. Its purpose (documented at `lib/notifications.ts:238-241`) is to let the server
purge stale **Expo-format** tokens written by older builds — those look like
`ExponentPushToken[...]` and FCM rejects every one.

### The fix

```ts
const { token, platform, tokenType } = req.body as {
  token?: string;
  platform?: 'ios' | 'android' | 'web';
  tokenType?: 'fcm' | 'expo';
};

// ... inside the $set:
tokenType: tokenType || 'fcm',
```

Then run once to clear legacy rows:

```js
db.collection('pushTokens').deleteMany({ token: /^ExponentPushToken/ });
```

---

## 8. Recommended index

Every scheduler tick queries `reminderLogs` once per bill per channel. Add:

```js
db.collection('reminderLogs').createIndex({ userId: 1, billId: 1, channel: 1, dayOffset: 1 });
db.collection('pushTokens').createIndex({ userId: 1 });
```

---

## 9. Checklist

- [ ] **Bug 1** — replace the 5-minute window with the day/send-hour check (~3029). Decide `REMINDER_SEND_HOUR` and whether per-user timezones are needed.
- [ ] **Bug 2** — inspect `response.responses[]` and log `successCount` / `failureCount`. **Both** send sites (3119, 3223).
- [ ] **Bug 3** — delete tokens on the three permanent FCM error codes only.
- [ ] **Bug 4/5/6** — add `icon: 'notification_icon'`, `color: '#4F46E5'`, `channelId`; delete the dicebear URL (3084). **Both** send sites.
- [ ] **Bug 7** — pick option A or B.
- [ ] **Bug 8** — persist `tokenType`, purge `ExponentPushToken` rows.
- [ ] Add the two indexes.

---

## 10. How to verify

1. **Icon** — create a bill due today, wait for the push. The notification must show the LifeWise
   icon and no random coloured shape. Compare against a local reminder; they must now match.
2. **Advance reminders** — create a bill due in 3 days with `reminderDaysBefore: [3, 1, 0]`.
   At `REMINDER_SEND_HOUR` a reminder must arrive. Before this fix, none does.
3. **Failure visibility** — insert a junk token for a test user:
   ```js
   db.collection('pushTokens').insertOne({ userId: '<id>', token: 'invalid-token-test', platform: 'android' });
   ```
   The next send must log a `[Push] FAILED ... messaging/invalid-registration-token` line, and the
   row must be gone afterwards. Before this fix, the log says "success" and the row stays.
4. **Duplicates** — let the scheduler run several ticks across the send hour. Exactly one
   notification per bill per day-offset.

---

## 11. Summary

| | Before | After |
|---|---|---|
| Advance reminders | Discarded unless due time is within 5 min of a tick | Fire on the correct day at the send hour |
| Send failures | Logged as success; invisible | Per-token error logged with code |
| Dead tokens | Accumulate forever | Removed on permanent FCM errors |
| Icon | FCM default (wrong logo) | `notification_icon`, matching the app |
| Image | Random dicebear avatar | None, unless the bill has a real one |
| Channel | Unset | `default` (high importance) |
| Restart | Due reminders lost | Caught up (option A) |

**Everything above is `server/routes.ts`. No app rebuild or store release is required.**

The single exception is noted in §5: if server pushes must honour each user's *sound/vibration*
preference, the app would need to sync that setting to the server. That is a separate change and
is **not** required to fix the icon or the missing reminders.
