# Notification Title Format & Actions — Frontend Reply

**Audience:** Backend team
**Date:** 2026-08-20
**Re:** Your status doc of 2026-08-20

Everything on your side checks out. **You were right about `sourceKind` and we
were wrong — the client has been fixed, no backend change needed.**

---

## The `sourceKind` mismatch — our error, now corrected

Thank you for flagging this instead of renaming to match our list. Renaming
`insurance` → `document` would have broken the documented contract of
`GET /api/reminders/family` to accommodate a mistake in our doc. You made the
right call.

**The server list is correct. Our doc was wrong.** We investigated on the client
and found the mismatch was a real bug on our side, not just a documentation
slip:

| Issue | Detail |
|---|---|
| `fitness` | Our Done dispatch had a `case 'fitness'` for a kind you never send — **dead code** |
| `insurance` | We had **no handling at all**. It fell through to `default` and **silently no-opped** |
| Type gap | `FamilyReminderKind` was missing **both** `insurance` and `custom` |

The gap hid because our `familyReminderLabel()` degrades unknown kinds
gracefully rather than crashing — so `insurance` reminders *rendered* correctly
and only the Done button was quietly broken.

### What we changed

1. **Widened `FamilyReminderKind`** to include `insurance` and `custom`.
   Deliberately did **not** add `fitness` — you confirmed no projection exists,
   so listing it would imply a kind that cannot arrive.

2. That widening then **broke three `Record<FamilyReminderKind, …>` maps** at
   compile time, which is how we learned the gap was real and not cosmetic. All
   three now have entries:

   | Map | `insurance` | `custom` |
   |---|---|---|
   | `KIND_META` | category `bills`, shield icon | category `others` |
   | `KIND_ROUTE` | `/family-documents` | `/family-custom` |
   | `KIND_LEAD_DAYS` | `[30, 7, 1]` | `[1, 0]` |

   The 30-day lead on `insurance` is deliberate — policy expiry is costly to
   miss and slow to act on, so it warns earlier than any other kind.

3. **`insurance` remains a no-op for Done, and that is correct.** It is a
   document tracked by **expiry date**, not completion — there is nothing to
   mark done. It now sits explicitly in the `default` branch alongside
   `medicine-stock` and `subscription`, each with its reason recorded, so a
   future reader can tell these were considered rather than forgotten.
   **Snooze works on all of them.**

The source doc has been corrected so the wrong list is not circulated again.

---

## Your other points

**§2 title format** — the `recordTitle` approach is the right call. Reformatting
`reminder.name` would have broken both the notification body text and the
`GET /api/reminders/family` contract; adding a separate field avoided that
entirely. Good catch on our behalf.

**Bill reminders in the in-app list** — agreed, leave them unprefixed. That list
already sits under a "Reminders" heading, so `Reminder: <name>` there would read
as redundant. Push titles are the place the prefix earns its keep, since they
appear on a lock screen with no surrounding context.

**§5 snooze `minutes`** — thank you for re-confirming. That had been flagged as
unverified across two docs; treating it as closed now.

**§6 sequencing** — noted that server-side scheduling was already shipped, so
the regression risk our doc warned about never applied. Good.

---

## Open item — for the client, not you

**Should `fitness` reminders exist at all?** The record kind is stored, but
nothing projects it into a reminder, so none are scheduled or pushed.

You were right not to fold that into a title-format pass. It is a product
question rather than a bug, it has not been requested, and we are not asking for
it now — flagging only so it is not mistaken for an oversight on either side.

---

## Status

| Item | Status |
|---|---|
| §2 title format | ✅ Done (yours) |
| §3 action buttons | ✅ Done (ours) |
| §4 `categoryId` | ✅ Confirmed |
| §5 snooze `minutes` | ✅ Confirmed |
| §6 sequencing | ✅ Satisfied |
| `sourceKind` mismatch | ✅ **Fixed client-side** |
| `fitness` reminders | ⏸️ Open, unrequested |

Nothing outstanding on your side. `tsc` clean here.
