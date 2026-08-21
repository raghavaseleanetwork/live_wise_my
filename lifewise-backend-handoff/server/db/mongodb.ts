import { MongoClient, Db } from 'mongodb';
import { getMemoryDb } from './memory';

const DB_NAME = process.env.MONGODB_DB_NAME || 'lifewise';
const CONNECT_TIMEOUT_MS = 5000;

let client: MongoClient;
let db: Db | null = null;
let useMemory = false;

function getMongoUri() {
  return process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017';
}

export async function connectMongo(): Promise<Db | ReturnType<typeof getMemoryDb>> {
  if (useMemory) return getMemoryDb();
  if (db) return db;

  try {
    const uri = getMongoUri();
    client = new MongoClient(uri, { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS });
    await client.connect();
    db = client.db(DB_NAME);
    await ensureIndexes(db);
    console.log('LifeWise: Connected to MongoDB');
    return db;
  } catch (err) {
    console.warn('MongoDB connection failed (using in-memory store):', (err as Error).message);
    console.warn('Set MONGODB_URI for persistent data (e.g. MongoDB Atlas).');
    useMemory = true;
    return getMemoryDb();
  }
}

async function ensureIndexes(database: Db) {
  await database.collection('users').createIndex({ email: 1 }, { unique: true });
  await database.collection('users').createIndex({ phone: 1 });
  await database.collection('transactions').createIndex({ userId: 1, date: -1 });
  await database.collection('bills').createIndex({ userId: 1, dueDate: 1 });
  await database.collection('notifications').createIndex({ userId: 1, createdAt: -1 });
  await database.collection('reminder_logs').createIndex({ userId: 1, billId: 1, channel: 1, dayOffset: 1 }, { unique: true });
  await database.collection('medicine_logs').createIndex({ userId: 1, timestamp: -1 });
}

export function getDb(): Db | ReturnType<typeof getMemoryDb> {
  if (useMemory) return getMemoryDb();
  if (!db) throw new Error('Database not connected. Call connectMongo() first.');
  return db;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    db = null;
  }
}

