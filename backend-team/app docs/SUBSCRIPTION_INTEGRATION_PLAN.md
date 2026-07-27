# LifeWise — Subscription / Premium Integration Plan

**Source of truth:** `backend-team/app docs/LifeWise_Product_Logic_with_Timeline (1).docx`
**Scope of this task:** Add the full subscription/premium system (plans, prices, feature limits, paywall UI, plan management, feature gating) — **UI + client logic + local plan state only**. **No payment gateway** (no Apple IAP / Google Play Billing / RevenueCat) — that is a later phase. All "purchase" actions in this phase just set the user's plan locally so we can demo the gates and screens.
**UI rule:** Every new screen/component reuses the existing design system — `constants/colors.ts` theme tokens, `useTheme()`, the `SettingRow`/card patterns, Ionicons, `CustomModal`, `PremiumLoader`. It must look identical in style to the current app (dark + light).

---

## 1. What the document defines (extracted, exact)

### 1.1 Plans & prices (Section 4)

| Plan | Monthly | Yearly | Positioning |
|------|---------|--------|-------------|
| **FREE** | ₹0 | — | Get started, no card |
| **STARTER** | ₹99/mo | ₹799/yr (33% off) | Small family / couple |
| **FAMILY** ⭐ *Recommended* | ₹199/mo | ₹1,499/yr (37% off) | Complete family OS |
| **PRO** | ₹499/mo | ₹3,999/yr | Power users / business |

### 1.2 Per-plan limits (the numbers that drive every gate)

| Limit key | FREE | STARTER | FAMILY | PRO |
|-----------|------|---------|--------|-----|
| `familyMembers` | 2 | 4 | ∞ | ∞ |
| `modulesPerMember` | 3 (of 20) | 8 (of 20) | 20 | 20 |
| `reminders` (total) | 10 | 50 | ∞ | ∞ |
| `expenseHistoryDays` | 7 | 90 | 365 | ∞ |
| `billsPerMember` | 1 | 5 | ∞ | ∞ |
| `documents` | 1 | 10 | 50 | ∞ |
| `voiceReminderPerMonth` | 5 | 30 | ∞ | ∞ |
| `billScanPerMonth` | 3 | 20 | ∞ | ∞ |
| `wiseAiPerMonth` | 5 | 30 | 100 | 300 |
| `bankPdfImportPerMonth` | 0 | 1 | ∞ | ∞ |
| `caregiversPerMember` | 0 | 1 | ∞ | ∞ |
| `recurringTemplates` | 0 | 10 | ∞ | ∞ |
| `noticeboardPostsPerMonth` | 0 | 20 | ∞ | ∞ |
| `locationSharingMembers` | 0 | 0 | 6 | ∞ |

Boolean feature flags (available / not):

| Flag | FREE | STARTER | FAMILY | PRO |
|------|------|---------|--------|-----|
| `pdfReports` | ✗ | ✗ | ✓ | ✓ |
| `csvImport` | ✗ | ✓ | ✓ | ✓ |
| `moneyLeakAlerts` | ✗ | ✗ | ✓ | ✓ |
| `budgetAlerts` | ✗ | ✗ | ✓ | ✓ |
| `smsAutoDetect` (Android) | — | ✓ | ✓ | ✓ |
| `annualReportPdf` | ✗ | ✗ | ✗ | ✓ |
| `medicineInteraction` | ✗ | ✗ | ✗ | ✓ |
| `pillIdentifier` | ✗ | ✗ | ✗ | ✓ |
| `doctorHealthPdf` | ✗ | ✗ | ✗ | ✓ |
| `whatsappReminders` | ✗ | ✗ | ✗ | ✓ (beta) |
| `dataExportJson` | ✗ | ✗ | ✗ | ✓ |
| `medicineStockAlerts` | ✗ | ✓ | ✓ | ✓ |
| `healthGraph12mo` | ✗ | ✗ | ✓ | ✓ |
| `perMemberBreakdown` | ✗ | ✓ | ✓ | ✓ |
| `documentExpiryAlerts` | ✗ | ✓ | ✓ | ✓ |
| `sharedCaregiverAlerts` | ✗ | ✓ | ✓ | ✓ |

