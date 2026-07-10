# Family Hub — Backend Implementation Guide (Phase 5 of 5)

**Audience:** Backend team
**Status:** Frontend (Phases 1–4) is fully built and working — every feature below already exists in the app, storing data **on-device** (AsyncStorage) so it's usable today without a server. This document describes what to build server-side so data syncs across devices, survives app reinstalls, and (for one feature) reaches other family members' phones.
**Do not treat this as urgent/blocking** — the app works right now without any of this. Build in the priority order below as time allows.

---

## 1. Background — what Family Hub is and how it works today

Family Hub lets a user add family members (parents, kids, etc.) and pick which of **15 features** to track for each one — medicines, doctor appointments, bills, and so on. Only the features a user selects show up on that member's dashboard.

**Current architecture (frontend-only):**
- Every feature's data (a bill, a health reading, a check-in) is saved locally on the phone via `AsyncStorage`, keyed by family member ID.
- This means: works offline, no server needed, but **data doesn't sync between devices** and **is lost if the user reinstalls the app or switches phones**.
- One existing piece already IS server-backed: **Medicine Tracking** — it was built before this project and already has full API routes (`server/routes.ts:2758` onward) and its own MongoDB sub-document structure inside `family_members`. Use it as your reference pattern — every new feature below should follow the same shape.

**Your job:** for each feature, add a MongoDB collection + REST routes shaped like the ones already in `server/routes.ts` for bills/medicines, so the app can eventually swap local `AsyncStorage` calls for real `apiRequest(...)` calls with zero UI changes needed.

---

## 2. The existing pattern to copy

Every route you write should follow this exact shape (copied from the real, working `family_members`/bills pattern already in the codebase):

```ts
// server/routes.ts — near the other family sub-resource routes

app.get('/api/family/:memberId/<feature>', authMiddleware, async (req, res) => {
  try {
    const member = await family.findOne({ _id: toId(req.params.memberId), userId: (req as any).userId });
    if (!member) return res.status(404).json({ message: 'Family member not found' });
    return res.json(member.<feature> || []);
  } catch (err) {
    return res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/family/:memberId/<feature>', authMiddleware, async (req, res) => {
  try {
    const memberId = req.params.memberId;
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`, ...req.body, createdAt: new Date() };
    const result = await family.updateOne(
      { _id: toId(memberId), userId: (req as any).userId },
      { $push: { <feature>: item } } as any,
    );
    if (result.matchedCount === 0) return res.status(404).json({ message: 'Family member not found' });
    return res.status(201).json(item);
  } catch (err) {
    return res.status(500).json({ message: 'Server error.' });
  }
});

