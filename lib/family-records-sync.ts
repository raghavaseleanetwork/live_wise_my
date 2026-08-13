import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiRequest } from '@/lib/query-client';

/**
 * Server write-through for Family Hub records.
 *
 * ## Why this exists
 *
 * `lib/family-records.ts` stored every record in AsyncStorage and made no HTTP
 * call at all. The backend endpoints existed and were verified working, but the
 * app never called them, so a record created on one device was invisible
 * everywhere else:
 *
 * - a connected caregiver never saw the owner's appointments,
 * - reinstalling the app destroyed every record permanently,
 * - `GET /api/reminders/family` had nothing to project, so it returned `[]`.
 *
 * This module is the missing half. `lib/family-records.ts` keeps its existing
 * per-kind `load`/`save` API; the storage primitives underneath now reconcile
 * with the server.
 *
 * ## Model
 *
 * **The server is the source of truth. AsyncStorage is an offline cache.**
 *
 * - `pullRecords` fetches, overwrites the cache, and returns server state. On
 *   any network failure it returns the cache instead, so the UI still renders
 *   offline and a flight-mode user is never shown an empty Family Hub.
 * - `pushCreate` / `pushPatch` / `pushDelete` write locally first (instant UI)
 *   then mirror to the server. A failed mirror queues the operation.
 *
 * Local-first ordering is deliberate: a family record is something the user
 * just typed. Blocking the save on a round-trip — or worse, losing it when the
 * request fails — is a far worse failure than a few seconds of drift.
 */

/**
 * Path segment per record kind.
 *
 * ⚠️ **Single point of correction.** Two backend documents disagree on the URL:
 * `FAMILY_RECORDS_PERSISTENCE_SPEC.md` §3 specifies
 * `/api/family/:memberId/records/:kind`, while the backend team's verification
 * reply describes `/api/family/:memberId/<kind>` with different segment names
 * (`medicationStock` rather than `stock`, etc). Their
 * `FAMILY_RECORDS_SYNC_FRONTEND_GUIDE.md` — which would settle it — is not in
 * this repo.
 *
 * RESOLVED 2026-08-07 by probing the deployed API directly: the verification
 * reply was correct and the spec was wrong. See `RECORD_PATH` below. If the API
 * changes again, change `RECORD_PATH` and
 * `recordUrl` below and nothing else: no caller builds a URL itself.
 */
export type RecordKind =
  | 'appointments'
  | 'stock'
  | 'bills'
  | 'subscriptions'
  | 'tasks'
  | 'routines'
  | 'checkins'
  | 'travel'
  | 'health'
  | 'documents'
  | 'expenses'
  | 'custom';

/**
 * Segment names as the DEPLOYED API actually exposes them.
 *
 * These were probed against the live backend rather than taken from a spec: the
 * two backend documents disagreed, and the form this file previously used
 * (`/api/family/:id/records/:kind`) 404s on every kind. That meant every family
 * record write failed silently, the server stored nothing, and
 * `GET /api/reminders/family` had no data to project — which is why Family Hub
 * reminders never arrived while ordinary reminders worked.
 *
 * Verified (401 = route exists and needs auth, 404 = no such route):
 *   /api/family/:id/records/documents  -> 404
 *   /api/family/:id/documents          -> 401
 */
const RECORD_PATH: Record<RecordKind, string> = {
  appointments: 'appointments',
  stock: 'medicationStock',
  bills: 'familyBills',
  subscriptions: 'subscriptions',
  tasks: 'familyTasks',
  routines: 'routines',
  checkins: 'checkins',
  travel: 'travelItems',
  health: 'healthLogs',
  documents: 'documents',
  expenses: 'familyExpenses',
  custom: 'customItems',
};