Always-on (all plans incl. FREE): Manual Quick Add, Current-month summary, 7-day history, basic charts, Aadhaar/PAN scan, Push notifications, Emergency SOS, Dark mode, Shared shopping list, Birthday reminders, no ads.

### 1.3 Free-trial rules (Section 5.3)
- 7-day **FAMILY** trial, auto-activated on **first install / signup**.
- No card required. Once per account only (no restart).
- Day-5 and Day-7 reminder notifications.
- After trial → reverts to FREE limits; **data kept, just hidden beyond limits**.
- Upgrading Starter→Family also grants a 7-day Family trial before billing (relevant later, with gateway).

### 1.4 Paywall UX (Section 5.1 / 5.2)
- **Soft paywall** = bottom sheet (first 3 triggers): feature illustration, benefit headline, 3 plan pills (STARTER | FAMILY | PRO) with FAMILY pre-selected + "Most Popular" gold badge, 3–4 benefit checklist specific to the blocked feature, CTA `Start 7-Day Free Trial` (first time) or `Upgrade Now`, secondary "See all plan features", dimmed "Continue on Free".
- **Hard paywall** = full-screen, non-dismissible, only for CRITICAL limits (member limit / reminder limit) after 3 soft dismissals; shows full comparison table; exit only via top-corner X.
- Copy is empathetic/benefit-focused, never "you hit the limit". The doc gives exact per-trigger copy + recommended plan (Section 5.1 table) — we hard-code those strings.

### 1.5 Trigger table (exact copy, from doc)
Each entry = `{ triggerKey, userAction, message, recommendedPlan }`. All 12 rows from Section 5.1 will be encoded verbatim (3rd member, 4th module, 11th reminder, 8-day history, PDF export, bank import, budget alerts, 4th bill scan, 6th WiseAI msg, 2nd document, location sharing, medicine interaction).

### 1.6 IAP note (documented, NOT built now)
Doc specifies react-native-iap / RevenueCat, product IDs `lifewise_{starter,family,pro}_{monthly,yearly}`, Apple/Google billing. **Deferred.** Plan leaves a clean seam (a `purchasePlan()` function) that today just sets local state and later calls the store.

---

## 2. Current app state (what already exists)

- **Expo + expo-router** app. Routes in `app/`, tab routes in `app/(tabs)/`.
- **Theme**: `constants/colors.ts` + `lib/theme-context.tsx` (`useTheme()` → `colors`, `isDark`). Accent `#8B5CF6`, gold-ish highlight can use `warning #F59E0B`.
- **Auth**: `lib/auth-context.tsx` — `user` object `{ id, email, name, phone?, ... }`. **No plan field yet.** Persisted in AsyncStorage.
- **Modules**: `lib/family-features.ts` — 15 `FamilyFeatureKey`s = the "modules per member" from the doc (doc says "20"; we currently have 15 built + can note the delta).
- **Settings**: `app/settings.tsx` (re-exported by `app/(tabs)/settings.tsx`) with `SettingRow` + sectioned cards — this is where "Manage Subscription" enters.
- **Admin panel** (`admin/`, Next.js) already has `plans` + `promo-codes` pages and the server seeds placeholder plans (`Basic Shield` / `Premium Guard` / `Enterprise Core`) — these **do not** match the doc. Handling described in §5.
- **Server**: `server/routes.ts` + `server/db/subscription-schema.ts`. User docs in Mongo `users` collection; the app-facing user object is built inline and has no plan field.
- No existing premium/paywall/gating code in the mobile app (`grep` confirmed zero hits).

---

## 3. Target architecture (this phase)

```
constants/plans.ts            NEW  Single source of truth: PLANS, LIMITS, FLAGS, PLAN_ORDER, pricing, trigger copy
lib/subscription-context.tsx  NEW  currentPlan, limits, trial state, isFeatureEnabled(), getLimit(), purchasePlan(), startTrial()
lib/entitlements.ts           NEW  Pure helpers: can(action, currentUsage) -> {allowed, reason, recommendedPlan}
components/PaywallSheet.tsx    NEW  Soft paywall bottom sheet (uses CustomModal patterns)
components/PaywallScreen.tsx   NEW  Hard paywall full-screen (route)
components/PlanBadge.tsx       NEW  Small pill showing current plan (FREE/STARTER/FAMILY/PRO)
components/LockBadge.tsx       NEW  Reusable "premium lock" overlay/icon for gated UI
app/subscription/index.tsx    NEW  "Manage Plan" screen — current plan card + trial banner + plan cards
app/subscription/compare.tsx  NEW  Full comparison table screen (Section 1.2/matrix)
app/paywall.tsx               NEW  Route host for hard paywall
lib/auth-context.tsx          EDIT add optional plan/trial fields to User + persist (local only)
app/settings.tsx              EDIT add "Subscription" section → "Manage Plan" row + PlanBadge
app/_layout.tsx               EDIT wrap tree in <SubscriptionProvider>; kick off first-run trial
```