app.patch('/api/family/:memberId/<feature>/:itemId', authMiddleware, async (req, res) => { /* update one field, e.g. mark done/paid */ });
app.delete('/api/family/:memberId/<feature>/:itemId', authMiddleware, async (req, res) => { /* $pull from the array */ });
```

**Storage decision — same collection, not new ones.** Store each feature's items as an array field on the existing `family_members` document (same as `medicines` already does), not as separate MongoDB collections. This matches the existing pattern, keeps one `GET /api/family` call able to return everything for a member, and avoids a bigger migration.

---

## 3. IMPORTANT — fix this first (blocks everything else)

**`GET /api/family` currently does not return the `features` field.**

```ts
// server/routes.ts:485-491 — CURRENT (missing features)
const out = list.map((m: any) => ({
  id: m._id.toString(),
  name: m.name,
  relationship: m.relationship || 'self',
  avatarUrl: (m as any).avatarUrl || null,
  medicines: Array.isArray(m.medicines) ? m.medicines : [],
}));
```

It IS saved correctly by `POST`/`PUT /api/family` (lines 501-508, 519-529) — it's just missing from what `GET` sends back. Because of this gap, the frontend currently treats **on-device storage as the source of truth** for which features are enabled (see `lib/family-features.ts` — `loadMemberFeatures()`/`saveMemberFeatures()`), which is why the app works despite this gap. But it should still be fixed so a fresh install / new device can see the right features.

**Fix — one line:**
```ts
const out = list.map((m: any) => ({
  id: m._id.toString(),
  name: m.name,
  relationship: m.relationship || 'self',
  avatarUrl: (m as any).avatarUrl || null,
  features: Array.isArray(m.features) ? m.features : [],   // ADD THIS LINE
  medicines: Array.isArray(m.medicines) ? m.medicines : [],
}));
```

**One more thing to know:** the `features` field's *shape* changed during frontend development. Old members (created before Phase 1) may have the legacy shape `{ medicines: true, reminders: true, reports: false }`; new members use a flat array `['medicines', 'bills', 'health', ...]`. The frontend already has a converter for this — `normalizeFeatures()` in `lib/family-features.ts` — so **you don't need to migrate old documents**, just return whatever's stored as-is; the app handles both shapes.

---

## 4. Feature-by-feature: what to build

For each feature, this table gives you: the local data shape to mirror, the array field name to use on `family_members`, and any special notes.

| # | Feature | Frontend type (in `lib/family-records.ts`) | Suggested field on `family_members` | Notes |
|---|---|---|---|---|
| 1 | Doctor Appointments | `Appointment` | `appointments[]` | Standard CRUD |
| 2 | Health Monitoring | `HealthLog` | `healthLogs[]` | Standard CRUD |
| 3 | Medication Stock | `MedicationStockItem` | `medicationStock[]` | `adjustStock` needs a PATCH that increments/decrements `quantityRemaining` |
| 4 | Daily Routine | `RoutineItem` | `routines[]` | Standard CRUD + toggle enabled |
| 5 | Bill Management | `FamilyBill` | `familyBills[]` | Standard CRUD + toggle paid |
| 6 | Subscription Tracking | `FamilySubscription` | `subscriptions[]` | Standard CRUD |
| 7 | Expense Tracking | `FamilyExpense` | `familyExpenses[]` | Standard CRUD |
| 8 | Reminder Tasks | `FamilyTask` | `familyTasks[]` | Standard CRUD + toggle completed |
| 9 | Insurance & Documents | `FamilyDocument` | `documents[]` | See §6 re: file uploads |
| 10 | Call & Check-in | `CheckinItem` | `checkins[]` | Standard CRUD + toggle enabled + "mark done" |
| 11 | Travel & Visits | `TravelItem` | `travelItems[]` | Standard CRUD + toggle completed |
| 12 | Emergency Alerts | `EmergencySettings` + `EmergencyLogEntry` | `emergencySettings` (object, not array) + `emergencyLog[]` | **See §5 — this one needs a scheduled job, not just CRUD** |
| 13 | Custom Feature | `CustomFeatureConfig` + `CustomTrackerItem` | `customConfig` (object) + `customItems[]` | Standard CRUD |
| 14 | Diet & Food | *(not built yet — frontend team hasn't built this screen)* | — | No backend work needed until frontend builds it |

Exact field names/types for each are fully spelled out in `lib/family-records.ts` in this repo — copy the TypeScript interfaces directly; they're already the contract the frontend expects.

---

## 5. Emergency Alerts — the one feature that's genuinely backend-only in part

This is the most important section — read carefully, since it's the one place the frontend **cannot** fully solve this itself.

### What already works today, 100% on-device, no backend needed
The app can already:
- Check a member's medicines for missed doses (comparing scheduled time slots vs. `lastTakenAt`/`lastStatus`, already present on each medicine sub-document).
- Fire a **local notification on the same phone** where the check was run.
- Log the alert in a local history list the user can acknowledge.

This works today because the person checking (e.g. running the app, tapping "Check Now") IS the person whose phone should get the alert — no cross-device delivery needed for that half.

### What genuinely needs the backend
Per the product spec: *"Notify family if medicine is missed"* implies alerting **someone else** — e.g., the son's phone should get notified if his father (a different LifeWise account/device) misses his medicine. The phone running the check does not have the *other* family member's push token — only your server does. This is not something local storage can solve; it needs:

1. **A scheduled server job** that periodically checks every `family_members` document for missed medicines / no-activity conditions — same pattern as the existing bill-reminder scheduler at `server/routes.ts:2944` (`startReminderScheduler`, a `setInterval` running every 60 seconds). Model your emergency-check job on this exact function.
2. **Sending the push notification to the *owning user's other registered devices* or, if you build multi-user family sharing, to linked accounts** — reuse the existing Firebase Messaging + `pushTokens` collection pattern already working at `server/routes.ts:3169-3180` (`getFirebaseMessaging()`, `pushTokens.find(...)`, `messaging.sendEachForMulticast(...)`).

**Open question for product, not something to guess at:** does "notify family" mean (a) notify other devices logged into the *same* LifeWise account, or (b) notify a *different* person's account who's been linked as a "co-caregiver" for this family member? The current schema has no concept of (b) — family members belong to one `userId` only. If (b) is wanted, that's a bigger schema change (a family-member-sharing/invite system) and should be scoped as its own discussion before building, not assumed here.

### Suggested job logic (pseudocode, model on the existing scheduler)

```ts
const EMERGENCY_CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 min is reasonable

