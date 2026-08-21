import * as dotenv from 'dotenv';
dotenv.config();

// Dynamic imports, run after dotenv.config() — this file executes as an ESM
// module under tsx, where static `import` specifiers are hoisted and
// evaluated before any other top-level statement (including dotenv.config()
// above). A static import of server/db/mongodb here would read
// MONGODB_DB_NAME as undefined and silently connect to the wrong database.
async function backfill() {
  try {
    const { connectMongo, getDb } = await import('../server/db/mongodb');
    const { backfillRateRange } = await import('../server/exchange-rates');
    await connectMongo();
    const db = getDb();
    if (!db) {
      console.error('Database connection failed');
      process.exit(1);
    }
    const exchangeRates = db.collection('exchange_rates');

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 730);

    const toKey = to.toISOString().slice(0, 10);
    const fromKey = from.toISOString().slice(0, 10);

    console.log(`Backfilling exchange rates from ${fromKey} to ${toKey}...`);
    const count = await backfillRateRange(exchangeRates as any, fromKey, toKey);
    console.log(`Stored ${count} daily rate rows.`);
    process.exit(0);
  } catch (err) {
    console.error('Backfill error:', err);
    process.exit(1);
  }
}

backfill();