State is **local-first** (AsyncStorage), mirroring how `family-features.ts` and onboarding already work, since there's no payment/verification backend this phase. Keys: `@lifewise_plan`, `@lifewise_trial` (`{ startedAt, used }`), plus monthly usage counters `@lifewise_usage_<yyyy-mm>` for the per-month limits (voice, scan, WiseAI, bank import, noticeboard).

---

## 4. Step-by-step implementation (execution order)

**Step 1 — Data layer (`constants/plans.ts`)**
Encode every table in §1.1/§1.2/§1.5 exactly: `PlanId = 'free'|'starter'|'family'|'pro'`, `PLAN_ORDER`, `PLAN_META` (name, tagline, monthly, yearly, yearlyDiscountLabel, recommended), `LIMITS[plan]` (all numeric keys, `∞` = `Infinity`), `FLAGS[plan]` (booleans), and `PAYWALL_TRIGGERS[triggerKey]` = `{ title, message, recommendedPlan, illustration, benefits[] }` with the doc's verbatim copy. No UI, no side effects — pure data + TS types.

**Step 2 — Entitlement engine (`lib/entitlements.ts`)**
Pure functions: `getLimit(plan, key)`, `isFlagEnabled(plan, key)`, `checkLimit(plan, key, currentCount) -> { allowed, recommendedPlan, triggerKey }`. Fully unit-testable, no React.

**Step 3 — Subscription context (`lib/subscription-context.tsx`)**
Loads plan + trial + usage counters from AsyncStorage; exposes `currentPlan` (FAMILY while trial active), `isTrialActive`, `trialDaysLeft`, `isFeatureEnabled(flag)`, `getLimit(key)`, `incrementUsage(key)`, `usage(key)`, `startTrial()`, `purchasePlan(planId, interval)` (this phase: just sets local plan — **placeholder for future IAP**), `restore()` (no-op stub now). Mirrors `AuthProvider` shape.

**Step 4 — Wire providers (`app/_layout.tsx`)**
Add `<SubscriptionProvider>` inside the auth provider. On first authenticated run with no trial record → `startTrial()` (7-day Family), matching doc §1.3.

**Step 5 — Reusable UI atoms (`PlanBadge`, `LockBadge`)**
Small themed components used across settings + gated screens.

**Step 6 — Manage Plan screen (`app/subscription/index.tsx`)**
Header (back arrow, "Subscription"), current-plan card, trial banner (`Your Family trial ends in X days` when active), 4 stacked plan cards with monthly/yearly toggle, feature bullet lists, FAMILY card gold-highlighted + "Most Popular" badge, per-card CTA (`Start 7-Day Free Trial` first time else `Choose plan`/`Current plan`), link to comparison screen. CTA → `purchasePlan()` (local) → success `CustomModal`. Pure existing design tokens.

**Step 7 — Comparison screen (`app/subscription/compare.tsx`)**
Scrollable comparison table from §1.2 + the full feature matrix (Section 6), grouped (Expense Entry / Reports / Family Hub / Reminders / Health / Documents / AI), ✓ / ✗ / value cells, current plan column highlighted.

**Step 8 — Paywall components (`PaywallSheet`, `PaywallScreen` + `app/paywall.tsx`)**
Soft sheet + hard full-screen per §1.4, driven by `triggerKey` → pulls copy from `PAYWALL_TRIGGERS`. Track soft-dismiss count (AsyncStorage) to escalate to hard paywall for member/reminder limits. A small `usePaywall()` helper (`presentPaywall(triggerKey)`) so any screen fires it in one line.

