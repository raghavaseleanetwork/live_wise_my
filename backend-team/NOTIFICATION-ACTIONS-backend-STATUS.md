# Notification Action Buttons & Custom Sound — Backend Status

**Audience:** Frontend team
**Received from backend team:** 2026-08-17
**Source doc:** `NOTIFICATION-ACTIONS-backend-requirements.md` (2026-08-17)

Status against that doc's TL;DR table:

| # | Work | Status |
|---|---|---|
| 1 | Category identifier on reminder pushes (§2.1) | ✅ Done |
| 2 | `sound: "reminder.wav"` on reminder pushes (§2.2) | ✅ Done |
| 3 | `minutes` honoured on snooze action (§3) | ✅ Already worked, confirmed |
| 4 | Server-side re-fire after snooze (§4) | ❌ Not done (doc marks this optional) |

> ### 🔍 FRONTEND VERIFICATION ON RECEIPT (2026-08-17) — two things to resolve
>
> **1. Their "client-side pieces don't exist" note is correct about the shared
> repo, and it's OUR fault — the work is uncommitted.**
>
> Verified locally on `aselea-frontend-fixers`:
>
> | Piece | Local state |
> |---|---|
> | `lib/notifications.ts` (category + sound) | Present — **modified, uncommitted** |
> | `lib/notification-actions.ts` | Present, 6.0 KB — **untracked** |
> | `app/_layout.tsx` (action routing) | Present — **modified, uncommitted** |
> | `app.json` (`sounds` array) | Present — **modified, uncommitted** |
> | `assets/sounds/` | Present (README only) — **untracked** |
>
> So they pulled `origin/main` and correctly saw none of it. **This is the third
> time this exact miscommunication has happened** (payment-history, the
> RevenueCat §0 confusion, now this). **Action: commit and push.**
>
> **2. Their backend changes are not visible from here either — we appear to be
> on diverged trees.**
>
> This branch is **21 commits behind `origin/main`**, and searching
> `origin/main` for their described changes finds nothing:
>
> - `server/push.ts` — **does not exist** on `origin/main` (there is a
>   `server/push-notifications.ts`).
> - `lifewise_reminder_actions` / `REMINDER_ACTIONS_CATEGORY` / `reminder.wav` —
>   **zero matches** in `origin/main`'s `server/`, and zero matches across every
>   remote branch scanned.
>
> Most likely they haven't pushed yet, or pushed somewhere not fetched here.
> **Not disputing the work was done** — just flagging it can't be confirmed from
> this side, so §5's verification steps can't be run until it's visible.
> Please confirm the branch/commit.
>
> **3. Their "Correction to an earlier status doc" (§ below) does not hold up.**
> See the note under that section — this one matters, because acting on it would
> re-introduce a bug we just fixed.

---

## ✅ Done

### §2.1 / §2.2: category + sound on reminder pushes

`server/push.ts` — `sendPushToTokens` (and both wrapper functions,
`sendPushToUser` / `sendPushToTokenDocs`) now accept an optional
`categoryId` on the payload. When set to `REMINDER_ACTIONS_CATEGORY`
(`'lifewise_reminder_actions'`, exported from `push.ts`):

- **Android** — `android.notification.clickAction` is set, and `categoryId`
  is also included in the `data` block (per the doc's belt-and-braces
  instruction), plus `android.notification.sound: 'reminder.wav'`.
- **iOS** — `apns.payload.aps.category` is set, and
  `apns.payload.aps.sound` switches from `'default'` to `'reminder.wav'`.
- **Silent/data-only pushes are unaffected** — `categoryId` only has an
  effect when `channelId` is also set (i.e. a visible notification), so it
  cannot leak onto a background sync push.

Applied to exactly the three reminder-type push call sites in
`server/routes.ts`, matching the doc's list:
- `type: 'reminder'` (bill reminders)
- `type: 'medication'` (medicine dose reminders)
- `type: 'family-reminder'` (Family Hub projected reminders)

**Deliberately NOT applied** to `caregiver-invite`, `caregiver-invite-accepted`,
`sync` (silent caregiver-sync pushes), or the missed-medicine `emergency`
alert — none of these have a Snooze/Done concept, matching §2.1's
instruction.

> **Frontend note:** the exclusion list is exactly right, and the
> `categoryId`-only-with-`channelId` guard is a nice touch — it structurally
> prevents buttons leaking onto silent sync pushes, which would have been a
> confusing bug. The string matches our `REMINDER_CATEGORY_ID` exactly
> (`lib/notifications.ts:51`).
>
> Can't verify the code from here yet — see verification note 2 above.

### §2.3: payload fields for the Done button

No change needed — already correct before this update. Confirmed each
reminder-type push carries what the Done handler needs:
- `type: 'reminder'` → `billId`
- `type: 'family-reminder'` → `memberId`, `sourceKind`, `sourceId`

### §3: `minutes` on snooze

