import { getApiUrl } from '@/lib/query-client';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOAD_TIMEOUT_MS = 30000;

export async function uploadAvatar(token: string, uri: string, fileSizeBytes?: number): Promise<string> {
  if (typeof fileSizeBytes === 'number' && fileSizeBytes > MAX_AVATAR_BYTES) {
    throw new Error('Image is too large. Please pick a photo under 5MB.');
  }

  const baseUrl = getApiUrl();
  const url = new URL('/api/avatar', baseUrl).toString();
  const form = new FormData();

  // React Native's FormData needs the original file:// URI as given by the
  // image picker (Android) — stripping it breaks the upload on-device.
  const fileName = uri.split('/').pop() || 'avatar.jpg';
  const ext = fileName.split('.').pop()?.toLowerCase();
  const fileType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  form.append('avatar', {
    uri,
    name: fileName,
    type: fileType,
  } as any);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('Upload timed out. Check your connection and try again.');
    }
    throw new Error('Network error. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response (e.g. proxy/server error page) — fall through to status-based message
  }

  if (!res.ok) {
    throw new Error(json?.message || `Upload failed (${res.status})`);
  }
  if (!json?.url) {
    throw new Error('Upload succeeded but no image URL was returned.');
  }
  return json.url as string;
}