**Step 9 — Settings entry (`app/settings.tsx`)**
New "Subscription" section above "General": a `SettingRow` "Manage Plan" with `PlanBadge` on the right → `router.push('/subscription')`. Optional "Restore purchases" row (stub).

**Step 10 — Apply gates at trigger points (incremental, reviewable one-by-one)**
Insert `checkLimit(...)` + `presentPaywall(...)` at each of the 12 trigger sites the doc lists. Order (each its own small diff so scope stays confirmable per CLAUDE.md workflow):
1. Add 3rd family member (`app/add-family-member.tsx`)
2. 4th module in `FeatureSelector` / feature selection
3. 11th reminder (`edit-reminder` / reminder create path)
4. Expense history > 7 days (transactions/insights list)
5. PDF export button (reports)
6. Bank statement import
7. Budget alert setup (settings budget modal)
8. 4th bill scan (`scan-bill.tsx`)
9. 6th WiseAI message (`assistant.tsx`)
10. 2nd document (`family-documents`)
11. Location sharing
12. Medicine interaction (PRO)

Steps 1–9 = the subscription system + screens. Step 10 = wiring the gates, done in confirmable sub-batches.

---

## 5. Decisions to confirm before coding

1. **"20 modules"**: doc says 20 modules/member; app currently has 15 `FamilyFeatureKey`s. → *Proposed:* use the real current count for the FAMILY "all modules" state and keep FREE=3 / STARTER=8; don't invent 5 fake modules. Confirm.
2. **Admin placeholder plans** (`Basic Shield`/`Premium Guard`/`Enterprise Core`) don't match the doc. → *Proposed:* leave admin/server seed **untouched** this phase (out of scope; it's a separate admin dataset), and drive the mobile app purely from `constants/plans.ts`. Later phase can reconcile admin↔app. Confirm you don't want the seed rewritten now.
3. **Currency**: doc is in ₹ (INR). App has a multi-currency `useCurrency()`. → *Proposed:* show plan prices as fixed ₹ values (store pricing is region-fixed anyway), independent of the in-app display currency. Confirm.
4. **Trial on existing users**: doc says trial on first install. Existing logged-in users have no trial record. → *Proposed:* grant them the one-time 7-day trial on first run after this ships. Confirm.
5. **Enforcement strictness now**: with no backend verification, gates are client-side only. → *Proposed:* real blocking UI (paywall actually stops the action), but plan state is local/spoofable until IAP+backend lands. Confirm that's acceptable for this phase.

---

## 6. Explicitly OUT of scope this phase
- Any payment gateway: Apple IAP, Google Play Billing, RevenueCat, receipt verification, product registration.
- Server-side plan storage / enforcement / webhooks.
- Promo-code redemption in-app.
- Rewriting admin panel plans or server seed data.
- Actual data hiding/deletion beyond limits (we gate new actions; retroactive hiding of old data can be a follow-up).

---

## 6b. Phasing & progress

The work is split into three phases, executed one at a time.

### Phase 1 — Foundation (data + state) ✅ DONE (2026-07-24)
Files added/changed:
- `constants/plans.ts` — NEW. Truth file: `PlanId`, `PLAN_META` (names, taglines, ₹ monthly/yearly prices, discount labels, recommended flag, future store product IDs), `LIMITS` (all 14 numeric limits per plan, `Infinity`=unlimited/`0`=unavailable), `FLAGS` (16 boolean features per plan), `MONTHLY_LIMIT_KEYS`, `TRIAL` rules, and `PAYWALL_TRIGGERS` (all 12 triggers with verbatim doc copy, recommended plan, icon, benefits, `critical`). Plus `formatLimit`/`formatPlanPrice` helpers.
- `lib/entitlements.ts` — NEW. Pure React-free engine: `getLimit`, `isFlagEnabled`, `planAtLeast`, `lowestPlanFor(Flag)`, `checkLimit` and `checkFlag` (each returns `{ allowed, recommendedPlan, triggerKey }`).
- `lib/subscription-context.tsx` — NEW. `SubscriptionProvider` + `useSubscription()`. Local (AsyncStorage) plan + one-time 7-day Family trial + monthly usage counters. Exposes `currentPlan` (Family while trial active), `ownedPlan`, `isTrialActive`, `trialDaysLeft`, `canStartTrial`, `getLimit`, `isFeatureEnabled`, `usage`, `checkLimit`, `checkFlag`, `incrementUsage`, `startTrial`, `purchasePlan` (**local placeholder — payment-gateway seam**), `restore` (stub).
- `components/PlanBadge.tsx` — NEW. Themed plan pill (gold for Family, violet for paid, muted for Free; optional trial prefix + star).
- `components/LockBadge.tsx` — NEW. Reusable premium-lock chip for gated UI.
- `app/_layout.tsx` — EDIT. Wrapped tree in `<SubscriptionProvider>` (inside `AuthProvider`); auto-starts the one-time trial on first authenticated run.

