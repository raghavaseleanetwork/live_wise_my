// One-time migration requested in CAREGIVER-PERMISSIONS-FRONTEND-VERIFICATION-AND-ANSWERS.md §4:
// family_members with `features` stored as an exactly-empty object ({}) are
// indistinguishable from "never configured" on the client. Unset the field
// for those documents only, leaving legacy boolean-shaped `features`
// (e.g. { medicines: true, reminders: true }) untouched.
import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) {
    console.error('MONGODB_URI (or DATABASE_URL) is not set — refusing to run against no configured database.');
    process.exit(1);
  }
  const dbName = process.env.MONGODB_DB_NAME || 'lifewise';

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  const family = db.collection('family_members');

  // Exact match only — {} — never a non-empty object, whatever its shape.
  const filter = { features: {} };

  const before = await family.countDocuments(filter);
  console.log(`[migrate-empty-features] Documents with features === {}: ${before}`);

  if (before === 0) {
    console.log('[migrate-empty-features] Nothing to do.');
    await client.close();
    return;
  }

  const result = await family.updateMany(filter, { $unset: { features: '' } });
  console.log(`[migrate-empty-features] Matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);

  const after = await family.countDocuments(filter);
  console.log(`[migrate-empty-features] Remaining with features === {} after migration: ${after}`);

  await client.close();
  process.exit(after === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[migrate-empty-features] Failed:', err);
  process.exit(1);
});
