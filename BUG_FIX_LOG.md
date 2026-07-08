# LifeWise — Bug Fix Log

Branch: `aselea-frontend-fixers`
This is the running log of every bug and its status. We update it each time a bug is fixed.

Legend: ✅ Fixed &nbsp;|&nbsp; 🔧 In progress &nbsp;|&nbsp; ⬜ Not started &nbsp;|&nbsp; ⛔ Blocked (needs owner: API keys / accounts) &nbsp;|&nbsp; 📄 Documented for backend team

---

## ✅ Fixed

| # | Bug | Where | Fixed on |
|---|-----|-------|----------|
| 2b | Leftover debug junk in Login screen | `app/(auth)/login.tsx` (handleLogin) | 2026-07-06 |
| 2c | Purple gradient → solid theme color (Reminder Detail + Edit Reminder header) | `app/bill-details/[billId].tsx`, `app/edit-reminder.tsx` | 2026-07-06 |
| 3  | Edit Reminder title alignment (now always left-aligned + scrolls) | `app/edit-reminder.tsx` | 2026-07-06 |
| 9  | Two Cancel buttons in popups (incl. Snooze Reminder) | `app/(tabs)/index.tsx`, `reports.tsx`, `settings.tsx`, `voice-reminder.tsx`, `bill-details/[billId].tsx` | 2026-07-06 |
| 10 (frontend part) | Money Leaks "How It Works" — now explains what counts as a leak AND what's always excluded (bills, EMIs, insurance, medical, education, rent, tax, investments) | `app/(tabs)/leaks.tsx` | 2026-07-08 |
| 3b | Recurrence: Weekly/Monthly now clearly prompt for the specific day; Daily/Yearly no longer force a picker | `app/edit-reminder.tsx` | 2026-07-08 |
| 8  | Removed all drop shadows app-wide (cards, buttons, modals, chat bubbles) — kept only the decorative loader glow (not a UI drop-shadow) | 9 files: `(tabs)/index.tsx`, `(tabs)/reports.tsx`, `(tabs)/transactions.tsx`, `support/index.tsx`, `support/create.tsx`, `support/chat/[id].tsx`, `bill-history/[billId].tsx`, `components/CustomModal.tsx`, `components/CustomAlert.tsx`, `components/ErrorFallback.tsx` | 2026-07-08 |
| 6b | Date of Birth picker: (1) not opening on tap — fixed a stuck `showDatePicker` state on Android after a dismissed picker; (2) picking a date wasn't showing in the field — a `useEffect` was re-syncing the form from stale server data on every re-render and silently overwriting the date you just picked, before you'd even hit Save | `app/profile.tsx` | 2026-07-08 |
| 5  | Scan Bill screen redesign — clearer preview step (icons + hint text), labeled edit-details form with a proper ₹ amount field, removed double-cancel (X + Discard) and purple gradient button to match the rest of the app | `app/scan-bill.tsx` | 2026-07-08 |
| 6 (frontend part) | Avatar upload: fixed the code that stripped `file://` off the photo's URI before upload — that prefix is required for the upload to work correctly on Android | `lib/upload-avatar.ts` | 2026-07-08 |
| 4  | Home stats read as broken when the "last month fallback" is active — "Today" showed ₹0 and "Daily Avg" looked mismatched right next to a "Last Month" total with no explanation; added clarifying labels + a spending-insight message for this case | `app/(tabs)/index.tsx` | 2026-07-08 |
| 14 | Reports: the "Multi-Month" custom-combination filter (pick e.g. Jan+Mar+Jul) was fully built (calculations, month-picker UI) but had **no button anywhere** to turn it on — added the missing filter chip. Also added a "Year: 2026" pill so the year can be changed while in Month/Multi-Month mode (previously silently stuck on the current year) | `app/(tabs)/reports.tsx` | 2026-07-08 |

---

## 📄 Documented for backend team (not yet fixed — needs backend engineer)

