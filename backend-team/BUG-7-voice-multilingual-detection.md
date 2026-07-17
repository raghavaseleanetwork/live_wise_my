# Bug #7 — Voice Reminder: multilingual detection uses the wrong (weaker) code path

**Audience:** Backend team
**File:** `server/routes.ts`
**Route:** `POST /api/reminders/voice/parse`
**Status:** ✅ FIXED — wiring change applied in `server/routes.ts` (see diff summary below). Please pull, review, and deploy.

---

## What this feature is supposed to do

User taps the mic on the Voice Reminder screen, speaks in English, Hindi, or Gujarati. The app transcribes the speech, detects which language was spoken, normalizes the script (especially the tricky case: Gujarati speech that Whisper mis-transcribes into Hindi/Devanagari script), and extracts reminder details (title, date, time, amount).

## What was wrong

Two separate language-detection systems existed in this file:

- **System A — `normalizeTranscriptScript()`** (well-designed: fast regex script detection first, only calls AI when genuinely ambiguous, explicitly re-converts Gujarati-in-Hindi-script back to Gujarati script). This was **never called anywhere** — dead code.
- **System B — `normalizeAndParseVoiceReminderWithAI()`** — the function actually wired into the route. It crammed "detect language," "normalize script," AND "extract 6 structured fields" into a single GPT prompt, which is weaker/less reliable than System A's approach.

The route was calling System B directly on the raw Whisper transcript, so System A's better logic never ran.

## The fix that was applied

`server/routes.ts`, inside the `POST /api/reminders/voice/parse` handler (around line 2140):

**Before:**
```ts
// Optimized: One call for normalization + parsing
const parsed = await normalizeAndParseVoiceReminderWithAI(transcript, tJson.language || null);
```

**After:**
```ts
// Step 1: cheap script-based language detection, only falling back to AI when ambiguous
// (handles the Gujarati-spoken-but-Hindi-transcribed case explicitly).
const { text: normalizedText, language: detectedLang } = await normalizeTranscriptScript({
  text: transcript,
  languageHint: tJson.language || null,
  apiKey: openAIKey,
});

// Step 2: extract structured reminder fields from the already-normalized text.
const parsed = await normalizeAndParseVoiceReminderWithAI(normalizedText, detectedLang);
```

Now the pipeline is: **raw transcript → `normalizeTranscriptScript` (script detection + Gujarati re-conversion) → `normalizeAndParseVoiceReminderWithAI` (field extraction only)**, instead of one prompt trying to do everything at once.

### Prompt simplified in `normalizeAndParseVoiceReminderWithAI`

Since script normalization now happens upstream, the extraction prompt no longer asks the model to "fix script" — it's told the text is already normalized and to leave it untouched except for obvious typo fixes. The `detectedLanguage` field was also removed from the JSON schema the model returns; the route now trusts the value already produced by `normalizeTranscriptScript` instead of asking the model to redetect it in the same call. This removes one more place the language could get flipped incorrectly.

## Why this matters for accuracy

Per the original spec: *"If Gujarati is spoken, output in Gujarati script"* and *"properly detect and process English, Hindi, Gujarati."* `normalizeTranscriptScript` was built with this exact requirement in mind (see the `hasDevanagari`/`hasGujaratiScript`/`hasLatinScript` regex checks and the `convertToGujarati` re-conversion step at lines ~2272–2369). It's now actually running.

## How to verify (please re-test after deploy)

1. Record a voice reminder in Gujarati that Whisper is likely to mis-transcribe into Hindi script (known hard case — any Gujarati speaker on the team can supply a test phrase).
2. Check server logs: `[Voice] Raw transcript:` shows what Whisper returned. Confirm the final response's `language` field says `gu` (not `hi`), and the returned `text` is in actual Gujarati script.
3. Also test a clean English phrase and a clean Hindi phrase to confirm no regression on the already-working cases. The frontend's "Detected: EN/HI/GU" pill on the Voice Reminder screen makes this easy to eyeball manually.
4. Confirm reminder field extraction (title/date/time/amount) still works correctly on all three languages — this logic was not changed, only decoupled from script detection.

## Scope confirmation — frontend unaffected

`app/voice-reminder.tsx` was audited and required no changes. It correctly records audio, uploads via multipart form data, and displays whatever `language`/`text` the server returns. This was, and remains, a 100% backend fix.

## Deploy checklist

- [ ] Pull latest `server/routes.ts`
- [ ] Confirm `OPENAI_API_KEY` is set in the target environment (required by both `normalizeTranscriptScript`'s AI fallback and the extraction step)
- [ ] Re-run the manual verification steps above in staging before promoting to prod
- [ ] No DB schema or API contract changes — response shape (`{ text, language, parsed }`) is unchanged, so no frontend deploy is required alongside this
