# Client Bug Fix — Complete Verification & Plan

Source: `backend-team/app docs/clint_bugfix.md` (client requirement doc)
Created: 2026-08-14
Method: every item below was checked against the **live code**, not against `ui.log`/`BUG_FIX_LOG.md` claims — those logs were used only as a hint of where to look. Status reflects what the code actually does today.

**Process for this list (same as `ui.log`):** nothing gets changed until you say "start" on a specific item. When you do, I'll ask for full detail on that item before writing any code, then implement exactly that and log it in `ui.log`.

Status legend: ✅ Done &nbsp;|&nbsp; 🟡 Partial &nbsp;|&nbsp; ❌ Not done &nbsp;|&nbsp; ❓ Can't verify from this repo (needs backend/device check)

---

## Summary table

| # | Item | Status |
|---|---|---|
| 1 | Credit/Debit Transaction Detection | 🟡 Partial |
| 2 | Activity Section Improvements | 🟡 Partial |
| 3 | Home Dashboard Improvements | 🟡 Partial |
| 4 | UI Consistency Across the App | 🟡 Partial (likely mostly outstanding) |
| 5 | "Other Expense" Category | ❌ Not done |
| 6 | Caregiver Email Invitation | ❓ Backend-dependent |
| 7 | Amount Display Overflow | ✅ Done |
| 8 | Settings — Language | ✅ Done |
| 8 | Settings — Payment History | ❌ Not done |
| 9 | Biometric Authentication | ✅ Done |
| 10 | Voice Reminder Language Issues | ❓ Backend-dependent |
| 11 | Caregiver Permissions & Access | ❌ Not done (spec-only) |
| 12 | Family Reminders on Home Dashboard | ❌ Not done |
| 13 | Upcoming Bills & Due Dates | ✅ Done |
| 14 | Add Family Member — Age/Blood Group | ❌ Not done |
| 15 | Family Hub — 20 PRD modules | ❌ Not done (15 exist, 1 unbuilt) |
| 16a | Reminders Tab (unified, filters, lifecycle) | ❌ Not done (tab is really "Bills") |
| 16b | Profile Tab — Account | ✅ Done |
| 16b | Profile Tab — Change password / linked accounts | ❌ Not done |
| 16b | Profile Tab — Notification Settings | ❌ Not done |
| 16b | Profile Tab — Family Permissions UI | 🟡 Partial |
| 16b | Profile Tab — App Settings (lang/dark/currency/biometric) | ✅ Done |
| 16b | Profile Tab — Data export (JSON) | ❌ Not done |
| 16b | Subscription — plan/comparison | ✅ Done |
| 16b | Subscription — payment history/cancel | ❌ Not done |
| 16c | Real-Time Sync (WebSocket) | ❌ Not done (chat only) |
| 16c | FCM / push architecture | 🟡 Partial (local scheduling works, no fan-out sync) |
| 16 | Final PRD verification / regression pass | ❌ Not started |

**Headline read:** the finance/UI polish items (1, 2, 3, 7, 13) are mostly built and just need small consistency fixes. The "PRD feature completeness" items (11, 12, 15, 16) are the real gaps — a chunk of the doc describes a Reminders Tab, Family Permissions system, and Real-Time Sync architecture that either doesn't exist yet or only exists as a backend-team spec doc, not running code.

---

## 1. Credit / Debit Transaction Detection — 🟡 Partial

**What the client means:** every transaction should correctly know whether it's money coming in (credit/income) or going out (debit/expense), and that should show consistently everywhere — the right color, the right sign, and the right math in every total.

**Current state:**
- Detection logic is solid: `lib/parse-sms.ts` has `resolveDirection()` with keyword-based debit/credit classification for auto-synced SMS transactions.
- `isDebit` is used correctly for income/expense/balance math in `lib/expense-context.tsx` and `app/(tabs)/transactions.tsx`.
- **Bug:** color coding is inconsistent between screens.
  - `app/(tabs)/transactions.tsx` (Activity tab): correct — red for debit, green for credit.
  - `app/(tabs)/index.tsx` (Home dashboard recent-transactions row): **debit renders in neutral text color, not red** — only credit gets colored (green). So an expense on Home looks the same as a note, not "money out."
- Not verified: whether Reports/Analytics screens apply the same red/green convention (no color-coding found there in the audit — may just not need it if that screen is chart-only).

**Fix scope:** align the Home dashboard row color to match the Activity tab (`colors.danger` for debit), and check Reports for the same rule if it renders individual transactions anywhere.

