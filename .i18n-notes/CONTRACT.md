# i18n sweep contract — read this before touching any screen

This app is being converted to support 7 languages: English (en), Hindi (hi),
Gujarati (gu), Marathi (mr), Tamil (ta), Telugu (te), Bengali (bn).

## Infra already built (do not redo)
- `lib/i18n.ts` — i18next config, imports all 7 `locales/*.json` files, exports `LANGUAGES`.
- `lib/language-context.tsx` — `useLanguage()` hook, wired into `app/_layout.tsx`.
- `app/settings.tsx` — reference implementation. Read it first as the pattern to copy.
- `locales/en.json`, `hi.json`, `gu.json`, `mr.json`, `ta.json`, `te.json`, `bn.json` — already contain `common.*` and `settings.*` namespaces. ADD to these files, never overwrite or remove existing keys.

## Your job
1. Pick ONE screen/component file (or a small tight group of related files, e.g. one feature's `[memberId].tsx` + `add.tsx`).
2. Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();` inside the component.
3. Replace every hardcoded user-facing English string with `t('namespace.key')`:
   - JSX text: `<Text>Settings</Text>` → `<Text>{t('settings.title')}</Text>`
   - Alert/modal copy: `showAlert({ title: 'Logout', ... })` → `showAlert({ title: t('...'), ... })`
   - Placeholders: `placeholder="Search merchant"` → `placeholder={t('...')}`
   - Data-driven label arrays (e.g. category/relationship/payment-mode lists) — if the array is used ONLY in this file, translate its labels via `t()` at render time, not by hardcoding translated text into the array itself.
4. DO NOT translate: variable/prop names, testID values, style keys, log/console strings, code comments, developer-facing error text that never reaches the UI, dynamic user data (names, amounts, dates already formatted by existing locale-aware helpers like `formatAmount`/`toLocaleDateString`).
5. Use a namespace per screen area, e.g. `home.*`, `addExpense.*`, `family.*`, `familyAppointments.*`, `bills.*`, `reports.*`, `import.*`, `subscription.*`, `support.*`. Reuse `common.*` for generic words (Cancel, Save, Done, Yes, No, Back, etc.) instead of duplicating them into a new namespace — check `locales/en.json`'s `common` block first.
6. For EVERY key you add to `en.json`, add the SAME key with a real, careful translation to ALL SIX other locale files (hi/gu/mr/ta/te/bn). Do not leave placeholders or copy English into the other files. This is a financial/household app — money and date terms must be correct, not approximate.
7. Interpolation: i18next uses `{{variableName}}` inside the string, and you pass `t('key', { variableName: value })`. Example already in the codebase: `settings.appLockHint` uses `{{method}}`.

7b. PLURALS — use `_one`/`_other` CLDR suffixes, NOT `_plural`. `_plural` was used in early keys (`home.syncAddedTransactions_plural`, some `transactions.*` keys) but is WRONG for the installed i18next version (v26) — it silently falls back to singular text for count=2+, verified by direct testing. If you touch a screen with a count-dependent string, use `key_one`/`key_other` (e.g. `"itemCount_one": "{{count}} item"`, `"itemCount_other": "{{count}} items"`) called as `t('itemCount', { count })`. If you happen to notice an existing `_plural` key while working nearby, you may fix it to `_one`/`_other` in passing, but a dedicated cleanup pass will sweep the whole codebase for this at the end regardless — don't go out of your way to hunt for other agents' `_plural` keys outside your own files.
8. After editing, run `npx tsc --noEmit -p .` (from repo root) and confirm no NEW errors appear in the files you touched (pre-existing baseline errors in admin/, drizzle.config.ts, shared/schema.ts, and two UTF-16 files are not yours to fix).
9. Validate every locale JSON file you touched still parses: `node -e "JSON.parse(require('fs').readFileSync('locales/XX.json','utf8'))"`.

## Reporting back
When done, report: which file(s) you touched, how many new keys added, confirmation all 7 locale files were updated with real translations (not placeholders), and the tsc/JSON-parse verification result.