Verified: `tsc --noEmit` reports **zero** new errors from these files (only pre-existing unrelated drizzle/admin errors remain). No UI is wired to the user yet — foundation only.

### Phase 2 — Screens & paywall UI (NEXT)
Manage Plan screen, Comparison screen, `PaywallSheet` + `PaywallScreen` + `usePaywall()`, Settings "Subscription" entry with `PlanBadge`, routes registered in `_layout.tsx`.

### Phase 3 — Gating at the 12 trigger points
Wire `checkLimit`/`checkFlag` + `presentPaywall` into each documented trigger site, in confirmable sub-batches.

---

## 7. Deliverable summary
After execution the app will have: a `constants/plans.ts` truth file matching the doc exactly, a `SubscriptionProvider` with local plan+trial+usage state, a themed **Manage Plan** + **Comparison** screen, **soft & hard paywall** components with the doc's exact copy, a settings entry with a plan badge, an automatic 7-day Family trial, and paywall gates at all 12 documented trigger points — with a clean `purchasePlan()` seam ready for the payment gateway later. Zero payment code.
```
```

---

## 8. Three-phase execution plan

The work is split into three phases, executed one at a time.

### Phase 1 — Foundation (data + state) — ✅ COMPLETE (2026-07-24)
No user-facing UI wiring; pure data, engine, state, and provider.
- `constants/plans.ts` — NEW. Truth file: `PlanId`, `PLAN_ORDER`, `PLAN_META` (names, ₹ prices, yearly discounts, recommended flag, future store product IDs), `LIMITS`, `MONTHLY_LIMIT_KEYS`, `FLAGS`, `TRIAL`, `PAYWALL_TRIGGERS` (all 12, verbatim copy), plus `formatLimit`/`formatPlanPrice`. Matches doc §1.1/§1.2/§1.5 exactly.
- `lib/entitlements.ts` — NEW. Pure engine: `getLimit`, `isFlagEnabled`, `planAtLeast`, `lowestPlanFor(Flag)`, `checkLimit`, `checkFlag`, with limit/flag→trigger maps.
- `lib/subscription-context.tsx` — NEW. `SubscriptionProvider` + `useSubscription()`. Local (AsyncStorage) plan / trial / monthly-usage state. Effective `currentPlan` is Family while trial active. `purchasePlan()` is the local-only seam for future IAP. Keys: `@lifewise_plan`, `@lifewise_plan_interval`, `@lifewise_trial`, `@lifewise_usage_<yyyy-mm>`.
- `components/PlanBadge.tsx`, `components/LockBadge.tsx` — NEW. Themed atoms.
- `app/_layout.tsx` — EDIT. Wrapped tree in `<SubscriptionProvider>` (inside `AuthProvider`); auto-starts the one-time 7-day Family trial on first authenticated run.
- Verified: `tsc --noEmit` produces zero errors in any new/edited file (pre-existing drizzle/admin errors are unrelated).

