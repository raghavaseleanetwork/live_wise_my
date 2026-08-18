# Caregiver Permissions — Enforcement Test Plan (§9 re-run)

**Audience:** QA / whoever has two test accounts
**Date:** 2026-08-18
**Why this exists:** the backend has confirmed permissions now persist and
round-trip. This is the test that proves the **originally reported bug** is
closed: *"a caregiver set to View only can still add and edit records."*

Everything else in the thread has been verified. This has not, because it needs
two logged-in accounts on a device — it cannot be checked from the codebase or
by probing the API unauthenticated.

---

## Setup

- **Account A** (owner) — adds member **M** with at least 4 modules enabled,
  e.g. Medicine Tracking, Health Monitoring, Doctor Appointments, Call & Check-in.
- **Account B** (caregiver) — a second real account, invited by A to M and
  accepted.
- Both on a build that includes today's client changes.

---

## Part 1 — Does the restriction reach the app at all?

| # | Do this | Expected |
|---|---|---|
| 1.1 | As **A**: Family Hub → M → Caregivers → tap the settings icon on B's row | Permissions screen opens |
| 1.2 | Set **View only**, untick **All modules**, tick only **Health** + **Check-in**, Save | Saves without error |
| 1.3 | Back on the caregiver list, look at B's row | Subtitle reads **"View only · 2 modules"** |
| 1.4 | Force-close the app, reopen, return to that screen | Still shows **"View only · 2 modules"** (proves it persisted server-side, not just in memory) |

**If 1.4 fails**, the permissions are not being stored or returned — stop and
report that, everything below depends on it.

---

## Part 2 — The originally reported bug

Now on **Account B's** device.

| # | Do this | Expected |
|---|---|---|
| 2.1 | Open M from Family Hub | Only **Health Monitoring** and **Call & Check-in** appear. Medicine and Appointments are **absent** |
| 2.2 | Look at the top of that screen | Amber banner: *"View only — you can see this member's data but cannot make changes."* |
| 2.3 | Open **Call & Check-in** | **No + button** in the header |
| 2.4 | If any check-ins exist, look at a row | **No edit (pencil) or delete (bin) icons** |
| 2.5 | Tap the done/tick control on a row | **Nothing happens** — it is disabled |
| 2.6 | Repeat 2.3–2.5 on **Health Monitoring** | Same result |

**2.3 is the original bug.** If the + button is there, it is not fixed.

---

## Part 3 — Mark-done level works

As **A**, change B to **Mark as done**, keep the same 2 modules.

| # | Do this | Expected |
|---|---|---|
| 3.1 | As B, reopen M (pull to refresh or reopen the screen) | Banner is **gone** |
| 3.2 | Tap the done/tick control on a check-in | **Works** — marks done |
| 3.3 | Look at the header | Still **no + button** (add needs Full) |
| 3.4 | Look at a row | Still **no edit/delete icons** |

---

## Part 4 — Full access

As **A**, change B to **Full access**, still 2 modules.

| # | Do this | Expected |
|---|---|---|
| 4.1 | As B, reopen M | **+ button present** on Health and Check-in |
| 4.2 | Add a check-in | Saves successfully |
| 4.3 | Open M's module list | Still only **2 modules** — level and scope are independent |

---

## Part 5 — Nothing was broken for normal users

| # | Do this | Expected |
|---|---|---|
| 5.1 | As **A** (the owner), open M | **All 4 modules**, no banner, all buttons present |
| 5.2 | As A, open a member with **no caregivers at all** | Everything works exactly as before |
| 5.3 | A caregiver connected **before** this feature existed, if one exists | Still has full access — nothing silently revoked |

**Part 5 matters as much as Part 2.** The failure mode of a permissions bug is
locking out legitimate users.

---

## Part 6 — Server actually enforces it (not just the UI)

The UI hiding a button is a courtesy; the server is the real gate. If anyone can
run authenticated API calls as **B**:

| # | Call | Expected |
|---|---|---|
| 6.1 | `GET /api/family/M/checkins` while B is `view` | **200** |
| 6.2 | `POST /api/family/M/checkins` while B is `view` | **403** |
| 6.3 | `PATCH /api/family/M/checkins/:id` (mark done) while B is `view` | **403** |
| 6.4 | Same PATCH while B is `mark_done` | **200** |
| 6.5 | `POST /api/family/M/checkins` while B is `mark_done` | **403** |
| 6.6 | `GET /api/family/M/appointments` while B is scoped to Health+Check-in | **403** |

Optional if API tooling isn't set up — Parts 1–5 are the user-facing proof.

---

## Known limitation (not a bug)

**Add Medicine is owner-only for every caregiver**, at any access level. The
server's `POST /api/family/:id/medicines` has no caregiver path at all — this
predates the permissions work.

The client now hides/disables the save on that screen and explains why, rather
than letting a caregiver fill in the whole form and fail on save.

If caregivers *should* be able to add medicines, that needs a backend change
(open the route to `full`-level caregivers, consistent with every other module)
— it is a product decision, not a bug in this feature.

---

## Reporting a failure

For anything that fails, note: **which numbered step**, what you expected, what
happened, and B's exact permission setting at the time. For Part 6, include the
status code and response body — the backend team asked for that specifically.
