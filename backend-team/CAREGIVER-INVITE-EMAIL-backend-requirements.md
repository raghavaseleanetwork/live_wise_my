# Caregiver Invite Email — Backend Requirements

**Audience:** Backend team
**Status:** New requirement, client-requested 2026-08-14.
**Depends on:** `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` (the
`POST /api/family/:memberId/connected-caregivers/invite` endpoint). If that
endpoint isn't built yet, build it first — this doc only adds one step to it.
If it's already built, this is the only change needed.

---

## 1. What the client asked for

> "I want that user to also receive an email that this person wants to add
> you to the family... What's currently happening is that the user is only
> receiving the notification on the app."

Today, when a caregiver is invited, the invitee only finds out via an
in-app/push notification (`{ type: 'caregiver-invite' }`). If they don't have
the app open, don't have a LifeWise account yet, or don't have a push token
registered, they never learn someone invited them. **Email is required as a
second, independent delivery channel** — it must not depend on the invitee
already being a registered app user.

This is **not** a new feature; it's one additional step inside the existing
invite endpoint.

---

## 2. What already exists — reuse it, don't rebuild it

This server already sends transactional email via **Resend** for bill
reminders and OTP verification. Everything needed already lives in
`server/routes.ts`:

- `RESEND_API_KEY` — env var, already read at the top of `server/routes.ts`.
- `REMINDER_EMAIL_FROM` — env var (falls back to
  `'LifeWise <no-reply@lifewise.app>'`), the `from` address already used.
- `sendReminderEmail({ to, subject, html })` — generic Resend send function.
  Nothing reminder-specific about it; it takes any `to`/`subject`/`html` and
  fires the email. **Reuse this function as-is**, do not write a second one.
- `renderReminderEmailTemplate(params)` — loads a cached HTML template string
  and does `{{PLACEHOLDER}}` replacement.

**Do not** add a new email provider, SDK, or `.env` key for this. If
`RESEND_API_KEY` is already set in the deployment environment (it must be,
for reminder emails to be working today), this requires zero new
configuration.

---

## 3. What to add

### 3.1 Template (already provided)

A ready-to-use HTML template has been added to the repo at:

```
server/templates/caregiver-invite-email.html
```

It matches the visual style of the existing `server/templates/reminder-email.html`
(same header gradient, card layout, button, footer) so invite emails look
consistent with reminder emails.

**Placeholders in the template** — replace all with
`String.replace(/{{X}}/g, value)`, same mechanism `renderReminderEmailTemplate`
already uses:

| Placeholder | Value | Source |
|---|---|---|
| `{{INVITER_NAME}}` | Name of the person sending the invite | `invitedByName` on the invite doc |
| `{{INVITER_EMAIL}}` | Email of the person sending the invite | `invitedByEmail` on the invite doc |
| `{{MEMBER_NAME}}` | Name of the family member being shared | `memberName` on the invite doc |
| `{{INVITEE_EMAIL}}` | Email address the invite was sent to | `inviteeEmail` on the invite doc |
| `{{APP_URL}}` | Deep link / app URL | Same constant already used for `renderReminderEmailTemplate`'s `{{APP_URL}}` |

### 3.2 Template loader + render function

Add a `CAREGIVER_INVITE_EMAIL_TEMPLATE` constant next to the existing
`REMINDER_EMAIL_TEMPLATE`, loaded the same way (read the file once, cache in
memory). Then add a render function mirroring
`renderReminderEmailTemplate()`:

```ts
function renderCaregiverInviteEmailTemplate(params: {
  inviterName: string;
  inviterEmail: string;
  memberName: string;
  inviteeEmail: string;
  appUrl: string;
}): string {
  if (!CAREGIVER_INVITE_EMAIL_TEMPLATE) return '';
  return CAREGIVER_INVITE_EMAIL_TEMPLATE
    .replace(/{{INVITER_NAME}}/g, params.inviterName || 'Someone')
    .replace(/{{INVITER_EMAIL}}/g, params.inviterEmail || '')
    .replace(/{{MEMBER_NAME}}/g, params.memberName || 'a family member')
    .replace(/{{INVITEE_EMAIL}}/g, params.inviteeEmail || '')
    .replace(/{{APP_URL}}/g, params.appUrl);
}
```

Same missing-template behavior as reminders: return `''` if the template
failed to load, so the send is skipped rather than throwing.

### 3.3 Send call, inside the invite endpoint

In `POST /api/family/:memberId/connected-caregivers/invite`, **after** the
`caregiver_invites` document is inserted (and after the existing push
notification step), add:

```ts
const html = renderCaregiverInviteEmailTemplate({
  inviterName: invitedByName,
  inviterEmail: invitedByEmail,
  memberName,
  inviteeEmail,
  appUrl: APP_URL, // same constant used for reminder emails
});
sendReminderEmail({
  to: inviteeEmail,
  subject: `${invitedByName} invited you to help care for ${memberName} on LifeWise`,
  html,
}).catch((e) => console.error('Caregiver invite email send error:', e));
```

**Important — send unconditionally.** Unlike the push notification (which is
only sent if the invitee already has a registered push token), the email
must always be attempted, since email is the fallback channel for invitees
who aren't set up for push yet or don't have an account.

**Important — never block or fail the request on this.** Do not `await` this
in a way that can throw past it. If Resend errors or `RESEND_API_KEY` is
unset, `sendReminderEmail` already logs and returns silently — follow that
same fire-and-forget pattern so an email failure can never turn a successful
invite into a `500`, and never rolls back the `caregiver_invites` insert.

---

## 4. Verification

1. Invite a user (`POST .../connected-caregivers/invite`) by email, where
   that email belongs to an account **with no push token registered** (or no
   account at all yet).
2. Confirm the invite still returns `201` and a `caregiver_invites` doc is
   created (unchanged from the base spec).
3. Confirm the invitee's inbox receives an email with subject
   `"<Inviter> invited you to help care for <Member> on LifeWise"`, correct
   inviter name/email, member name, and invitee email rendered in the body.
4. Confirm behavior is unaffected when `RESEND_API_KEY` is unset in a local
   dev environment — invite still succeeds, server just logs a skip (matches
   existing reminder-email behavior).
5. Repeat the invite flow for a user who *does* have a push token — confirm
   they get **both** the push notification and the email (not one or the
   other).

---

## 5. Out of scope

- No changes to the push notification contract (§4.1 of the main spec) —
  push and email are sent independently, both on every invite.
- No new endpoints. This is one additional side effect inside the existing
  invite endpoint.
- No frontend changes — the invite screen (`app/family-caregivers/add.tsx`)
  already just calls the invite endpoint and shows a success message; it
  doesn't need to know an email was also sent.