function startEmergencyAlertScheduler() {
  setInterval(async () => {
    const members = await family.find({ 'emergencySettings.missedMedicineAlertEnabled': true }).toArray();
    for (const member of members) {
      const missed = findMissedMedicines(member.medicines, member.emergencySettings.missedMedicineThresholdHours);
      if (missed.length > 0) {
        // 1. Push to the user's own devices via pushTokens (same pattern as line 3169)
        // 2. Optionally $push an entry into member.emergencyLog so it shows in-app too
      }
    }
  }, EMERGENCY_CHECK_INTERVAL_MS);
}
```

The `findMissedMedicines()` detection logic is already written and battle-tested on the frontend — see `lib/family-records.ts` (`findMissedMedicines`, `parseSlotTimeToday`). Port that same logic server-side rather than re-deriving it; it's a small, pure function with no dependencies.

---

## 6. Insurance & Documents — file attachments (future, not required now)

The frontend's `FamilyDocument` type currently only stores text (title, type, reminder date, notes) — no photo/file upload yet. If product wants actual document photos/PDFs attached (implied by "document tracking" in the spec), that would reuse the **existing S3 upload pattern** already in this codebase (`POST /api/avatar`, `POST /api/bills/scan/preview` — see `backend-team/BUG-15-snooze-and-BUG-6-avatar-upload.md` for the S3 configuration status, since avatar upload is currently blocked on the same S3 bucket question). Not required for Phase 5 — flagging so it's not forgotten if product asks for it later.

---

## 7. Suggested priority order

1. **Fix `GET /api/family` to return `features`** (§3) — one line, unblocks everything else being testable end-to-end.
2. **Medicine Tracking already works** — no action needed, just confirm it's still solid.
3. **CRUD routes for the 12 straightforward features** (§4 table, everything except Emergency Alerts) — mechanical, same pattern repeated 12 times, could be split across engineers in parallel since they don't depend on each other.
4. **Emergency Alerts scheduled job + push delivery** (§5) — needs the product clarification above before or during implementation.
5. **Document file uploads** (§6) — only if/when product asks for it.

---

## 8. How to verify each route once built

For any feature, the test is the same:
1. Call `POST /api/family/<memberId>/<feature>` with a body matching the frontend's TypeScript interface → confirm `201` and the item comes back with an `id`.
2. Call `GET /api/family` → confirm the new item appears nested under that member.
3. Call the update/toggle route → confirm the field changed.
4. Call the delete route → confirm the item is gone from a follow-up `GET`.
5. For Emergency Alerts specifically: seed a medicine with an old, unmarked time slot, wait for (or manually trigger) the scheduler, and confirm a push notification arrives and an `emergencyLog` entry was created.

No frontend changes are needed for any of this — once routes exist, swapping the frontend's `AsyncStorage` calls in `lib/family-records.ts` for `apiRequest(...)` calls is a small, mechanical follow-up task (same function signatures, just swap the implementation), not a redesign.
</content>
