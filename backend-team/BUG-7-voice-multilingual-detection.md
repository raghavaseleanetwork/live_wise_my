# Bug #7 — Voice Reminder: multilingual detection uses the wrong (weaker) code path

**Audience:** Backend team
**File to edit:** `server/routes.ts`
**Route:** `POST /api/reminders/voice/parse`
**Status:** Frontend was fully audited — there is no frontend bug here. The voice-reminder screen (`app/voice-reminder.tsx`) correctly records audio, uploads it, and displays whatever language/text the server returns. This is a 100% backend fix.

---

## What this feature is supposed to do

User taps the mic on the Voice Reminder screen, speaks in English, Hindi, or Gujarati. The app should transcribe the speech, detect which language was spoken, normalize the script (especially the tricky case: Gujarati speech that Whisper mis-transcribes into Hindi/Devanagari script), and extract reminder details (title, date, time, amount).

## What's actually happening — two implementations exist, and the better one is dead code

I read through the entire route and found **two separate language-detection systems** written in this file:

### System A — `normalizeTranscriptScript()` (lines ~2330–2369) — well-designed, but NEVER CALLED
This function:
- Uses fast regex-based script detection first (`hasDevanagari()`, `hasGujaratiScript()`, `hasLatinScript()` — lines 2272-2282).
- Only calls the AI language-detector (`detectLanguageWithAI()`, lines 2284-2320) when the script is ambiguous (Devanagari text that could be Hindi OR Gujarati-in-wrong-script) — cheaper and more accurate than always asking AI.
- Explicitly re-converts to Gujarati script via `convertToGujarati()` (lines 2235-2268) when it detects the Gujarati-spoken-but-Hindi-transcribed case — this is exactly the tricky case your bug report and the original product spec called out.

**I confirmed this function is never invoked anywhere in the codebase** (`grep -n "normalizeTranscriptScript(" server/routes.ts` returns only the function definition itself, line 2330 — no call sites). It was written, tested presumably, and then never wired into the actual route. This is the system that *should* be running.

### System B — `normalizeAndParseVoiceReminderWithAI()` (lines 2155–2228) — this is what ACTUALLY runs
The real route (`POST /api/reminders/voice/parse`, lines 2076-2153) calls this function instead (line 2141: `const parsed = await normalizeAndParseVoiceReminderWithAI(transcript, tJson.language || null);`).

This function does language detection + script normalization + reminder-data extraction **all in a single GPT prompt** (lines 2169-2204) — it asks the model to do everything at once: fix transcription errors, convert script if needed, detect language, AND extract structured fields (title/date/time/amount) as one JSON response.

**Why this is weaker:** cramming "detect language," "normalize script," and "extract 6 different structured fields with strict formatting rules" into one prompt call gives the model more to get wrong in a single pass, compared to System A's approach of doing cheap deterministic script-detection first and only reaching for AI when genuinely ambiguous. This lines up with the original bug report's complaints: language detection not working reliably, accuracy issues.

## The fix

Wire System A into the actual route, replacing (or feeding into) System B. Suggested approach:

```ts
// Inside the POST /api/reminders/voice/parse handler, after transcription succeeds
// (server/routes.ts, right after line 2133 where `transcript` is set):

const { text: normalizedText, language: detectedLang } = await normalizeTranscriptScript({
  text: transcript,
  languageHint: tJson.language || null,
  apiKey: openAIKey,
});

// Then pass the ALREADY-normalized, already-language-detected text into the
// data-extraction step, instead of asking one prompt to do both jobs:
const parsed = await normalizeAndParseVoiceReminderWithAI(normalizedText, detectedLang);
```

You'll also want to simplify `normalizeAndParseVoiceReminderWithAI`'s prompt (lines 2169-2204) to drop the "normalize the text / fix script" instructions from its job, since that's now handled upstream by `normalizeTranscriptScript` — leave it responsible only for extracting the structured reminder fields (title, date, time, amount, repeat type). This keeps each function doing one job well instead of one function trying to do everything.

## Why this matters for accuracy specifically

Per the original spec: *"If Gujarati is spoken, output in Gujarati script"* and *"properly detect and process English, Hindi, Gujarati."* System A was clearly built with this exact requirement in mind — the function names and comments (`// Devanagari can still be Gujarati speech rendered in Hindi script; confirm via AI`) show real thought was put into this edge case. It's a shame it's not running. Wiring it in should directly improve the multilingual accuracy complaints without needing any new AI logic — the correct logic already exists, it just needs to be connected.

## How to verify

1. Record a voice reminder in Gujarati that Whisper is likely to mis-transcribe into Hindi script (this is the known hard case — any Gujarati speaker on the team can supply a test phrase).
2. Before the fix: check server logs (`[Voice] Raw transcript:` at line 2134) — note whether the returned `language` field correctly says `gu` or incorrectly says `hi`.
3. After wiring in `normalizeTranscriptScript`: same test — the response's `language` field should say `gu`, and the returned `text`/`normalizedText` should be in actual Gujarati script, not Devanagari.
4. Also test a clean English and a clean Hindi phrase to make sure the fix doesn't regress the already-working cases (the frontend's "Detected: EN/HI/GU" pill makes this easy to eyeball during manual testing).

## Scope check — confirmed this is backend-only

I read the entire `app/voice-reminder.tsx` screen. It correctly: records audio, uploads via multipart form data, displays whatever `language` and `text` the server returns, and never sends a language hint of its own (correct — Whisper auto-detects). There is nothing to change on the frontend for this bug.
</content>
