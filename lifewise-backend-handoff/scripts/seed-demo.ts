import * as dotenv from 'dotenv';
dotenv.config();

import { connectMongo, getDb } from '../server/db/mongodb';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';

async function seed() {
  try {
    await connectMongo();
    const db = getDb();
    if (!db) {
      console.error('Database connection failed');
      process.exit(1);
    }

    const email = 'admin@lifewise.com';
    const password = 'password123';
    const hash = await bcrypt.hash(password, 10);

    const users = db.collection('users');
    const family = db.collection('family_members');
    const bills = db.collection('bills');
    const health = db.collection('health_readings');
    const caregivers = db.collection('caregivers');
    const transactions = db.collection('transactions');

    console.log('Seeding Demo Account: admin@lifewise.com');

    // 1. Create or update admin user
    const result = await users.findOneAndUpdate(
      { email },
      {
        $set: {
          name: 'Ruchit (Demo)',
          email,
          passwordHash: hash,
          role: 'admin',
          createdAt: new Date(),
          phone: '+919876543210',
          phoneVerified: true,
          status: 'active',
          plan: 'premium',
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const userId = result?._id;
    if (!userId) throw new Error('User not found or created.');
    console.log(`User ID: ${userId}`);

    // Clear old demo data
    await family.deleteMany({ userId });
    await bills.deleteMany({ userId });
    await health.deleteMany({ userId });
    await caregivers.deleteMany({ userId });
    await transactions.deleteMany({ userId });
    console.log('Old demo data cleared.');

    // 2. Add Family Members
    const momId = new ObjectId();
    const dadId = new ObjectId();
    
    await family.insertMany([
      {
        _id: momId,
        userId,
        name: 'Mom',
        relationship: 'mummy',
        avatarUrl: 'https://i.pravatar.cc/150?u=mom',
        dateOfBirth: '1970-05-14',
        bloodGroup: 'O+',
        phone: '+919876500001',
        modules: ['medicine', 'health', 'doctor', 'documents'],
        features: { medicine: true, health: true, doctor: true, documents: true },
        medicines: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: dadId,
        userId,
        name: 'Dad',
        relationship: 'papa',
        avatarUrl: 'https://i.pravatar.cc/150?u=dad',
        dateOfBirth: '1965-08-22',
        bloodGroup: 'A+',
        phone: '+919876500002',
        modules: ['vehicle', 'insurance', 'bills', 'routine'],
        features: { vehicle: true, insurance: true, bills: true, routine: true },
        medicines: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ]);
    console.log('Added family members.');

    // 3. Add Health Logs for Mom
    const now = new Date();
    const healthLogs = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      healthLogs.push({
        userId,
        memberId: momId.toString(),
        type: 'blood_pressure',
        value: `${120 + Math.floor(Math.random()*10)}/${80 + Math.floor(Math.random()*5)}`,
        unit: 'mmHg',
        date: d,
        notes: i === 0 ? 'Feeling fine' : '',
        createdAt: d,
      });
      healthLogs.push({
        userId,
        memberId: momId.toString(),
        type: 'blood_sugar',
        value: `${95 + Math.floor(Math.random()*20)}`,
        unit: 'mg/dL',
        date: d,
        createdAt: d,
      });
    }
    await health.insertMany(healthLogs);
    console.log('Added health readings for Mom.');

    // 4. Add Bills / Reminders
    await bills.insertMany([
      {
        userId,
        title: 'Electricity Bill',
        amount: 2500,
        currency: 'INR',
        dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
        type: 'bill',
        repeat: 'monthly',
        category: 'bills',
        status: 'active',
        ownerId: dadId.toString(),
        createdAt: now,
      },
      {
        userId,
        title: 'Car Insurance Premium',
        amount: 15000,
        currency: 'INR',
        dueDate: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
        type: 'subscription',
        repeat: 'yearly',
        category: 'insurance',
        status: 'active',
        ownerId: dadId.toString(),
        createdAt: now,
      },
      {
        userId,
        title: 'Morning Medicine (Mom)',
        amount: 0,
        dueDate: new Date(now.getTime() + 1 * 60 * 60 * 1000), // 1 hour from now
        type: 'custom',
        repeat: 'daily',
        category: 'health',
        status: 'active',
        ownerId: momId.toString(),
        createdAt: now,
      }
    ]);
    console.log('Added Reminders / Bills.');

    // 5. Add Transactions (Expenses)
    await transactions.insertMany([
      {
        userId,
        title: 'Groceries',
        amount: 4500,
        category: 'food',
        date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        type: 'expense',
        createdAt: new Date(),
      },
      {
        userId,
        title: 'Fuel',
        amount: 2000,
        category: 'transport',
        date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        type: 'expense',
        createdAt: new Date(),
      }
    ]);
    console.log('Added some transactions.');

    console.log('--- SEED COMPLETE ---');
    console.log('Login Email: admin@lifewise.com');
    console.log('Password: password123');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
