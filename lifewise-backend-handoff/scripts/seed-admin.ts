import * as dotenv from 'dotenv';
dotenv.config();

import { connectMongo, getDb } from '../server/db/mongodb';
import bcrypt from 'bcryptjs';

async function seed() {
  try {
    await connectMongo();
    const db = getDb();
    if (!db) {
      console.error('Database connection failed');
      process.exit(1);
    }
    const users = db.collection('users');
    
    const email = 'admin@lifewise.com';
    const password = 'Ruchit@1415';
    const hash = await bcrypt.hash(password, 10);
    
    const result = await users.updateOne(
      { email },
      { $set: { 
          name: 'Super Admin',
          email,
          passwordHash: hash,
          role: 'admin',
          createdAt: new Date(),
          phone: '+910000000000',
          phoneVerified: true,
          status: 'active'
        } 
      },
      { upsert: true }
    );
    
    if (result.upsertedId !== null && result.upsertedId !== undefined) {
      console.log('Admin user created successfully');
    } else {
      console.log('Admin user updated successfully');
    }
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
