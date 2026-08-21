import * as dotenv from 'dotenv';
dotenv.config();

// One-time cleanup: every Expo-format token in push_tokens is unusable by
// firebase-admin (FCM rejects them outright) and has been since the
// collection existed — the app never sent a native FCM/APNs token until
// this fix. Deleting them is safe: clients re-register on next launch.
async function purge() {
  try {
    const { connectMongo, getDb } = await import('../server/db/mongodb');
    await connectMongo();
    const db = getDb();
    if (!db) {
      console.error('Database connection failed');
      process.exit(1);
    }
    const pushTokens = db.collection('push_tokens');

    const before = await pushTokens.countDocuments({});
    const result = await pushTokens.deleteMany({ token: { $regex: '^ExponentPushToken\\[' } });
    const after = await pushTokens.countDocuments({});

    console.log(`push_tokens before: ${before}, deleted: ${result.deletedCount}, remaining: ${after}`);
    process.exit(0);
  } catch (err) {
    console.error('Purge error:', err);
    process.exit(1);
  }
}

purge();
