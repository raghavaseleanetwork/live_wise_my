# Notification Action Buttons & Custom Sound — Backend Requirements

**Audience:** Backend team
**Date:** 2026-08-17
**Status:** Frontend is **built and shipping**. Local notifications already show
the buttons and play the custom sound. **Push notifications do not**, because
two fields have to come from the server — see §2. That is the whole ask.

**Client request this answers:**
> *"When a notification happens there should be two buttons: Snooze — it will
> snooze for 10 minutes and then reappear. Done — it will just make the reminder
> done. I also need a specific notification sound, not the full/default one."*

---

## 0. TL;DR — the entire backend change is two fields on the push payload

```jsonc
{
  "notification": { "title": "...", "body": "...",
                    "sound": "reminder.wav" },          // ← 1. custom sound
  "data": {
    "type": "reminder",
    "billId": "...",
    "categoryId": "lifewise_reminder_actions",           // ← 2. shows buttons
    // ...your existing fields
  },
  "android": {
    "notification": { "channel_id": "default",
                      "click_action": "lifewise_reminder_actions" }
  },
  "apns": {
    "payload": { "aps": { "category": "lifewise_reminder_actions",
                          "sound": "reminder.wav" } }
  }
}
```

| # | Work | Size | Blocking? |
|---|---|---|---|
| 1 | Add the category identifier to reminder pushes (§2.1) | Trivial | **Yes** — no buttons on push without it |
| 2 | Set `sound: "reminder.wav"` on reminder pushes (§2.2) | Trivial | **Yes** — default sound otherwise |
| 3 | Accept `minutes` on the existing snooze action (§3) | Small — may already work | Likely already done |
| 4 | Re-fire a snoozed push after 10 min (§4) | Medium | No — client re-arms locally |

**No new endpoints.** Everything below is either a payload field or a small
change to the existing `POST /api/bills/:id/actions`.

---

## 1. What the frontend already does

Shipped in `lib/notifications.ts`, `lib/notification-actions.ts`,
`app/_layout.tsx`:

- Registers a notification **category** `lifewise_reminder_actions` with two
  actions: `SNOOZE_10_MIN` ("Snooze 10 min") and `MARK_DONE` ("Done").
- Both are `opensAppToForeground: false` — pressing a button runs the handler in
  the background and dismisses the notification **without launching the app**.
- Every locally-scheduled notification sets that category, so buttons already
  appear on all local reminders today.
- Sound: `reminder.wav`, set on notification content (iOS) and on every Android
  channel.
- Button handling (`lib/notification-actions.ts`) runs with no React tree — it
  reads the auth token straight from AsyncStorage.

### What each button does today

| Button | User's own bill (`type: 'reminder'`) | Family Hub reminder |
|---|---|---|
| **Snooze** | `POST /api/bills/:id/actions` `{action:'snooze', days:0, minutes:10}` **and** re-arms a local notification in 10 min | Re-arms a local notification in 10 min (family reminders are projected, not stored as bills) |
| **Done** | `POST /api/bills/:id/actions` `{action:'paid'}` | Marks the underlying record done via its record kind (see §3.2) |

---

## 2. What we need from the server

### 2.1 Category identifier — makes the buttons appear on push

**A push without this arrives with no buttons at all.** The category is
registered client-side; the push just has to name it.

The literal string, which must match exactly:

```
lifewise_reminder_actions
```

Where to put it depends on your send path:

- **FCM v1 (Android)** — `android.notification.click_action`, **and** also
  include `categoryId` in the `data` block (belt and braces; some client
  versions read it from data).
- **APNs (iOS)** — `apns.payload.aps.category`.
- **expo-server-sdk** — set `categoryId: 'lifewise_reminder_actions'` on the
  message. Expo maps it to both platforms for you. This is the simplest option
  if you are already using Expo push.

Apply it to reminder-type pushes: `type: 'reminder'`, `'family-reminder'`,
`'medication'`. **Do not** apply it to informational pushes (`caregiver-invite`,
silent `sync` events) — a Snooze button on an invite makes no sense.

### 2.2 Custom sound

```
"sound": "reminder.wav"
```

- **Filename only, no path and no extension change.** A path silently falls back
  to the system default.
