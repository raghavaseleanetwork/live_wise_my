# Multi-Language Support — Backend Requirements

**Audience:** Backend team
**Status:** Frontend work is in progress/complete (this doc is written alongside it). The app UI itself — every screen, label, button, alert — is translated client-side and needs **no backend change** to work. This doc covers the smaller but real slice of user-facing text that is generated **on the server** and therefore cannot be translated by the app alone.

---

## 1. Background — what the frontend already does, and what it can't reach

The client now ships 7 language bundles (English, Hindi, Gujarati, Marathi, Tamil, Telugu, Bengali) via `react-i18next`, selectable from Settings → Language. Every screen's static text (buttons, labels, headers, alerts, empty states) is translated locally in the app bundle — this part is 100% client-side and already works with no server involvement.

What the client **cannot** translate on its own is text that is *generated* by the server and sent to the user as a finished string — the server doesn't know which language to write in unless we tell it. Four concrete places this happens:

1. **Reminder emails** — `server/templates/reminder-email.html`, rendered by `renderReminderEmailTemplate()` and sent via Resend.
2. **Push / in-app notifications** — documents like `{ title: 'Electricity Bill', body: 'Due today at 8:00 PM' }` constructed directly in `server/routes.ts` and stored/pushed to the device.
3. **API error messages** — `res.status(...).json({ message: '...' })`, e.g. `'Not authenticated'`, `'Server error.'`, `'Invalid or expired token'`. These surface directly in the app's alert dialogs today, in English, regardless of the user's chosen app language.
4. **OTP SMS** — `sendSmsOtp()` sends a hardcoded English SMS body via Twilio.

None of this is a new problem introduced by adding languages — it's the same class of issue the currency feature already ran into (see `preferredCurrency` below) and is being handled the same way.

---

## 2. What the client is already sending you

Exactly mirroring the existing `preferredCurrency` pattern (already live — see `lib/currency-context.tsx` / `PUT /api/auth/me`), the client now also sends:

```
PUT /api/auth/me
{
  "preferredLanguage": "hi"   // ISO 639-1: one of en, hi, gu, mr, ta, te, bn
}
```

This fires automatically whenever the user changes their language in Settings, fire-and-forget from the client's side (same as currency). **The server does not need to do anything with this field to avoid breaking anything** — right now it will just be silently accepted/ignored if `preferredCurrency`-style handling isn't added, exactly as `preferredCurrency` was for a while before anything consumed it. This doc is the checklist for actually consuming it.

### 2.1 Schema change

Add `preferredLanguage: string` to the user document, default `'en'` if absent (covers every existing user — no backfill needed, missing field = English, same convention as any other new optional user field in this codebase).

```ts
// users collection, add:
{
  ...
  preferredLanguage?: string; // ISO 639-1, one of: en | hi | gu | mr | ta | te | bn. Undefined = 'en'.
}
```

### 2.2 `PUT /api/auth/me` — accept the field

Add `preferredLanguage` to the same validated field list `preferredCurrency` already goes through. No special validation beyond checking it's one of the 7 supported codes (reject/ignore anything else rather than 500ing — a client bug sending a bad code should not break profile updates for name/phone/etc. in the same request).

---

## 3. What to actually localize, in priority order

### 3.1 Reminder emails (highest priority — most visible, least likely to be caught in testing)

`server/templates/reminder-email.html` today has hardcoded English strings baked into the template (subject line, "Due today", "View in LifeWise" button text, etc. — check the template file directly for the current exact copy).

**Ask:** either (a) 7 template variants (`reminder-email.en.html`, `reminder-email.hi.html`, …) selected by `user.preferredLanguage` at send time, or (b) extract the template's static strings into a small per-language string table and keep one template with `{{t.dueToday}}`-style placeholders, filled per-send. Either works; (b) is less duplication to maintain if the template changes often, (a) is simpler to implement fast. Your call — flag which you'd prefer and we can align on the string list.

**We (frontend) can supply the translated strings** for whichever approach you pick — the translations already exist in `locales/*.json` on the client for equivalent UI copy and can be adapted, or we'll translate the exact email copy fresh once you confirm the string list needed.

### 3.2 Push / in-app notifications

Every place `server/routes.ts` constructs a notification body as a plain string (bill due reminders, spending insights, family/caregiver alerts — see `BUG-19-family-reminders-push-and-caregiver-fanout.md` and `FAMILY-HUB-NOTIFICATIONS-backend-requirements.md` for the existing notification-generation code paths) needs to look up `user.preferredLanguage` and generate the string in that language instead of hardcoded English.

Practically, this likely means: a small server-side translation table (`{ en: 'Due today at {{time}}', hi: '...', ... }`) for the fixed set of notification templates (bill due, bill overdue, spending insight, family reminder, emergency alert, etc.), with variable interpolation (amount, time, name) applied after language selection. **This is a bounded, enumerable set of templates** — not free-text — so it's a translation-table lookup, not a live-translation problem.

We can supply the translated copy for each template string once you confirm the exact list of notification templates currently in use (some are AI-generated per `parseReminderWithAI()` — see §4 below for that specific case).

### 3.3 API error messages

Lower priority — these are mostly technical/fallback messages (`'Server error.'`, `'Not authenticated'`) that a user rarely sees in normal use, and some already get intercepted and replaced with friendlier client-side copy (see `ui.log`'s "Scan Bill: server plan-limit 403" entry for a precedent of the client re-interpreting a server error rather than displaying it raw). Recommend leaving these in English for now unless a specific one is confirmed to reach users routinely and needs translating — flag which ones you'd consider high-traffic and we'll prioritize.

### 3.4 OTP SMS

`sendSmsOtp()` — lowest priority (a 6-digit code with one line of surrounding text; low ambiguity even read in English), but simple to do at the same time as §3.2 if convenient: same template-table approach, one string.

---

## 4. Special case — AI-generated content stays as-is (no change needed)

`parseReminderWithAI()` already accepts multilingual *input* (the existing prompt understands Hindi/Gujarati text typed or spoken by the user) and the reminder *title* it returns is derived from the user's own input, not translated output. This is intentionally left alone — if a user types a reminder in Hindi, the title should stay in Hindi (it's their own words), regardless of what `preferredLanguage` is set to. Nothing to change here.

---

## 5. Suggested order of work

1. Schema + `PUT /api/auth/me` field (§2) — trivial, unblocks everything else, no visible change until §3 items ship.
2. Reminder emails (§3.1) — highest visibility, bounded scope (one template).
3. Push/in-app notifications (§3.2) — bounded template set, moderate effort depending on how many distinct notification types exist today.
4. API errors / OTP SMS (§3.3, §3.4) — lowest priority, can be deferred indefinitely without user-facing impact beyond "still in English," which is not a regression from today's state.

None of §3–4 needs to ship before the client's language toggle goes live — the app UI itself is fully functional in all 7 languages independent of this doc. Server-generated text simply stays in English until each piece above is done, same as how currency conversion worked before `resolvePlanPrice` existed.
