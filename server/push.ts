// Centralizes FCM sends so every call site reads the per-token result and
// prunes dead tokens. sendEachForMulticast RESOLVES even when every send
// fails — per-token errors live in responses[], not in a thrown exception.
// Not reading them is how a total push outage went unnoticed: the old code
// logged a "sent" line for every attempt regardless of whether FCM accepted
// any of them.

const EXPO_TOKEN_PREFIX = 'ExponentPushToken[';

export function isExpoFormatToken(token: any): boolean {
  return typeof token === 'string' && token.startsWith(EXPO_TOKEN_PREFIX);
}

// FCM rejects the whole message if any data value isn't a string.
function stringifyDataValues(data: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

const PERMANENT_FAILURE_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

// Registered client-side (lib/notifications.ts) with a Snooze-10-min and a
// Done action. Pushes tagged with this category render both action buttons;
// pushes without it show no buttons. Only reminder-type pushes should set
// this — an invite or a silent sync push has no "done" concept.
export const REMINDER_ACTIONS_CATEGORY = 'lifewise_reminder_actions';

// Filename only, no path — the audio file ships inside the app binary and is
// looked up by name on-device. A build that hasn't bundled it yet silently
// falls back to the system default sound.
const REMINDER_SOUND = 'reminder.wav';

export interface PushPayload {
  title?: string;
  body?: string;
  data: Record<string, any>;
  imageUrl?: string;
  channelId?: string; // one of the four client-created Android channels; omit for a silent/data-only push
  // Set to REMINDER_ACTIONS_CATEGORY to show Snooze/Done buttons and play the
  // custom reminder sound; omit for informational pushes (invites, sync).
  categoryId?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
}

// Sends to every device a user owns and prunes tokens FCM permanently rejects.
// Does not throw — a push failure should never fail the caller's main flow
// (e.g. saving a bill, accepting an invite); it logs and returns counts.
export async function sendPushToUser(
  messaging: any,
  pushTokensCollection: any,
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  if (!messaging) return { sent: 0, failed: 0 };

  const tokenDocs = await pushTokensCollection
    .find({ userId })
    .project({ token: 1, _id: 0 })
    .toArray();
  const tokens = tokenDocs.map((t: any) => t.token).filter(Boolean);
  if (!tokens.length) return { sent: 0, failed: 0 };

  return sendPushToTokens(messaging, pushTokensCollection, userId, tokens, payload);
}

// Same as sendPushToUser, but for a pre-fetched multi-recipient token list
// (e.g. owner + caregivers) where the caller already queried push_tokens
// with an $in filter. Tokens are pruned per-owner via the userId on each doc.
export async function sendPushToTokenDocs(
  messaging: any,
  pushTokensCollection: any,
  tokenDocs: { token: string; userId: string }[],
  payload: PushPayload,
): Promise<PushResult> {
  if (!messaging || !tokenDocs.length) return { sent: 0, failed: 0 };

  const byToken = new Map(tokenDocs.map((d) => [d.token, d.userId]));
  const tokens = Array.from(byToken.keys());

  return sendPushToTokens(messaging, pushTokensCollection, null, tokens, payload, byToken);
}

async function sendPushToTokens(
  messaging: any,
  pushTokensCollection: any,
  singleUserId: string | null,
  tokens: string[],
  payload: PushPayload,
  tokenOwnerMap?: Map<string, string>,
): Promise<PushResult> {
  // FCM caps multicast at 500 tokens per call.
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const message: any = {
        tokens: chunk,
        data: stringifyDataValues(
          payload.categoryId ? { ...payload.data, categoryId: payload.categoryId } : payload.data,
        ),
      };

      if (payload.title || payload.body) {
        message.notification = {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
        };
      }

      if (payload.channelId) {
        message.android = {
          priority: 'high',
          notification: {
            channelId: payload.channelId,
            // Must match android/app/src/main/res/drawable-*/notification_icon.png,
            // which the app ships and declares in AndroidManifest.xml. Without an
            // explicit icon here, FCM renders its own default in the system process
            // when the app is backgrounded — a different logo than the one local,
            // foreground-rendered notifications show for the same app.
            icon: 'notification_icon',
            color: '#4F46E5',
            ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
            ...(payload.categoryId ? { clickAction: payload.categoryId, sound: REMINDER_SOUND } : {}),
          },
        };
        message.apns = {
          payload: {
            aps: {
              sound: payload.categoryId ? REMINDER_SOUND : 'default',
              ...(payload.categoryId ? { category: payload.categoryId } : {}),
            },
          },
        };
      } else {
        // Data-only/silent push: no notification block, no sound.
        message.android = { priority: 'high' };
      }

      const res = await messaging.sendEachForMulticast(message);
      sent += res.successCount;
      failed += res.failureCount;

      res.responses.forEach((r: any, i: number) => {
        if (r.success) return;
        const code = r.error?.code;
        console.error('[Push] send failed', { code, message: r.error?.message });
        if (PERMANENT_FAILURE_CODES.has(code)) {
          deadTokens.push(chunk[i]);
        }
      });
    } catch (err) {
      console.error('[Push] chunk send threw', err);
      failed += chunk.length;
    }
  }

  if (deadTokens.length) {
    try {
      if (tokenOwnerMap) {
        await pushTokensCollection.deleteMany({ token: { $in: deadTokens } });
      } else if (singleUserId) {
        await pushTokensCollection.deleteMany({ userId: singleUserId, token: { $in: deadTokens } });
      }
      console.log(`[Push] Pruned ${deadTokens.length} dead token(s)`);
    } catch (pruneErr) {
      console.error('[Push] Failed to prune dead tokens', pruneErr);
    }
  }

  console.log(`[Push] sent=${sent} failed=${failed}`);
  return { sent, failed };
}
