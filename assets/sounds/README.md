# Notification sounds

## `reminder.wav` — ✅ present

The app plays a custom notification sound named **`reminder.wav`** from this
folder.

Current file (added 2026-08-17): an ElevenLabs "airy social media chime, modern
app alert" — 2.00 s, 44.1 kHz, stereo, 16-bit PCM. Comfortably under the iOS
30-second limit.

### What references it

| Where | What it does |
|---|---|
| `app.json` → `expo-notifications` plugin → `sounds` | Copies the file into the native projects at prebuild |
| `lib/notifications.ts` → `REMINDER_SOUND_FILE` | Sets it on notification content (iOS) and on each Android channel |
| `backend-team/NOTIFICATION-ACTIONS-backend-requirements.md` | Tells the backend to send the same filename on push payloads |

### Requirements for the file

- **Filename must be exactly `reminder.wav`.** It is referenced by name in three
  places; renaming it means changing all three.
- **Format: WAV (PCM).** Android's notification channels are most reliable with
  WAV. `.caf` also works on iOS, but a single WAV covers both.
- **Length: under 30 seconds**, ideally 1–3. iOS silently falls back to the
  default sound for anything 30s or longer.
- Keep it small — it ships inside the app binary.

### After adding the file

The `expo-notifications` config plugin copies sounds at **prebuild**, so a
JS-only reload will not pick it up:

```
npx expo prebuild --clean
npx expo run:android
```

### ⚠️ Android channel caveat

An Android notification channel's sound is **fixed when the channel is created**
and cannot be changed afterwards. Installs that already created the channels
will keep the old sound until the channel ids change.

If you change the sound later, bump the channel ids in `lib/notifications.ts`
(e.g. `default` → `default_v2`) or existing users will never hear the new one.
