// import * as BackgroundFetch from 'expo-background-fetch';
// import * as TaskManager from 'expo-task-manager';
import { readSmsFromDeviceWithMeta } from './sms-reader';
import { parseSmsToTransactions } from './parse-sms';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { getApiUrl } from './query-client';

const SMS_SYNC_TASK = 'SMS_SYNC_TASK';
const LAST_SYNC_TIMESTAMP_KEY = 'last_sms_sync_timestamp';

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
export async function performSmsSync(
  token: string, 
  onProgress?: (progress: SmsSyncProgress) => void
) {
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

    onProgress?.({
      phase: 'uploading',
      current: parsed.length,
      total: parsed.length,
      detail: parsed[0]?.merchant
    });
    // Send to backend
    const API_URL = getApiUrl();
    const res = await fetch(`${API_URL}/api/transactions/sync-from-sms`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ transactions: parsed }),
    });

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
      const json = await res.json();
      
      // NEW: Trigger AI categorization for any 'others' that were just synced
      onProgress?.({ phase: 'uploading', detail: 'Improving accuracy with AI...' });
      try {
        await fetch(`${API_URL}/api/transactions/categorize-others`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
      } catch (err) {
        console.error('[Sync] AI categorization failed:', err);
      }

      onProgress?.({ phase: 'completed', synced: json.synced, skipped: json.skipped });
      return { success: true, synced: json.synced, skipped: json.skipped };
    }
    
    onProgress?.({ phase: 'error' });
    return { success: false, synced: 0 };
  } catch (err) {
    console.error('[BackgroundSync] Error:', err);
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