### Phase 2 — Screens & paywall UI — ✅ COMPLETE (2026-07-24)
- `app/subscription/index.tsx` — NEW. Manage Plan screen: current-plan hero card, trial banner ("Your Family trial ends in X days"), monthly/yearly toggle with save-badge, one card per plan with benefit lists, Family gold-highlighted + "Most Popular" star badge, per-card CTA (Start 7-Day Free Trial / Choose plan / Current plan / Downgrade), success alerts via `useAlert`, footnote that payment comes later.
- `app/subscription/compare.tsx` — NEW. Full comparison screen wrapping the shared table, current-plan column highlighted.
- `components/PlanComparisonTable.tsx` — NEW. Shared, horizontally-scrollable feature matrix (doc §1.2 + Section 6), grouped Core/Expense/Reports/Family/AI/Health/Other, ✓/✗/value cells, current column highlighted. Reused by compare screen + hard paywall.
- `components/PaywallSheet.tsx` — NEW. Soft paywall bottom sheet (feature illustration, benefit headline, 3 plan pills with Family pre-selected + "Most Popular", benefit checklist, trial/upgrade CTA, "See all plan features", dimmed "Continue on Free").
- `components/PaywallScreen.tsx` — NEW. Hard paywall full-screen takeover (non-dismissible except top-corner X, trial-expiry chip, full comparison table, sticky recommended-plan CTA).
- `lib/paywall-context.tsx` — NEW. `PaywallProvider` + `usePaywall()` → `presentPaywall(triggerKey)`. Renders soft/hard paywall; tracks soft-dismiss count and escalates critical triggers (member/reminder) to the hard paywall after 3 dismissals; upgrade action uses the local trial/purchase seam.
- `app/settings.tsx` — EDIT. New "Subscription" section → "Manage Plan" row with a `PlanBadge` (shows trial state).
- `app/_layout.tsx` — EDIT. Registered `subscription/index` + `subscription/compare` routes; wrapped tree in `<PaywallProvider>` (inside `SubscriptionProvider`).
- Verified: `tsc --noEmit` and `expo lint` both clean for all new/edited files (only pre-existing drizzle/admin errors remain). Route-type casts (`as any`) used for `/subscription*` until expo-router regenerates typed routes on next `expo start`.

### Phase 3 — Gating at the trigger points — ✅ COMPLETE (2026-07-24)
Wired `checkLimit`/`checkFlag` + `presentPaywall` at every documented trigger that has real UI in the app today.

**Gates wired (7 sites):**
1. **3rd family member** — `app/family.tsx`: `handleAddMember()` checks `familyMembers` against the owned-member count on both "+ Add Member" buttons (header + empty state).
2. **4th module** — `app/add-family-member.tsx` **and** `app/edit-family-member.tsx`: `toggleFeature()` checks `modulesPerMember` when turning a module ON.
3. **11th reminder** — `app/edit-reminder.tsx`: `handleSave()` checks `reminders` against `bills.length` when creating a new reminder (editing is exempt).
4. **Voice reminder (monthly)** — `app/voice-reminder.tsx`: `handleStartRecording()` checks + increments `voiceReminderPerMonth`.
5. **4th bill scan (monthly)** — `app/scan-bill.tsx`: shared `guardScan()` checks + increments `billScanPerMonth` at both camera and gallery entry points.
6. **6th WiseAI message (monthly)** — `app/assistant.tsx`: `handleSend()` checks + increments `wiseAiPerMonth`.
7. **PDF export** — `app/(tabs)/reports.tsx`: `handleExportPDF()` checks the `pdfReports` flag.
8. **2nd document** — `app/family-documents/[memberId].tsx`: `handleOpenAdd()` checks `documents` before opening the add form.

Each gate calls `presentPaywall(triggerKey)` when blocked; the paywall provider shows the soft sheet (or the hard screen for critical member/reminder limits after 3 dismissals). Monthly-metered actions record usage via `incrementUsage()` only when they proceed.

**Deferred (no built UI to attach to yet):** bank-statement PDF import, per-category/per-member budget alerts, family location sharing, medicine interaction check, and the 8-day expense-history scroll gate. These features aren't implemented in the app today (confirmed by grep — they appear only in subscription marketing copy), so their gates land when the features themselves are built. The entitlement engine already has the limits/flags + trigger copy ready for them (`bankImport`, `budgetAlerts`, `locationSharing`, `medicineInteraction`, `expenseHistory`).

Verified: `tsc --noEmit` clean and no new `expo lint` findings in any edited file (only pre-existing warnings on untouched lines remain).

---

**All three phases are complete, type-clean and lint-clean.** The subscription system is fully integrated: data model, entitlement engine, local plan/trial/usage state, Manage Plan + Compare screens, soft/hard paywalls, settings entry, auto 7-day Family trial, and paywall gates at every trigger point that has UI today. Payment gateway remains the one deferred piece, behind the `purchasePlan()` seam.
