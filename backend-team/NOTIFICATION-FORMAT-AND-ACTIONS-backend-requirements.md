# Notification Title Format & Action Buttons — Backend Requirements

**Created:** 2026-08-19
**Status:** 🟡 Frontend complete. Backend push payloads must be updated to match.
**Priority:** High — client-reported, user-visible on every notification.

---

## 0. TL;DR for the backend team

Every push you send for a reminder needs **three payload changes**:

1. **`notification.title`** must follow the new format (§2).
2. **`data.categoryId`** must be `"lifewise_reminder_actions"` — without it, **no buttons appear at all**.
3. **`data`** must carry the routing fields in §4 so the app knows which reminder was acted on.

Everything else — the buttons, the popups, the mark-done logic — is already built and shipped in the app.

---

## 1. Why this is needed

Two client reports:

> "The notification title should start with 'Reminder:' … If the reminder comes
> from a Family Hub, the notification should clearly indicate which Family Hub
> it came from."

> "In this notification buttons are not working — it needs to open in-app snooze
> pop-up, or if user selects cancel, then it can cancel inside of app."

A user glancing at a lock screen currently cannot tell their own reminder apart
from one belonging to a family member, and the action buttons did nothing
visible.

---

## 2. Title format (REQUIRED)

### Normal reminder — the user's own

```
Reminder: <reminder title>
```

**Example:** `Reminder: Doctor Appointment`

### Family Hub reminder

```
Family Hub: <member name> – <reminder title>
```

**Example:** `Family Hub: Papa – Doctor Appointment`

⚠️ The separator is an **en dash (–, U+2013)**, not a hyphen, matching the
client's written example.

### About the hub name — all values are real, dynamic data

"Smith Family" in the original request was only an **example**, not a literal
string. Everything in the title is read from real data at send time:

| Part | Source | Example |
|---|---|---|
| Hub identity | The family member's `name` | `Papa` |
| Reminder title | The record's own title | `Doctor Appointment` |

Nothing is hardcoded or placeholder text.

**Why the member name is the hub identity:** we searched the client codebase for
`familyName`, `hubName`, `householdName`, `groupName` — **zero matches**. A
family member carries `name`, `relationship`, and `avatarUrl`; the user carries
`name`. There is no named-household concept anywhere in the app or the API, so
the member's name is the real hub identity that exists today.

#### If you add a household name later

The client function already accepts one and will use it automatically:

```ts
familyReminderNotificationTitle(memberName, reminderTitle, familyName?)
// hub = familyName?.trim() || memberName
```

To light it up, return a household name from `GET /api/family` and include it in
push payloads as `data.familyName`. The title becomes
`Family Hub: Smith Family – Doctor Appointment` with no format change — but a UI
for the owner to set that name is also needed, so treat it as a **separate
feature**, not part of this work.

**For now, `Family Hub: <member name> – <title>` is the complete and correct
implementation.**

### Notifications the backend composes today

`server/routes.ts` (~line 3197) currently sends:

```js
const title = `Time for ${member.name}'s medicine`;
```

This must become:

```js
const title = `Family Hub: ${member.name} – ${med.name}`;
```

**This one is backend-only.** When a push includes a `notification` block, the
OS renders that title directly — the app never sees it and cannot rewrite it.
Any reminder delivered this way will keep the old format until you change it.

---

## 3. Action buttons — what the app already does

The app registers a notification **category** with two buttons:

| Button | Action ID |
|---|---|
| `Snooze 10 min` | `SNOOZE_10_MIN` |
| `Done` | `MARK_DONE` |

**Buttons only render if the push declares the category.** See §4.

### The complete flow (implemented, per the client's spec)

| User does | App does |
|---|---|
| **Taps the notification body** | Opens the app → reminder screen → popup offering **Snooze / Mark done** |
| **Taps `Snooze 10 min`** | Opens the app → snooze picker (bills) or re-arms +10 min with confirmation (Family Hub) |
| **Taps `Done`** | Opens the app → **confirmation dialog** → marks done only after the user confirms |

**There is no Cancel button in these popups** — client decision, 2026-08-19. The
popups offer only the real actions. Tapping outside the dialog still dismisses
it, so the user is never trapped, but nothing presents "cancel" as a choice.

All three entry points open the app (`opensAppToForeground: true`). This was a
deliberate reversal of the previous silent-background behaviour: work was
happening but nothing on screen confirmed it, which users read as broken.

`Done` deliberately asks for confirmation rather than acting immediately —
arriving from a background button press means the user has not seen the
reminder's details.

---

## 4. Push payload contract (REQUIRED)

### Bill / personal reminder

```json
{
  "to": "<expo or fcm token>",
  "title": "Reminder: Electricity Bill",
  "body": "₹1,240 is due today.",
  "sound": "reminder.wav",
  "data": {
    "categoryId": "lifewise_reminder_actions",
    "type": "reminder",
    "billId": "665f0a1c2d3e4f5a6b7c8d9e"
  }
}
```

### Family Hub reminder

```json
{
  "to": "<expo or fcm token>",
  "title": "Family Hub: Papa – Doctor Appointment",
  "body": "Appointment with Dr. Mehta at 4:00 PM",
  "sound": "reminder.wav",
  "data": {
    "categoryId": "lifewise_reminder_actions",
    "type": "family-reminder",
    "memberId": "665f0a1c2d3e4f5a6b7c8d9e",
    "sourceKind": "appointment",
    "sourceId": "appt_123"
  }
}
```

### Field reference

| Field | Required | Notes |
|---|---|---|
| `data.categoryId` | ✅ | **Must be `"lifewise_reminder_actions"`.** Without it the push arrives with **no buttons at all**. This is the single most common cause of "buttons not working". |
| `data.type` | ✅ | `"reminder"` or `"family-reminder"`. Selects which screen opens. |
| `data.billId` | ✅ for `reminder` | Which bill. Without it the app cannot open the right screen. |
| `data.memberId` | ✅ for `family-reminder` | Which family member. |
| `data.sourceKind` | ✅ for `family-reminder` | Record type — see valid values below. |
| `data.sourceId` | ✅ for `family-reminder` | The record's id. |
| `sound` | Recommended | `"reminder.wav"`. On Android the **channel's** sound wins, so this mainly affects iOS. |

### Valid `sourceKind` values

> **Corrected 2026-08-20.** The original list in this doc was wrong: it said
> `document` and `fitness`. The server is right — the value is `insurance`, and
> there is no `fitness` projection. **The client has been fixed to match the
> server; no backend change is needed.** Thank you for flagging rather than
> renaming to match our mistake — `insurance` is the documented contract of
> `GET /api/reminders/family` and should not have moved.

```
appointment · medicine-stock · family-bill · subscription · task · routine
checkin · travel · insurance · custom
```

The app dispatches mark-done on this value. An unrecognised `sourceKind` means
**Done silently does nothing** — the notification still opens correctly, but the
record is never marked. Please send one of the values above exactly.

Recurring kinds (`routine`, `checkin`) record a completion for **today** rather
than flipping a permanent flag — marking them permanently done would stop them
recurring.

`medicine-stock`, `subscription`, and `insurance` are **intentional no-ops for
Done**: a stock level is not "completed", a subscription renews regardless, and
an insurance document is tracked by expiry date rather than completion. This is
correct behaviour, not a gap. **Snooze works on all kinds.**

---

## 5. Snooze — server-side behaviour

When the user snoozes a **bill**, the app calls:

```
POST /api/bills/:id/actions
{ "action": "snooze", "days": 0, "minutes": 10 }
```

⚠️ **Please confirm the server honours `minutes` when `days: 0`.** If it does
not, a 10-minute snooze silently does nothing server-side while appearing to
work on the device that pressed it. This was flagged in an earlier doc and has
still not been confirmed.

Family Hub reminders are re-armed locally by the app; no endpoint is called.
Once server-side scheduling ships (§6), the server will need its own snooze
handling for those.

---

## 6. ⚠️ Timing: this interacts with server-side scheduling

Family Hub reminders are currently scheduled **locally by the app**, gated
behind `SERVER_PUSH_CONFIRMED = false` in `lib/family-reminders-api.ts`.

While that flag is `false`, the app owns those notification titles and the new
format applies immediately.

**When the backend ships server-side scheduling and that flag flips, the
server's titles replace the app's entirely.** From that moment, §2 is not
optional — if the server sends the old format, users will see notification
titles *regress*.

Please implement §2 and §4 **before or together with** server-side scheduling,
never after.

---

## 7. How to verify

1. Send a test push with the bill payload from §4.
2. **Title reads** `Reminder: <name>` ✅
3. **Two buttons appear**: `Snooze 10 min` and `Done` ✅
   *(If no buttons → `data.categoryId` is missing or misspelled.)*
4. Tap **`Done`** → app opens → **confirmation dialog** appears → confirm → bill is marked paid.
5. Tap **`Snooze 10 min`** → app opens → snooze UI appears.
6. Tap the **notification body** → app opens → popup with **Snooze / Mark done** (no Cancel button).
7. Repeat with the family payload → title reads `Family Hub: Papa – <name>` using the **real member name from your payload**, and Done marks the correct record.

### Testing notes

- **Requires a dev/release build.** Notification categories do not work in Expo Go.
- **⚠️ Test on a FRESH INSTALL.** Android notification channels are immutable
  once created. Installing over an existing app keeps the old channel config and
  the buttons will appear not to change. Uninstall first.

---

## 8. Frontend status — already done, no client release needed for §2/§4

Shipped 2026-08-19:

- `lib/notifications.ts` — both actions `opensAppToForeground: true`; exports `DEFAULT_ACTION_IDENTIFIER`.
- `app/_layout.tsx` — maps button presses **and body taps** to a `snooze` / `done` / `open` intent, passed to the reminder screen as a route param.
- `app/bill-details/[billId].tsx` — snooze picker, mark-done confirm, and the body-tap action sheet.
- `app/family-reminder/[reminderId].tsx` — the same three flows for Family Hub reminders, dispatching mark-done per `sourceKind`.
- `lib/family-reminders.ts` — `familyReminderNotificationTitle()`, the single source of the `Family Hub: <member> – <title>` format, used by every call site (both schedulers and the snooze re-arm) so a snoozed reminder looks identical to the original.
- 11 new strings translated into all 7 locales.
- Cancel buttons removed from all notification-driven popups.

The app reads whatever `title` the push carries, so **§2 requires no client
change** — only your payloads.

---

## 9. Resolved decisions

Both settled with the client on 2026-08-19 — no action needed, recorded so they
are not reopened:

- **Cancel is disabled** in the notification popups. Earlier drafts had a Cancel
  button; it has been removed. The popups show only Snooze and Mark done.
- **The hub name is real dynamic data.** "Smith Family" was an example only. The
  member's name is used, read from the payload at send time. See §2.

Nothing in this section requires backend work.
