# LifeWise App — Project Notes

## Active workstream: Client UI/Feature Fixes

Client-requested UI and bug fixes are tracked in [ui.log](ui.log), sourced from
`backend-team/app docs/UI_Feature_Fixes - Google Docs.pdf`.

**Workflow for this list (per user instruction, 2026-07-16):**
1. Every item from the client PDF is logged in `ui.log` as a to-do — nothing is changed until told to start.
2. User tells Claude to start a specific item or group.
3. Claude must ask the user for complete detail on that item before writing any code.
4. User provides full detail.
5. Claude implements exactly that change, then marks it done in `ui.log` with a short entry (date, files touched).

Do not batch-implement multiple items speculatively. Do not fix adjacent/related things not explicitly requested. Always confirm scope before editing when working through this list.

If continuing this work in a new session: read `ui.log` first for current status before making any changes.
