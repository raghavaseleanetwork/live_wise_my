# Backend Fix Guide — Avatar Upload Not Working

**Audience:** Backend team
**Status:** Frontend has been fully fixed and hardened (details below). Avatar upload still cannot succeed until the backend items in this doc are done.
**Files involved:** `server/routes.ts` (route at lines 1314–1347), `.env.example`, AWS console

---

## What this feature does

Profile screen → tap the avatar circle → pick a photo from the gallery → app uploads it → avatar updates.

Flow in detail:
1. App uploads the image: `POST /api/avatar` (multipart, field name `avatar`) → `lib/upload-avatar.ts`
2. Backend stores the file in S3 and returns `{ url }`
3. App saves that URL to the user's profile: `PUT /api/auth/me` with `{ avatarUrl: url }`

## What's already fixed on the frontend (no action needed from you)

- `lib/upload-avatar.ts` sends the raw `file://` URI exactly as the image picker provides it (required for Android's `FormData` to read the file correctly — do not let anyone "clean up" this URI in future changes).
- Added a 5MB **client-side** size check before upload even starts (fast, clear error instead of a slow failed upload).
- Added a 30-second timeout with a clear "upload timed out" message instead of hanging indefinitely.
- Added a MIME-type guess for `.png` / `.webp` / `.jpg` (was hardcoded to always send `image/jpeg` unless the extension was exactly `.png`).
- If the upload succeeds but no `url` comes back in the response, or the follow-up `PUT /api/auth/me` save fails, the app now reverts the on-screen avatar to what it was before and shows an error — previously a partial failure could leave a broken local `file://` reference showing as if it had saved.
- Added a loading spinner overlay on the avatar while the upload is in progress, and the avatar is not tappable again until it finishes.

**None of the above fixes the actual failure.** They make failures fail clearly and safely instead of silently or confusingly — the upload itself cannot succeed until the backend is configured correctly (below).

---

## What's broken on the backend

### 1. S3 is not confirmed configured (most likely reason uploads fail today)

The route (`server/routes.ts:1314-1347`) requires two environment variables:

```ts
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const S3_BUCKET = process.env.AWS_S3_BUCKET;
```

and immediately fails if `S3_BUCKET` is unset:

```ts
if (!S3_BUCKET) {
  return res.status(500).json({ message: 'S3 bucket not configured. Set AWS_S3_BUCKET.' });
}
```

**`AWS_S3_BUCKET` and `AWS_REGION` are not listed in `.env.example`** — meaning there is no record confirming these are actually set on the running server. If they're missing in the deployed environment, every single avatar upload fails immediately with that exact message, regardless of anything the frontend does.

**Action needed:**
- Confirm whether `AWS_S3_BUCKET` and `AWS_REGION` are set in the production/dev server's actual environment right now (not just locally).
- If not set: create or designate an S3 bucket for avatar storage, and set both env vars on the server.
- Add both to `.env.example` once confirmed, so this doesn't stay undocumented.

### 2. Uploaded objects are not set to public-read — the returned URL likely won't load

The route builds a direct public S3 URL and hands it straight to the app to render as an `<Image>`:

```ts
const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
```

But the `PutObjectCommand` that uploads the file does **not** set `ACL: 'public-read'`:

```ts
await s3.send(
  new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype || 'image/jpeg',
  } as any),
);
```

For comparison, the sibling upload route in the same file (`/api/upload`, used for family member avatars, `server/routes.ts:476`) **does** set `ACL: 'public-read'` on its `PutObjectCommand`. The `/api/avatar` route is inconsistent with it.

**Effect:** even once `AWS_S3_BUCKET`/`AWS_REGION` are configured and the upload API call itself succeeds (HTTP 201), the returned URL will likely 403 when the app tries to load it as an image — because the object isn't publicly readable and nothing else in front of it (CDN/presigned URL) is used to serve it.

**Action needed — pick one:**
- **Option A (simplest, matches the existing `/api/upload` pattern):** add `ACL: 'public-read'` to the `PutObjectCommand` in the `/api/avatar` route, and confirm the bucket's Block Public Access settings / bucket policy actually allow public-read objects (some AWS accounts have Block Public Access enabled account-wide, which silently makes `ACL: 'public-read'` do nothing).
- **Option B (more secure, more work):** keep the bucket private and instead serve avatars via CloudFront (or generate a presigned GET URL when returning avatar URLs to the app). This avoids any object in the bucket being world-readable by direct URL guessing.
- Whichever you choose, please make it consistent with how `/api/upload` (family member avatars) is/will be handled, so the two don't diverge.

### 3. No server-side file size or type limit

```ts
const upload = multer({ storage: multer.memoryStorage() });
```

No `limits.fileSize` is set. The frontend now blocks anything over 5MB before it's sent, but that's a client-side check only and can be trivially bypassed (e.g. calling the API directly). Right now the server will happily buffer an arbitrarily large upload fully in memory before even reaching the S3 call.

**Action needed:** add a size limit to the multer config used by this route, e.g.:
```ts
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
```
(Note: `upload` is shared across multiple routes in this file — check whether other routes using it need a larger limit before changing it globally, or create a separate multer instance just for `/api/avatar`.)

### 4. No image-type validation

There's no check that the uploaded file is actually an image (e.g. `file.mimetype.startsWith('image/')`). Right now any file type would be accepted and stored under an `avatars/...` key. Recommend rejecting non-image MIME types with a 400 before the S3 call.

---

## What we need from you — summary checklist

- [ ] Confirm `AWS_S3_BUCKET` / `AWS_REGION` are set on the actual running server (dev + prod). Set up the bucket if it doesn't exist yet.
- [ ] Fix the missing `ACL: 'public-read'` (or switch to presigned/CloudFront URLs) on the `/api/avatar` route's `PutObjectCommand` so the returned URL is actually loadable — decide which approach and let us know so the frontend can match if presigned URLs are used (they'd need refreshing, which the frontend doesn't currently handle).
- [ ] Add a server-side file size limit (`multer` `limits.fileSize`) on this route.
- [ ] Add a server-side MIME-type check to reject non-image uploads.
- [ ] Add `AWS_S3_BUCKET` / `AWS_REGION` to `.env.example`.
- [ ] Once the above is done, live-test end-to-end: upload a photo through the app, confirm the returned URL loads as an image in a browser, and confirm it renders correctly back in the app after a restart (i.e. it was actually persisted via `PUT /api/auth/me`).

## How to verify (once done)

1. In the app: Edit Profile → tap the avatar circle → pick a photo from gallery.
2. **Before fix:** fails with "S3 bucket not configured" (if env vars missing) or the avatar appears blank/broken after a "successful" upload (if ACL is still missing).
3. **After fix:** photo uploads, spinner shows briefly, avatar updates immediately, and the URL (visible via `GET /api/auth/me`) opens as a valid image directly in a browser.

**Questions?** Ping the frontend owner of this feature (this doc) before changing the response shape of `POST /api/avatar` — the frontend expects exactly `{ url: string }` on success and `{ message: string }` on failure.