Confirmed by reading `POST /api/bills/:id/actions`
(`server/routes.ts`) — `snoozeMinutes` is read first and takes priority over
`days` whenever it's a positive number, so `{action:'snooze', days:0,
minutes:10}` correctly produces a 10-minute snooze. No change was needed;
this was already correct.

> **Frontend note:** good — this was the one that would have failed silently.
> A 10-minute snooze looked correct on the device that pressed the button
> (the local re-arm works regardless) while being wrong server-side and on
> every other device. Confirmed working means no client change needed.

---

## ❌ Not done

### §4: Server-side re-fire after snooze

Not implemented. The doc marks this as optional ("not required... flagging
it because it's the kind of thing that gets reported as a bug months
later"). Snooze still works via the client's local re-arm; a snooze pressed
on one device won't reappear on a second device or survive a reinstall.

> **Frontend note:** agreed, correctly deprioritised. Worth revisiting only if
> multi-device usage turns out to be common.

---

## ⚠️ One thing to check before you rely on this

The requirements doc describes the client side of this feature —
`lifewise_reminder_actions` category registration,
`lib/notification-actions.ts`, and the `reminder.wav` asset — as **already
shipping**. None of the three exist in this repository as of this update
(no match for `lifewise_reminder_actions` or `notification-actions` anywhere
outside `server/`, and no `.wav` file or `assets/sounds/` directory at all).

That may just mean those pieces live in a different repo/branch than the one
this backend work was done against — but worth confirming before assuming
buttons will actually render. The backend fields are ready and waiting
either way; they're inert extra payload data until a client reads them.

> **Frontend note: correct, and thank you for checking rather than assuming.**
> The cause is on our side — the work is written but uncommitted (see
> verification note 1 above). Being fixed.
>
> One clarification: `reminder.wav` itself is **intentionally not in the repo**
> and won't be even after we commit. It's a binary audio asset that still has to
> be supplied — see `assets/sounds/README.md`. Until it exists, notifications
> fall back to the system default sound. **Your `sound: 'reminder.wav'` field is
> still correct to send** — the OS resolves it against the app bundle and falls
> back silently if absent, so there's nothing for you to change when the file
> lands.

---

## Correction to an earlier status doc

`FAMILY_REMINDERS_HOME_DASHBOARD_BACKEND_STATUS.md` (sent earlier today)
incorrectly stated that server-side scheduling and push for Family Hub
reminders (§4 of that doc) was not built. On closer reading of
`server/routes.ts`, it already is — there's a scheduler
(`startReminderScheduler`, same function that handles bill reminders) that
calls `projectFamilyReminders` and sends push with the exact
`memberId`/`sourceKind`/`sourceId` fields the Done button needs. Apologies
for the bad status — that earlier doc's §4 line should be read as "already
built," not "not built."

> ### 🔴 FRONTEND NOTE — this correction could not be confirmed, and acting on it is risky
>
> **We cannot verify this claim, and the evidence available points the other
> way.** Searched both this branch and `origin/main`:
>
> - `projectFamilyReminders` / `projectMemberReminders` — **zero matches** in
>   `server/` on either.
> - `'family-reminder'` as a push type — **zero matches** in `server/` on either.
>
> That may be the same visibility problem as verification note 2 (we're 21
> commits behind and can't see `server/push.ts` at all). But **the direction of
> this correction matters a lot**, because of the cutover trap:
>
> Your *first* status doc said push was NOT built. Acting on that, we shipped a
> guard (`SERVER_PUSH_CONFIRMED = false` in `lib/family-reminders-api.ts`) that
> stops the client from cancelling its own local notifications, and self-heals
> installs that had already latched the cutover. That guard is **currently
> protecting users from getting zero reminders.**
>
> If push really *is* built, the guard is now unnecessarily suppressing the
> handover — a smaller problem, but still wrong.
>
> **We are NOT flipping that flag on this correction alone.** Please confirm with
> a live test rather than a code read: trigger a Family Hub reminder and verify a
> push actually arrives on a device. Once you confirm that, we flip
> `SERVER_PUSH_CONFIRMED` to `true` in one line. Until then the guard stays —
> the failure mode it prevents (silent total loss of family reminders) is far
> worse than the one it causes (server scheduling not yet used).

---

## How to verify

Same steps as the requirements doc's §5, now that §2.1/§2.2/§3 are in place:

1. Trigger a bill reminder, medicine reminder, or family reminder push →
   confirm `data.categoryId` is `lifewise_reminder_actions` and (once the
   client-side pieces above are confirmed present) buttons render.
2. Confirm `apns.payload.aps.sound` / `android.notification.sound` is
   `reminder.wav` on those same pushes, `default` on everything else.
3. Send a caregiver-invite push → confirm no `categoryId` in `data`.
4. `POST /api/bills/:id/actions` with `{action:'snooze', days:0,
   minutes:10}` → confirm `snoozedUntil` is ~10 minutes out, not ~1 day.

> **Frontend note:** steps 1 and 2 need a **dev build** (notification
> categories don't work in Expo Go) **and a fresh install** for the sound —
> an Android channel's sound is fixed at creation, so a device that ran an
> earlier build keeps the old sound no matter what the payload says.

---

## Open items for both sides

| # | Item | Owner |
|---|---|---|
| 1 | Commit + push the client-side notification work (cause of the §"One thing to check" mismatch) | **Frontend** |
| 2 | Supply the `reminder.wav` audio asset — see `assets/sounds/README.md` | **Frontend / design** |
| 3 | Confirm the branch/commit carrying the backend changes; `server/push.ts` isn't visible on `origin/main` | **Backend** |
| 4 | **Live-test** whether family-reminder push actually fires, so the `SERVER_PUSH_CONFIRMED` question is settled by observation, not code reading | **Backend** |
| 5 | Flip `SERVER_PUSH_CONFIRMED` to `true` once item 4 confirms push works | **Frontend**, blocked on 4 |
| 6 | Device test: buttons render, Done doesn't open the app, snoozed copy returns after ~10 min | Both |

---

## Related documents

- `NOTIFICATION-ACTIONS-backend-requirements.md` — the original request this answers.
- `FAMILY-REMINDERS-HOME-backend-STATUS.md` — the doc being corrected above, and
  where the `SERVER_PUSH_CONFIRMED` guard is documented.
- Frontend: `lib/notifications.ts` (category + sound), `lib/notification-actions.ts`
  (button handling), `lib/family-reminders-api.ts` (the cutover guard),
  `assets/sounds/README.md` (the missing audio asset).