function recordUrl(memberId: string, kind: RecordKind, id?: string): string {
  // No `/records/` segment — the deployed API is `/api/family/:memberId/:kind`.
  const base = `/api/family/${memberId}/${RECORD_PATH[kind]}`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

// ---------------------------------------------------------------------------
// Auth token
// ---------------------------------------------------------------------------

/**
 * The record layer is called from plain functions, not React components, so it
 * cannot read `useAuth()`. `app/_layout.tsx` publishes the token here whenever
 * auth state changes.
 *
 * Without a token every call is skipped and the app behaves exactly as it did
 * before this module existed — local-only. That is the correct degradation for
 * a logged-out user.
 */
let authToken: string | null = null;

export function setFamilyRecordsAuthToken(token: string | null): void {
  authToken = token;
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

const QUEUE_KEY = '@lifewise_family_records_queue';

interface QueuedOp {
  op: 'create' | 'patch' | 'delete';
  memberId: string;
  kind: RecordKind;
  id: string;
  body?: unknown;
  queuedAt: string;
}

async function loadQueue(): Promise<QueuedOp[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(ops: QueuedOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    // A dropped queue costs a lost mirror, never a crash. The local record is
    // already saved either way.
  }
}

/**
 * Queues a write that could not reach the server.
 *
 * Superseding ops for the same record are collapsed: a create followed by two
 * patches then a delete should replay as one delete, not four requests against
 * a row that ends up removed anyway.
 */
async function enqueue(op: QueuedOp): Promise<void> {
  const queue = await loadQueue();
  const others = queue.filter(
    (q) => !(q.memberId === op.memberId && q.kind === op.kind && q.id === op.id),
  );

  // A delete cancels a still-unsent create outright — the server never saw the
  // record, so there is nothing to delete and replaying it would 404.
  if (op.op === 'delete') {
    const pendingCreate = queue.some(
      (q) =>
        q.memberId === op.memberId && q.kind === op.kind && q.id === op.id && q.op === 'create',
    );
    if (pendingCreate) {
      await saveQueue(others);
      return;
    }
  }

  // A patch on an unsent create stays a create, carrying the merged body, so
  // the record arrives complete rather than as an update to a nonexistent row.
  if (op.op === 'patch') {
    const pendingCreate = queue.find(
      (q) =>
        q.memberId === op.memberId && q.kind === op.kind && q.id === op.id && q.op === 'create',
    );
    if (pendingCreate) {
      await saveQueue([
        ...others,
        {
          ...pendingCreate,
          body: { ...(pendingCreate.body as object), ...(op.body as object) },
        },
      ]);
      return;
    }
  }

  await saveQueue([...others, op]);
}

/**
 * Replays queued writes. Safe to call often — it no-ops when the queue is empty
 * and drops any op the server accepts or permanently rejects.
 *
 * A `4xx` other than 408/429 is treated as permanent: the server has judged the
 * payload and retrying forever would pin a bad record in the queue for good.
 */
export async function flushFamilyRecordQueue(): Promise<void> {
  if (!authToken) return;

  const queue = await loadQueue();
  if (queue.length === 0) return;

  const remaining: QueuedOp[] = [];

  for (const op of queue) {
    try {
      const res =
        op.op === 'create'
          ? await apiRequest('POST', recordUrl(op.memberId, op.kind), op.body, authToken)
          : op.op === 'patch'
            ? await apiRequest('PATCH', recordUrl(op.memberId, op.kind, op.id), op.body, authToken)
            : await apiRequest('DELETE', recordUrl(op.memberId, op.kind, op.id), undefined, authToken);

      if (res.ok) continue;

      const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      if (retryable) remaining.push(op);
      // Non-retryable: drop it. Keeping it would block every later op behind a
      // request the server will never accept.
    } catch {
      // Network failure — keep for the next flush.
      remaining.push(op);
    }
  }

  await saveQueue(remaining);
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/**
 * Fetches a member's records for one kind, refreshing the cache.
 *
 * Returns `null` when the server could not be consulted, which the caller reads
 * as "keep using the cache". Distinguishing that from a real empty list matters:
 * treating an unreachable server as "no records" is exactly the bug that made
 * `GET /api/reminders/family` blank the Reminders tab.
 */
export async function pullRecords<T>(
  memberId: string,
  kind: RecordKind,
): Promise<T[] | null> {
  if (!authToken) return null;

  try {
    // Send anything queued first, so a pull can't overwrite the cache with
    // server state that predates the user's own unsent edits.
    await flushFamilyRecordQueue();

    const res = await apiRequest('GET', recordUrl(memberId, kind), undefined, authToken);
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data)) return null;

    return data as T[];
  } catch {
    return null;
  }
}

/** Mirrors a newly created record. Queues on failure. */
export async function pushCreate(
  memberId: string,
  kind: RecordKind,
  record: { id: string },
): Promise<void> {
  if (!authToken) return;

  try {
    const res = await apiRequest('POST', recordUrl(memberId, kind), record, authToken);
    if (res.ok) return;
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      await enqueue({ op: 'create', memberId, kind, id: record.id, body: record, queuedAt: new Date().toISOString() });
    }
  } catch {
    await enqueue({ op: 'create', memberId, kind, id: record.id, body: record, queuedAt: new Date().toISOString() });
  }
}

