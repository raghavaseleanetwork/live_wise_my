// import * as BackgroundFetch from 'expo-background-fetch';
// import * as TaskManager from 'expo-task-manager';
import { readSmsFromDeviceWithMeta } from './sms-reader';
import { parseSmsToTransactions } from './parse-sms';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { getApiUrl } from './query-client';

const SMS_SYNC_TASK = 'SMS_SYNC_TASK';
const LAST_SYNC_TIMESTAMP_KEY = 'last_sms_sync_timestamp';

/**
 * Transactions per upload request. At roughly 0.3 KB each this keeps a batch
 * near 45 KB — comfortably under Express's 100 KB default even if a deployment
 * has not picked up the raised server limit, and small enough that a failed
 * request costs little.
 */
const SYNC_BATCH_SIZE = 150;

export type SmsSyncPhase = 'idle' | 'fetching' | 'parsing' | 'uploading' | 'completed' | 'error';

export interface SmsSyncProgress {
  phase: SmsSyncPhase;
  current?: number;
  total?: number;
  synced?: number;
  skipped?: number;
  detail?: string;
}

/**
 * Core logic for syncing SMS. 
 * Can be called from foreground (ExpenseContext) or background (TaskManager).
 */
export interface SmsSyncResult {
  success: boolean;
  synced: number;
  skipped?: number;
  /** HTTP status when the upload failed. */
  status?: number;
  /** Set when the inbox could not be read at all (module/permission). */
  error?: string;
}

