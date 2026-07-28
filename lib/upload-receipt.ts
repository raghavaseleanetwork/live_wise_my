import { getApiUrl } from '@/lib/query-client';

/**
 * Uploads a receipt/bill photo — Methods 1 & 2 in the product doc
 * ("Receipt Photo — Optional, camera icon in corner"). Mirrors uploadAvatar()
 * in lib/upload-avatar.ts, which is the existing reference for this pattern.
 *
 * Server enforces: 5MB max, image MIME types only
 * (EXPENSE_ENTRY_BACKEND_UPDATE.md §4).
 */

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOAD_TIMEOUT_MS = 30000;

export async function uploadReceipt(
  token: string,
  uri: string,
  fileSizeBytes?: number,
): Promise<string> {
  if (typeof fileSizeBytes === 'number' && fileSizeBytes > MAX_RECEIPT_BYTES) {
    throw new Error('Receipt image must be 5MB or smaller.');
  }

  const baseUrl = getApiUrl();
  const url = new URL('/api/uploads/receipt', baseUrl).toString();
  const form = new FormData();

  // React Native's FormData needs the original file:// URI as given by the
  // camera/image picker (Android) — stripping it breaks the upload on-device.
  const fileName = uri.split('/').pop() || 'receipt.jpg';
  const ext = fileName.split('.').pop()?.toLowerCase();
  const fileType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  form.append('receipt', {
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
      // Do NOT set Content-Type manually — fetch needs to generate the
      // multipart boundary itself.
      headers: { Authorization: `Bearer ${token}` },
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