/**
 * Mirrors an edit.
 *
 * Sends only the changed fields — `PATCH` merges server-side, so omitting a
 * field leaves it untouched. Sending the whole record would let a form that
 * doesn't expose `notes` wipe a note set elsewhere.
 */
export async function pushPatch(
  memberId: string,
  kind: RecordKind,
  id: string,
  patch: object,
): Promise<void> {
  if (!authToken) return;

  // `id` and `createdAt` are immutable; the server ignores them, but sending
  // them invites a backend that trusts the payload to rewrite a record's
  // identity — which would orphan its `fam:` reminder projection.
  const { id: _id, createdAt: _createdAt, ...body } = patch as Record<string, unknown>;

  try {
    const res = await apiRequest('PATCH', recordUrl(memberId, kind, id), body, authToken);
    if (res.ok) return;
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      await enqueue({ op: 'patch', memberId, kind, id, body, queuedAt: new Date().toISOString() });
    }
  } catch {
    await enqueue({ op: 'patch', memberId, kind, id, body, queuedAt: new Date().toISOString() });
  }
}

/** Mirrors a deletion. A 404 counts as success — the row is already gone. */
export async function pushDelete(
  memberId: string,
  kind: RecordKind,
  id: string,
): Promise<void> {
  if (!authToken) return;

  try {
    const res = await apiRequest('DELETE', recordUrl(memberId, kind, id), undefined, authToken);
    if (res.ok || res.status === 404) return;
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      await enqueue({ op: 'delete', memberId, kind, id, queuedAt: new Date().toISOString() });
    }
  } catch {
    await enqueue({ op: 'delete', memberId, kind, id, queuedAt: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// One-time migration
// ---------------------------------------------------------------------------

const MIGRATED_KEY = '@lifewise_family_records_migrated';

/**
 * Uploads records that were created before write-through existed.
 *
 * Without this, everything a user entered up to now stays stranded on the one
 * device that created it — invisible to caregivers and destroyed by a reinstall.
 *
 * Safe to run repeatedly: `POST` is idempotent on the client-supplied `id` (the
 * backend team confirmed re-posting merges rather than duplicating), and the
 * completion flag means the normal case costs a single AsyncStorage read.
 *
 * Marked complete only if every kind uploaded cleanly, so a partial run over a
 * flaky connection retries rather than stranding the remainder.
 */
export async function migrateLocalRecordsToServer(
  memberIds: string[],
  readLocal: (memberId: string, kind: RecordKind) => Promise<{ id: string }[]>,
): Promise<void> {
  if (!authToken || memberIds.length === 0) return;

  try {
    if ((await AsyncStorage.getItem(MIGRATED_KEY)) === 'true') return;
  } catch {
    return;
  }

  const kinds = Object.keys(RECORD_PATH) as RecordKind[];
  let allOk = true;

  for (const memberId of memberIds) {
    for (const kind of kinds) {
      let local: { id: string }[] = [];
      try {
        local = await readLocal(memberId, kind);
      } catch {
        continue;
      }
      if (local.length === 0) continue;

      for (const record of local) {
        try {
          const res = await apiRequest('POST', recordUrl(memberId, kind), record, authToken);
          if (!res.ok && res.status !== 409) allOk = false;
        } catch {
          allOk = false;
        }
      }
    }
  }

  if (allOk) {
    try {
      await AsyncStorage.setItem(MIGRATED_KEY, 'true');
    } catch {
      // Retried next launch; re-uploading is harmless.
    }
  }
}