| # | Bug | Doc | Notes |
|---|-----|-----|-------|
| 10 (backend part) | Leak detection wrongly flags essential payments (bills/health/education) as leaks; `monthlyEstimate` math bug (divides by 1, so it's really a lifetime total, not monthly) | [backend-team/BUG-10-money-leak-detection.md](backend-team/BUG-10-money-leak-detection.md) | Full guide with exact line numbers, root cause, and fix code |
| 15 | Snoozed reminders never come back — `status: 'snoozed'` is set correctly but nothing ever reverts it once the snooze period ends, so the bill vanishes from overdue alerts forever | [backend-team/BUG-15-snooze-and-BUG-6-avatar-upload.md](backend-team/BUG-15-snooze-and-BUG-6-avatar-upload.md) | Frontend needs zero changes — will pick this up automatically once backend fix ships |
| 6 (backend part) | Avatar upload requires an AWS S3 bucket (`AWS_S3_BUCKET` / `AWS_REGION`) that isn't documented anywhere in this repo — needs confirmation it's actually configured on the server | [backend-team/BUG-15-snooze-and-BUG-6-avatar-upload.md](backend-team/BUG-15-snooze-and-BUG-6-avatar-upload.md) | Same doc as #15 above (both bugs covered together) |
| 2  | Attach Scan photo never saves to an existing reminder — `PUT /api/bills/:id` silently drops `imageUrl`/`imageKey` because they're missing from its field whitelist, even though the scan/upload/OCR pipeline works correctly | [backend-team/BUG-2-attach-scan-not-saving.md](backend-team/BUG-2-attach-scan-not-saving.md) | 2-line fix, exact code included in the doc |

---

## ⬜ Not fixed yet

| # | Bug | List item | Where | Notes |
|---|-----|-----------|--------|-------|
| 1  | Google login broken | #1 | `lib/auth-context.tsx`, server auth | ⛔ Needs real Google OAuth client IDs from owner |
| 7  | Voice reminder multilingual | #7 | `app/voice-reminder.tsx`, server voice route | ⛔ needs OpenAI key confirmed |
| 11 | Family Hub 15-feature system | #11, #12 | `app/family.tsx`, `app/add-family-member.tsx`, server | Major feature |
| 16 | General bug sweep | #16 | whole app | Ongoing |

---

## How to test each fixed bug

### 2b — Login screen cleanup
- Open the **Login** screen. It should look and behave exactly as before (nothing visible changed — this was invisible junk removal).
- Type a wrong email format → still shows "Please enter a valid email address". Login still works normally.

### 2c — Purple gradient → solid color
- **Reminder Detail:** open any reminder/bill that has **no scan attached** (shows "Digital Summary Available"). The **"Attach Official Bill Scan"** button should now be a **solid brand-purple** (`#8B5CF6`), not a purple→blue gradient, with no drop shadow.
- **Edit Reminder:** open Edit Reminder (or "New Reminder"). The **top header** should now be the same solid brand-purple, not the dark navy (`#1E1B4B`).

### 3 — Edit Reminder title alignment
- Open **Edit Reminder** on any existing reminder with a long name.
- The title text in the header should **start from the left** and read left-to-right.
- Type a very long name → text should scroll within the field instead of jumping to the right edge.

### 9 — Single Cancel button in popups
Open each popup below and confirm there is **only ONE** way to dismiss it (no top-right "X" AND a "Cancel" at the same time):
- **Home tab:** tap an overdue reminder → **Snooze** → the "Snooze Reminder" popup should show options + one **Cancel** at the bottom, and **no X** in the corner.
- **Reports tab:** custom date range → Start date / End date pickers, and the "Pick year" popup → each has one **Cancel** only.
- **Settings:** "Select Currency" and "Set Monthly Budget" popups → one **Cancel** only.
- **Voice Reminder:** "Select time" and "Repeat" popups → one **Cancel** only.
- **Bill Detail:** "Repeat" popup → one **Cancel** only.

### 10 (frontend part) — Money Leaks "How It Works"
- Open the **Money Leaks** tab.
- Below the "Potential Savings" card, the **"How it works?"** section should now show two parts:
  1. What counts as a leak (frequent merchant, price hikes, unused subscriptions).
  2. A new **"What's never counted as a leak"** section listing bills, EMIs/loans, insurance, medical, education, rent, tax, investments/savings.
- Note: the actual leak **numbers** on this screen won't be fully correct until the backend team applies the fix in `backend-team/BUG-10-money-leak-detection.md` — the frontend text is accurate to the *intended* behavior, but today's backend logic doesn't fully match it yet (see that doc for specifics).

### 3b — Recurrence Weekly/Monthly date picker
- Open **Edit Reminder** (or create a new reminder).
- Tap **Weekly** in the Recurrence row → a date picker opens automatically with the hint "Choose the day of the week this repeats on" (iOS) / opens the native picker directly (Android).
- Tap **Monthly** → picker opens with the hint "Choose the date of the month this repeats on".
- Tap **Daily** or **Yearly** → no picker interruption, since those don't need a specific day chosen.
- Whatever date you pick becomes the reminder's due date, which the app uses to derive the weekday/day-of-month pattern.

### 8 — No drop shadows anywhere
- Browse the app broadly: Home (voice/scan/AI circles), Reports (export button), Transactions (summary card, transaction rows), Support (ticket cards, add button, chat bubbles), Bill History (timeline cards), any popup (uses `CustomModal`/`CustomAlert`), and error screens.
- None of these should show a soft drop-shadow/glow beneath them anymore — flat borders only.
- Exception (by design, not a bug): the small spinning loader dot (`PremiumLoader`, shown during data loads) still has a colored glow — that's a decorative animation effect, not a card/button shadow, so it was intentionally left as-is.

### 6b — Date of Birth picker
- Open **Edit Profile** → tap the **Date of Birth** field.
- The calendar should open on the **first tap**, every time — including if you tap it, cancel/tap outside, then tap it again right after.
- Pick a date → **it must now appear in the field immediately** (e.g. "2026-03-15"), not stay blank.
- Tap **Save Changes** → go back into Edit Profile → the date you picked should still be there (confirms it actually saved, not just displayed locally).

### 5 — Scan Bill redesign
- Open **Scan Bill** (from Home or Bill Detail's "Attach Official Bill Scan").
- Take or pick a photo → the **preview step** now shows a hint ("Make sure the amount and due date are clearly visible") and two clear buttons: **Retake** (outlined, with icon) and **Extract Details** (solid, with a sparkle icon) — no more plain unlabeled boxes.
- After scanning, the **review popup** should have only **one** way to dismiss it (a "Discard" button — no X in the corner anymore) and a solid-purple **Save/Update Bill** button (no gradient).
- Tap **Modify Details** → the edit form now shows clear labels ("Bill Name," "Amount," "Due Date") and the Amount field has a **₹ symbol** prefix instead of a bare number box.

### 6 (frontend part) — Avatar upload
- Open **Edit Profile** → tap the profile photo → pick an image from your gallery.
- This fix alone **cannot make uploads fully work** — it only fixes the app-side file bug. If the backend's AWS S3 storage isn't set up yet, you'll still see a "Failed" error, but now with the message **"S3 bucket not configured"** instead of a generic failure — that specific message means the frontend fix worked and the remaining problem is on the backend (tracked in `backend-team/BUG-15-snooze-and-BUG-6-avatar-upload.md`).
- Once the backend team confirms S3 is set up, retest — the photo should upload and appear as your avatar immediately.

### 4 — Home stats during "last month fallback"
- This only shows up when your account has **zero transactions in the current calendar month** but has transactions from last month (the fallback trigger).
- Open **Home**. The big card should say **"Last Month"** (not "This Month") and show last month's total.
- Look at the **"Today"** stat right below it — it should now be labeled **"Today (no spend yet)"** instead of a bare "Today" showing ₹0 with no explanation.
- The **"Daily Avg"** stat should now be labeled **"Avg (last mo.)"** to make clear it's not this month's average.
- The "Spending Insight" card further down should say something like *"No spending recorded yet this month — figures below are from last month..."* instead of the normal daily-spend message.
- Note: this bug was about **clarity, not wrong numbers** — the underlying math was already correct; it just looked broken without labels. If your test account currently has transactions this month, you won't see fallback mode at all (that's expected — everything shows "This Month" normally).

### 2 — Attach Scan flow (root cause found, fix documented for backend)
- **Confirmed root cause:** the scan/upload/OCR pipeline works correctly end-to-end, but the server's `PUT /api/bills/:id` route silently drops the photo's `imageUrl` when saving it back to an existing reminder — so the photo never actually attaches, even though no error is shown.
- **No frontend fix needed** — this is a 2-line backend fix, documented in `backend-team/BUG-2-attach-scan-not-saving.md`.
- **To test once the backend team applies it:** open a reminder with no scan attached → tap "Attach Official Bill Scan" → scan any bill photo → go back to Bill Detail → it should now show "Official Bill" with the photo instead of "Digital Summary Available."

### 14 — Reports: Multi-Month filter + PDF export
- **Important context:** this feature turned out to already be almost fully built (filters, custom date range, charts, and a full PDF export with a spending breakdown and top-merchants table). The one real bug was that "Multi-Month" (combining separate months like Jan + Mar + Jul) had no button to access it at all.
- Open **Reports**. In the filter row at the top, you should now see a new **"Multi-Month"** chip alongside Today/Week/Month/3M/6M/Year/Custom.
- Tap **Multi-Month** → a row of month chips (Jan–Dec) appears below — tap multiple months to select/deselect them (unlike "Month," which only allows one).
- A new **"Year: 2026"** pill should appear above the month row (in both Month and Multi-Month modes) — tap it to open the year picker and change the year.
- Tap the **"PDF Report"** button (top-right) — it should generate and let you share/save a formatted PDF report with your selected months' data, charts, and a top-merchants table.
- Try the other filters too (Today, Week, 3M, 6M, Year, Custom) — these were already working; just confirm they still look right.

---

## How to run the app to test
```
cd "d:/ASELEA Work/Life Wise/lifewise-app"
npm run start        # Expo dev server, then press a (Android) / i (iOS) / scan QR
```
Make sure the backend is reachable (set `EXPO_PUBLIC_DOMAIN` to your PC IP:port if testing on a physical device).