export async function performSmsSync(
  token: string,
  onProgress?: (progress: SmsSyncProgress) => void
): Promise<SmsSyncResult> {
  if (Platform.OS !== 'android' || !token) return { success: false, synced: 0 };

  try {
    onProgress?.({ phase: 'fetching' });
    const lastSyncStr = await AsyncStorage.getItem(LAST_SYNC_TIMESTAMP_KEY);
    const lastSyncTime = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

    // Incremental read: ask the native layer for everything since the last sync
    // watermark (minDate) instead of a fixed newest-N slice. This is what stops
    // bank SMS from being missed when the inbox has a lot of unrelated messages.
    // On the very first sync (no watermark) we fall back to a large recent
    // window so we still capture meaningful history without reading the whole
    // inbox. The backend deduplicates on smsId, so re-sent overlaps are safe.
    const smsResult = lastSyncTime > 0
      ? await readSmsFromDeviceWithMeta({ minDate: lastSyncTime, maxCount: 5000 })
      : await readSmsFromDeviceWithMeta({ maxCount: 2000 });
    const rawSms = smsResult.messages || [];

    // A failed read is NOT an empty inbox. Without this, a missing native
    // module or a revoked permission fell through to the `newSms.length === 0`
    // branch below and reported "success, 0 synced" — which looks exactly like
    // "no new messages" and is why this failed silently instead of saying why.
    if (smsResult.error) {
      console.error('[SmsSync] Read failed:', smsResult.error, '(module available:', smsResult.moduleAvailable, ')');
      onProgress?.({ phase: 'error', detail: smsResult.error });
      return { success: false, synced: 0, error: smsResult.error };
    }

    // Safety net: `minDate` is inclusive, so drop anything at/older than the
    // watermark to avoid re-processing the boundary message every run.
    const newSms = lastSyncTime > 0
      ? rawSms.filter(s => {
          const d = typeof s.date === 'number' ? s.date : (s.date ? new Date(s.date).getTime() : 0);
          return d > lastSyncTime;
        })
      : rawSms;

    if (newSms.length === 0) {
      onProgress?.({ phase: 'completed', synced: 0, skipped: 0 });
      return { success: true, synced: 0 };
    }

    onProgress?.({ phase: 'parsing', total: newSms.length });
    const parsed = parseSmsToTransactions(newSms);
    if (parsed.length === 0) {
      onProgress?.({ phase: 'completed', synced: 0, skipped: 0 });
      return { success: true, synced: 0 };
    }

    // Upload in batches rather than one request. A first scan can parse well
    // over a thousand transactions, and sending them together produced
    // HTTP 413 "request entity too large" — which failed the ENTIRE sync, so
    // nothing was saved at all. Batching also means one bad request costs a
    // single chunk instead of every transaction found.
    const API_URL = getApiUrl();
    let totalSynced = 0;
    let totalSkipped = 0;
    let lastStatus = 0;

    for (let i = 0; i < parsed.length; i += SYNC_BATCH_SIZE) {
      const batch = parsed.slice(i, i + SYNC_BATCH_SIZE);
      onProgress?.({
        phase: 'uploading',
        current: Math.min(i + batch.length, parsed.length),
        total: parsed.length,
        detail: batch[0]?.merchant,
      });

      const batchRes = await fetch(`${API_URL}/api/transactions/sync-from-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ transactions: batch }),
      });

      if (!batchRes.ok) {
        lastStatus = batchRes.status;
        const errBody = await batchRes.text().catch(() => '');
        console.error(
          `[SmsSync] Batch ${i / SYNC_BATCH_SIZE + 1} failed: HTTP ${batchRes.status} ${errBody.slice(0, 200)}`
        );
        // Auth failures will fail for every remaining batch too — stop rather
        // than hammering the server with the same rejected token.
        if (batchRes.status === 401 || batchRes.status === 403) break;
        continue;
      }

      const batchJson = await batchRes.json().catch(() => ({ synced: 0, skipped: 0 }));
      totalSynced += batchJson.synced || 0;
      totalSkipped += batchJson.skipped || 0;
    }

    // Treat the run as successful if any batch landed. A partial success must
    // still advance the watermark, or the next sync re-reads and re-uploads
    // everything that already saved.
    const res = { ok: totalSynced > 0 || lastStatus === 0, status: lastStatus };

    if (res.ok) {
      // Advance the watermark to the newest SMS we actually read this run. Safe
      // because the incremental read returns the whole window since lastSyncTime
      // (no truncated slice), so nothing below the new watermark was skipped.
      // Guard so the watermark can only move forward.
      const newestInWindow = newSms.reduce((max, s) => {
        const d = typeof s.date === 'number' ? s.date : (s.date ? new Date(s.date).getTime() : 0);
        return d > max ? d : max;
      }, lastSyncTime);
      if (newestInWindow > lastSyncTime) {
        await AsyncStorage.setItem(LAST_SYNC_TIMESTAMP_KEY, String(newestInWindow));
      }
      // AI categorization is NOT triggered here. `syncSmsFromDevice` in
      // expense-context.tsx already calls /categorize-others after a successful
      // sync; doing it in both places fired the same job twice per run.

      onProgress?.({ phase: 'completed', synced: totalSynced, skipped: totalSkipped });
      return { success: true, synced: totalSynced, skipped: totalSkipped };
    }

    // Every batch failed. `lastStatus` names the real cause (e.g. 401 for an
    // expired token) so the UI does not fall back to blaming SMS permissions.
    console.error(`[SmsSync] Upload failed: all batches rejected, HTTP ${lastStatus}`);
    onProgress?.({ phase: 'error' });
    return { success: false, synced: 0, status: lastStatus };
  } catch (err) {
    console.error('[SmsSync] Error:', err);
    onProgress?.({ phase: 'error' });
    return { success: false, synced: 0 };
  }
}

/*
// Define the task
if (Platform.OS !== 'web') {
  TaskManager.defineTask(SMS_SYNC_TASK, async () => {
    try {
      const token = await AsyncStorage.getItem('@lifewise_token'); 
      if (!token) return BackgroundFetch.BackgroundFetchResult.NoData;

      const result = await performSmsSync(token);
      if (result.success && result.synced > 0) {
        return BackgroundFetch.BackgroundFetchResult.NewData;
      }
      return BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (err) {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function registerSmsSyncTask() {
  if (Platform.OS !== 'android') return;
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(SMS_SYNC_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(SMS_SYNC_TASK, {
        minimumInterval: 15 * 60, // 15 minutes
        stopOnTerminate: false,
        startOnBoot: true,
      });
      console.log('[BackgroundSync] Task registered successfully');
    }
  } catch (err) {
    console.error('[BackgroundSync] Registration failed:', err);
  }
}
*/

export async function registerSmsSyncTask() {
  console.log('[BackgroundSync] Background sync disabled in this build.');
}
