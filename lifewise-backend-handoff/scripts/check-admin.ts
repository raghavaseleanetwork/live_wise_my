import { connectMongo, getDb } from '../server/db/mongodb';
import * as dotenv from 'dotenv';
dotenv.config();

async function check() {
  try {
    await connectMongo();
    const db = getDb();
    if (!db) {
      console.error('DB not found');
      process.exit(1);
    }
    const users = db.collection('users');
    const user = await users.findOne({ email: 'admin@lifewise.com' });
    console.log('Admin user found:', !!user);
    if (user) {
      console.log('User details:', JSON.stringify({ email: user.email, role: user.role, status: user.status }));
    }
    process.exit(0);
  } catch (err) {
    console.error('Check error:', err);
    process.exit(1);
  }
}
check();