**Where:** `app/(tabs)/index.tsx` (recent-transactions row, ~line 196), spot-check `app/(tabs)/reports.tsx`.

---

## 2. Activity Section Improvements — 🟡 Partial

**What the client means:** the Activity screen's title is too dominant visually; transactions there should be clearly split Credit vs Debit with color; and a confusingly-named "Total" label elsewhere needs a clearer name.

**Current state:**
- Title size: `app/(tabs)/transactions.tsx` screen title is still 24px — no reduction has actually landed (a prior log entry claims this was "fixed" at 24px, but 24px for a page header is not obviously smaller than the app's other headers; needs a side-by-side comparison against other screen headers to confirm it reads as reduced).
- Credit/Debit categorization + color: covered by item 1's fix (transactions tab itself is already correct).
- "Total" rename: no literal "Total" string exists on the Home dashboard anymore (already reads "Recent Transactions" / similar) — this specific complaint appears to already be resolved, or referred to something that's since changed. Needs your confirmation of what specifically still looks unclear, if anything.

**Fix scope:** confirm with you whether the Activity title still looks oversized against the rest of the app before touching it again (it's been adjusted once already per `ui.log` and rejected once); otherwise this item may already be closed.

**Where:** `app/(tabs)/transactions.tsx`.

---

## 3. Home Dashboard Improvements — 🟡 Partial / Unclear

**What the client means:** rename "Total" → "Total Transactions", show the actual transaction count, and make the "Finance Summary Box" span the full width of its container.

**Current state:**
- No "Total" label exists on Home currently — can't rename what isn't there. Likely already renamed in a past pass, or the client is referring to a different screen/build than what's currently live.
- No visible transaction **count** is shown anywhere on Home (the count is computed internally for logic, never displayed as a number to the user).
- The main summary card (`heroCard`) already appears full-width with no width constraint — this part may already be satisfied.

**Fix scope:** needs your clarification — walk through exactly which card the client screenshot/complaint refers to, since the literal "Total" string doesn't exist in the current build. Once clarified: likely needs a transaction-count number added to whichever card this refers to.

**Where:** `app/(tabs)/index.tsx`.

---

## 4. UI Consistency Across the App — 🟡 Partial (likely mostly outstanding)

**What the client means:** a general pass over every screen for inconsistent card widths, spacing, padding, margins, and alignment.

**Current state:** the app has no shared design-token file (no `constants/spacing.ts` / `constants/typography.ts` — only `constants/colors.ts`). Font sizes and spacing values are hardcoded per-screen and vary a lot (e.g. `transactions.tsx` alone uses 9 different inline font sizes). This is consistent with a codebase that has had many one-off UI fixes (per the long `ui.log` history) but never a systematic consistency pass.

**Fix scope:** this is a large, open-ended item — needs to be scoped down before starting (e.g. "which screens specifically" or "pick N screens per pass") rather than attempted as one sweep. Recommend treating this as an ongoing item revisited per-screen as other items are worked, not a single task.

**Where:** app-wide.

---

## 5. Add "Other Expense" Category (Leaks Logic) — ❌ Not done

**What the client means:** a new expense category specifically for transfers to other people / spending that shouldn't count as a "leak," and Leaks Analysis must exclude it.

**Current state:** `lib/data.ts` defines 16 categories (health, bills, family, work, tasks, subscriptions, finance, habits, travel, events, food, shopping, transport, entertainment, education, investment, others). No `"Other Expense"` category exists — only a generic `others` catch-all, and that catch-all is **not excluded** from Leaks Analysis (`app/(tabs)/leaks.tsx` treats it like any other spend category).

**Fix scope:**
1. Add a new category (`otherExpense` or similar key) to `lib/data.ts`'s `CATEGORIES` map with its own icon/color, distinct from the generic `others`.
2. Make it selectable in the expense entry flow (Quick Add, manual entry).
3. Exclude it explicitly from whatever computes Leaks (`app/(tabs)/leaks.tsx` and any server-side leak calculation, if leaks are computed server-side — needs checking).

**Where:** `lib/data.ts`, `app/(tabs)/leaks.tsx`, expense entry screens, possibly `server/` leak-detection logic.

---

## 6. Caregiver Email Invitation — ❓ Backend-dependent, can't verify

**What the client means:** inviting a caregiver by email should send a real, properly formatted email, and the whole invite flow needs to be confirmed working end-to-end.

**Current state:** `lib/family-caregivers.ts`'s `inviteCaregiver()` calls `POST /api/family/:memberId/connected-caregivers/invite` — **this route does not exist in this repo's `server/routes.ts`**. The only email-sending code found is `sendReminderEmail()` (via Resend), which is for bill reminders, unrelated to caregiver invites. The caregiver invite backend is documented as a spec (`backend-team/CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md`) but not implemented here — it may live in a separate backend service/repo not present locally.
`app/caregiver-invites.tsx` (frontend) only handles **accepting/declining an invite already received** — it has no view of whether the invite email itself was ever sent or how it's formatted.

**Fix scope:** this needs a backend-team check first — confirm whether the invite endpoint exists on the live server (even if absent from this repo) and whether it sends email. If it doesn't exist at all yet, this is a backend build item, not a frontend fix, and should go back to backend-team as a requirement doc rather than be attempted here blind.

**Where:** backend (`server/` or external caregiver service), `lib/family-caregivers.ts`, `app/caregiver-invites.tsx`.

---

## 7. Amount Display Overflow — ✅ Done

**What the client means:** if a large amount doesn't fit its card, it should scroll or shrink — never break the layout or overlap other elements.

**Current state:** `components/Money.tsx` uses `numberOfLines={1}` + `adjustsFontSizeToFit`, so oversized amounts auto-shrink to fit rather than overflow. This isn't literally "horizontal scroll or marquee" as worded, but it satisfies the actual requirement ("never breaks the layout or overlaps") more cleanly than a marquee would.

**Fix scope:** none needed unless you specifically want a scrolling/marquee behavior instead of shrink-to-fit (a UX downgrade, not recommended) — flagging as done unless you say otherwise.

---

## 8. Settings Enhancements — 🟡 Partial

**8a. Language Settings — ✅ Done.** `app/settings.tsx` has a full language picker wired to `lib/language-context.tsx`, synced server-side. All 7 client-requested languages exist as locale files (`locales/en, hi, gu, mr, ta, te, bn.json`).

**8b. Payment History — ❌ Not done.** No "Payment History" UI exists anywhere (`app/settings.tsx`, `app/subscription/index.tsx`, `app/subscription/compare.tsx`, `lib/subscription-context.tsx` all checked — zero matches). RevenueCat is the only payment gateway (per `CLAUDE.md`) — RevenueCat's SDK does expose purchase/transaction history via `Purchases.getCustomerInfo()`'s `allPurchaseDates`/`allExpirationDates`, or a dedicated history call, which would need to be surfaced in a new screen/section.

**Fix scope:** build a Payment History section under Subscription in Settings, sourced from RevenueCat customer info (native) with a sensible empty/fallback state on web (where RevenueCat doesn't run, per `CLAUDE.md`).

**Where:** new UI in `app/settings.tsx` or `app/subscription/`, reading from `lib/revenuecat.ts` / `lib/subscription-context.tsx`.

---

## 9. Biometric Authentication — ✅ Done

**Current state:** `lib/app-lock-context.tsx` is a complete implementation using `expo-local-authentication` — detects Face ID / Fingerprint / Iris, exposes a toggle in `app/settings.tsx` with hint text. Fully built and wired.

**Fix scope:** none — unless a device test surfaces a real bug, this item is closed.

---

## 10. Voice Reminder Language Issues — ❓ Backend-dependent, can't verify

**Current state:** `app/voice-reminder.tsx` records audio client-side and sends it to the server for transcription + language detection — there is no client-side language logic to fix. Per `BUG_FIX_LOG.md`, this was already investigated once: two language-detection implementations exist server-side (`normalizeTranscriptScript` — the correct one with Gujarati-correction logic — is dead code; the weaker `normalizeAndParseVoiceReminderWithAI` is what actually runs). That diagnosis and fix live entirely in `backend-team/BUG-7-voice-multilingual-detection.md` and depend on backend-team action, not frontend code.

**Fix scope:** confirm with backend-team whether `backend-team/BUG-7-voice-multilingual-detection.md` was ever applied. If not, this is still an open backend fix, not something to redo on the frontend. If it was applied, this item just needs a real-device test across Gujarati/Hindi/English to confirm.

---

## 11. Caregiver Permissions & Access — ❌ Not done (spec-only)

**What the client means:** caregivers should be able to receive reminder notifications, mark reminders as completed, and only see the data/permissions the primary account holder assigned them — a real permission system, not just a yes/no connection.

**Current state:** `lib/family-caregivers.ts` defines only a binary `CaregiverRole = 'owner' | 'caregiver'` — no granular permission levels (View Only / Can Edit / Full Access, as also requested in item 16's Family Permissions section). No role-based data filtering found anywhere in the reminders code. This entire system is currently spec-only, documented in `backend-team/CAREGIVER-SYSTEM-backend-requirements.md`, not implemented in running code.

**Fix scope:** this is a real feature build (frontend UI for permission levels + backend enforcement), not a bug fix — needs scoping as its own project, likely alongside item 6 and the Family Permissions part of item 16.

**Where:** `lib/family-caregivers.ts`, new permission-management UI, `backend-team/CAREGIVER-SYSTEM-backend-requirements.md` (backend work).

---

## 12. Family Reminders Section (Home Dashboard) — ❌ Not done

**What the client means:** a card on the Home dashboard showing family members' reminders — photo, name, reminder type icon, title, time, status — with a small "View All" button to the Reminders tab.

**Current state:** confirmed absent. `app/(tabs)/index.tsx` has an "Upcoming" section, but it only shows the user's **own personal bills** (per item 13), never other family members' reminders, and has no member photo/avatar, no "View All" button. This is a genuine missing feature, not a partial fix.

**Fix scope:** new card/section on Home, sourced from family members' reminder data (medicine, bills, appointments, etc. across the family) — needs a cross-member reminder aggregate, which per `ui.log`'s 2026-08-13 entry doesn't fully exist server-side yet either (`/api/reminders/family` is referenced client-side but 404s — same backend gap noted for item 13's Appointments/Renewals scope-cut).

**Where:** `app/(tabs)/index.tsx`, likely needs a backend aggregate endpoint first (same one item 13's original spec was scoped down for).

---

## 13. Upcoming Bills & Due Dates — ✅ Done

**Current state:** `app/(tabs)/index.tsx` implements this precisely: 7-day window, capped to 5 items, sorted soonest-first, 3-tier color coding exactly as specified (red = today/overdue, orange = 1-2 days, green = 3+ days). Confirmed correct and complete.

**Known scope gap (documented, not a bug):** shows Bills only, not Appointments/Renewals — this was a deliberate, confirmed scope cut (per `ui.log` 2026-08-13) because there's no cross-member aggregate API for those yet. Also always shows "You" as member name rather than a real family member name, since Home's bills are personal-only. If the client wants Appointments/Renewals included, that requires the same backend aggregate endpoint noted in item 12.

**Fix scope:** none unless you want to revisit the Appointments/Renewals scope cut — that would bundle with item 12's backend need.

---

## 14. Add Missing Fields in "Add Family Member" — ❌ Not done

**Current state:** `app/add-family-member.tsx` currently has Name, Relationship, Date of Birth, Photo, Feature selection. No Age field, no Blood Group field — confirmed absent by direct search.

**Fix scope:** add two fields to both `app/add-family-member.tsx` and `app/edit-family-member.tsx`:
- **Age** — note DOB already exists; clarify with you whether "Age" should be a derived display (computed from DOB, no new input) or a genuinely separate manual input field (some family members may not have a known DOB but a known approximate age).
- **Blood Group** — new field, likely a picker (A+/A-/B+/B-/O+/O-/AB+/AB-).

Also needs a schema check — whether the backend member record even has fields for these yet, or if this needs a backend doc too (same pattern as the avatar-upload and DOB fixes earlier in this project).

**Where:** `app/add-family-member.tsx`, `app/edit-family-member.tsx`, possibly `server/` schema.

---

## 15. Family Hub – Missing PRD Fields — ❌ Not done (module count short)

**What the client means:** review all "20 Family Hub modules" against the PRD and fill in anything missing.

**Current state:** `lib/family-features.ts` currently defines **15 modules** (14 built + Diet & Food marked not-built): Medicine, Appointments, Bills, Health, Emergency, Routine, Subscriptions, Expenses, Tasks, Check-in, Travel, Stock, Diet, Insurance, Custom. That's 15, not 20 — **no document in this repo enumerates the other ~5 modules the client's "20" figure refers to.**

**Fix scope:** this cannot be started blind — I need either (a) the actual PRD document listing all 20 modules by name, or (b) your direction on which ~5 additional modules to add. Once that's available, each module needs the same review the client asked for (missing fields/inputs/sections) against whatever the approved PRD actually specifies.

**Where:** `lib/family-features.ts` + new `app/family-*/[memberId].tsx` screens per new module, following the existing pattern.

---

## 16. Catch-all — "check everything, fix and add"

This is the biggest item — it's really the client re-pasting a large chunk of the PRD (Reminders Tab spec, Profile Tab spec, Real-Time Sync spec) as a checklist. Breaking it into its actual sub-parts:

### 16a. Reminders Tab (unified command center) — ❌ Not done
**Spec:** one tab showing ALL reminders across ALL family members, with a filter bar (All / Today / Upcoming / Overdue / Completed / per-member), and cards with module icon, member avatar+name, title, due time, status badge (Pending/Done/Missed/Snoozed), and quick actions (Mark Done/Snooze/Edit).

**Current state:** the tab labeled "Reminders" in the bottom nav actually routes to `app/(tabs)/bills.tsx`, which is a **personal bills list**, not a cross-family reminder command center. Its filter bar is by category (Bills/Health/Family/Work), not by the status/member filters the PRD specifies. Snooze/Edit actions exist; "Mark Done" exists as a paid-toggle. No member avatar, no per-member filter, no unified view across medicine/appointments/tasks/etc. — each Family Hub module has its own separate reminder list today, nothing aggregates them.

**This is a substantial feature build**, not a bug fix — it needs the same cross-member aggregate backend gap noted in items 12 and 13 resolved first, then a genuinely new tab UI.

### 16b. Reminder Lifecycle (PENDING → COMPLETED/MISSED, 30-min miss window, daily summary push) — ❓ Needs backend check
Can't verify status/lifecycle transition logic without checking server-side reminder scheduling — flag for backend-team confirmation.

### 16c. Profile Tab — mixed, see breakdown:
- **Account (photo/name/email/phone/edit)** — ✅ Done (`app/profile.tsx`).
- **Change password** — ❌ Not found anywhere in the app.
- **Linked accounts (Google/Apple)** — ❌ Not found as a Settings UI (Google login itself works per `BUG_FIX_LOG.md`, but there's no "linked accounts" management screen).
- **Notification Settings (master toggle, per-module toggles, quiet hours, sound)** — ❌ Not done. `app/notifications.tsx` is a notification *feed*, not a settings screen — zero toggles.
- **Family Permissions (assignment UI, View/Edit/Full levels, connected devices, pending invites)** — 🟡 Partial: pending invites list exists (`app/caregiver-invites.tsx`); permission-level UI and connected-devices list do not exist (same gap as item 11).
- **App Settings (language, dark mode, currency, biometric)** — ✅ Done, all present in `app/settings.tsx`.
- **Data export as JSON** — ❌ Not found anywhere.
- **Subscription (plan, comparison table, upgrade CTA, payment history, cancel)** — plan/comparison/upgrade ✅ done (`app/subscription/`); payment history ❌ (same as item 8); cancel-subscription flow ❌ not found (RevenueCat manages cancellation via the platform's own subscription management, which may be the intended path — worth confirming with you whether an in-app cancel button is actually wanted alongside that, or if deep-linking to the store's subscription management page satisfies this).

### 16d. Real-Time Sync & Notifications — 🟡 Partial
- Local push scheduling works (`lib/notifications.ts`, `expo-notifications`, Android channels configured).
- `socket.io-client` is installed but **only used for the support-chat feature** — there is no WebSocket-based real-time sync for reminders/caregiver actions. `backend-team/CAREGIVER-SYSTEM-backend-requirements.md` confirms this is still a planned, unbuilt priority, not live.
- No evidence of iOS-specific (`react-native-permissions`, critical alerts, background_fetch) or Android-specific (foreground service, exact alarms, battery-optimization prompt) implementations beyond the generic `expo-notifications` wrapper — these would need dedicated native config work.

### 16e. Final PRD verification / full regression pass — ❌ Not started
This is explicitly "do this last, right before delivery" per the doc's own structure — not something to attempt until items 1-15 (and the rest of 16) are actually closed. Flagging it as a checklist gate, not a task to schedule yet.

---

## What I need from you to move forward

Given the size of this list, a few items can't be scoped without more input:

1. **Item 6 (Caregiver Email Invite) & Item 11 (Caregiver Permissions)** — is there a live backend for this anywhere (even outside this repo), or is it 100% unbuilt? This changes whether these are frontend fixes or full-stack builds.
2. **Item 15 (20 Family Hub modules)** — do you have the actual PRD list of all 20 module names? Only 15 exist today and I can't guess the other 5.
3. **Item 16a (Reminders Tab)** — this is a genuinely large feature (a new tab, cross-member aggregation, a backend endpoint). Confirm you want this built as scoped in the PRD text, since it's one of the biggest single items on the whole list.
4. **Items 12 & 13's Appointments/Renewals gap** — both need the same missing backend aggregate endpoint (`/api/reminders/family` referenced client-side, 404s server-side). Worth raising with backend-team as one combined ask rather than three separate ones.

Otherwise: tell me which item number to start, and I'll ask for full detail on that one before writing any code, per the existing workflow.