- **FCM** — `android.notification.sound: "reminder.wav"`. Note that on Android 8+
  the **channel's** sound wins; the client already sets it on its channels, so
  this field mostly matters for older devices.
- **APNs** — `apns.payload.aps.sound: "reminder.wav"`.
- **expo-server-sdk** — `sound: 'reminder.wav'`.

⚠️ **The audio file ships inside the app binary, not from the server.** You only
send the filename. If a build hasn't bundled it yet, the OS falls back to the
default sound — no error, no crash. See `assets/sounds/README.md`.

### 2.3 Payload fields the Done button needs

The Done handler reads these from `data` to know *what* to mark done. Most are
already being sent; listed so nothing gets dropped:

```jsonc
// user's own bill
{ "type": "reminder", "billId": "<id>" }

// Family Hub reminder — all three required
{ "type": "family-reminder",
  "memberId": "<id>", "sourceKind": "checkin", "sourceId": "<recordId>" }
```

`sourceKind` must be one of: `appointment`, `family-bill`, `task`, `travel`,
`routine`, `checkin`, `fitness`. (`medicine-stock` and `subscription` have no
"done" concept — Snooze still works, Done is a no-op. That is intentional: a
stock level isn't completed, and a subscription renews regardless.)

**A push missing these still shows both buttons, but Done silently does
nothing.** Worth checking your reminder pushes carry them.

---

## 3. `POST /api/bills/:id/actions` — confirm `minutes` is honoured

The client already calls this for the Snooze button:

```jsonc
POST /api/bills/:id/actions
{ "action": "snooze", "days": 0, "minutes": 10 }
```

The app has sent `minutes` for a while, but with `days: 0`. **Please confirm the
server computes the snooze from `minutes` when `days` is 0** rather than
treating `days: 0` as "no snooze" and ignoring the row. If it currently only
reads `days`, a 10-minute snooze silently does nothing server-side (the local
re-arm still works, so it would look fine on the device that pressed it, and be
wrong everywhere else).

`{ "action": "paid" }` for Done is unchanged and already works.

---

## 4. Optional: server-side re-fire after snooze

The client re-arms its own local notification 10 minutes out, so **Snooze works
today with no backend change**. But a local re-arm only exists on the device
that pressed the button — if the user snoozes on their phone, a tablet won't
show the reminder again, and the re-armed copy is lost on reinstall.

If you want snooze to be device-independent: when a snooze lands, schedule the
push to re-fire at `snoozedUntil`. Same payload as the original, including the
category and sound.

Not required. Flagging it because "snooze didn't come back" is the kind of thing
that gets reported as a bug months later.

---

## 5. How to verify

1. Send a reminder push with `categoryId: 'lifewise_reminder_actions'` → the
   notification shows **Snooze 10 min** and **Done** buttons.
2. Press **Done** on a `type: 'reminder'` push → confirm the bill is marked paid
   server-side, and that **the app did not open**.
3. Press **Snooze** → confirm `POST /api/bills/:id/actions` arrives with
   `minutes: 10`, and that the reminder reappears ~10 minutes later.
4. Send a `family-reminder` push with `memberId` + `sourceKind` + `sourceId`,
   press **Done** → confirm the underlying record is marked done.
5. Confirm the custom sound plays — **on a fresh install**. See the caveat below.
6. Send a `caregiver-invite` push → confirm it has **no** buttons.

> ⚠️ **Sound verification must be on a fresh install.** An Android channel's
> sound is fixed at creation and cannot be changed afterwards. A device that ran
> an older build already has the channels and will keep the old sound
> regardless of what you send. Uninstall/reinstall, or test on a clean device.

---

## 6. Related documents

- `FAMILY-REMINDERS-HOME-backend-requirements.md` §4 — server-side scheduling
  and push for Family Hub reminders. **These buttons are most valuable there**,
  since that is where reminders are most frequent.
- `PUSH-NOTIFICATIONS-backend-requirements.md` — the existing push setup.
- `BUG-17-notifications-not-delivered-and-wrong-icon.md` — prior notification work.
- Frontend: `lib/notifications.ts` (category + sound registration),
  `lib/notification-actions.ts` (button handling),
  `assets/sounds/README.md` (the sound asset).
