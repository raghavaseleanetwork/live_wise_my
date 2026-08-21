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
    const notifications = db.collection('notifications');
    const support = db.collection('support_tickets');
    const medicineLogs = db.collection('medicine_logs');

    console.log('Seeding Comprehensive Demo Account: admin@lifewise.com');

    // 1. Create or update admin user
    const result = await users.findOneAndUpdate(
      { email },
      {
        $set: {
          name: 'Ruchit (Admin)',
          email,
          passwordHash: hash,
          role: 'admin',
          createdAt: new Date(),
          phone: '+919876543210',
          phoneVerified: true,
          status: 'active',
          plan: 'premium',
          avatarUrl: 'https://i.pravatar.cc/150?u=admin'
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const userId = result?._id;
    if (!userId) throw new Error('User not found or created.');

    // Clear old demo data
    await family.deleteMany({ userId });
    await bills.deleteMany({ userId });
    await health.deleteMany({ userId });
    await caregivers.deleteMany({ userId });
    await transactions.deleteMany({ userId });
    await notifications.deleteMany({ userId });
    await support.deleteMany({ userId });
    await medicineLogs.deleteMany({ userId });

    // 2. Add Family Members with Medicines and more details
    const momId = new ObjectId();
    const dadId = new ObjectId();
    const childId = new ObjectId();
    
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
        medicines: [
          { id: new ObjectId().toString(), name: 'Aspirin', dosage: '100mg', time: ['09:00', '21:00'], condition: 'Heart', status: 'active' },
          { id: new ObjectId().toString(), name: 'Metformin', dosage: '500mg', time: ['13:00'], condition: 'Diabetes', status: 'active' }
        ],
        caregivers: [
          { id: new ObjectId().toString(), name: 'Dr. Sharma', email: 'drsharma@example.com', phone: '+919876500010', permission: 'edit', addedAt: new Date() }
        ],
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
        medicines: [
          { id: new ObjectId().toString(), name: 'Lisinopril', dosage: '10mg', time: ['08:00'], condition: 'BP', status: 'active' }
        ],
        caregivers: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: childId,
        userId,
        name: 'Rohan',
        relationship: 'son',
        avatarUrl: 'https://i.pravatar.cc/150?u=rohan',
        dateOfBirth: '2010-10-10',
        bloodGroup: 'B+',
        phone: '',
        modules: ['education', 'health', 'routine'],
        features: { education: true, health: true, routine: true },
        medicines: [],
        caregivers: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ]);

    // 3. Add Health Logs
    const now = new Date();
    const healthLogs = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      // Mom logs
      healthLogs.push({
        userId, memberId: momId.toString(), type: 'blood_pressure', value: `${120 + Math.floor(Math.random()*10)}/${80 + Math.floor(Math.random()*5)}`, unit: 'mmHg', date: d, createdAt: d,
      });
      healthLogs.push({
        userId, memberId: momId.toString(), type: 'blood_sugar', value: `${95 + Math.floor(Math.random()*20)}`, unit: 'mg/dL', date: d, createdAt: d,
      });
      // Dad logs
      healthLogs.push({
        userId, memberId: dadId.toString(), type: 'weight', value: `${75 + Math.random()*2}`, unit: 'kg', date: d, createdAt: d,
      });
    }
    await health.insertMany(healthLogs);

    // 4. Add Bills / Reminders / Subscriptions
    await bills.insertMany([
      {
        userId, title: 'Electricity Bill', amount: 2500, currency: 'INR', dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), type: 'bill', repeat: 'monthly', category: 'bills', status: 'active', ownerId: dadId.toString(), createdAt: now,
      },
      {
        userId, title: 'Car Insurance Premium', amount: 15000, currency: 'INR', dueDate: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000), type: 'subscription', repeat: 'yearly', category: 'insurance', status: 'active', ownerId: dadId.toString(), createdAt: now,
      },
      {
        userId, title: 'Netflix Subscription', amount: 649, currency: 'INR', dueDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), type: 'subscription', repeat: 'monthly', category: 'subscriptions', status: 'active', ownerId: userId.toString(), createdAt: now,
      },
      {
        userId, title: 'School Fees (Rohan)', amount: 12000, currency: 'INR', dueDate: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000), type: 'bill', repeat: 'quarterly', category: 'education', status: 'active', ownerId: childId.toString(), createdAt: now,
      }
    ]);

    // 5. Add Transactions (Expenses & Incomes)
    await transactions.insertMany([
      { userId, title: 'Groceries', amount: 4500, category: 'food', date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), type: 'expense', createdAt: new Date() },
      { userId, title: 'Fuel', amount: 2000, category: 'transport', date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), type: 'expense', createdAt: new Date() },
      { userId, title: 'Salary', amount: 85000, category: 'work', date: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), type: 'income', createdAt: new Date() },
      { userId, title: 'Medicine (Mom)', amount: 1200, category: 'health', date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), type: 'expense', createdAt: new Date() },
      { userId, title: 'Internet Bill', amount: 999, category: 'bills', date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), type: 'expense', createdAt: new Date() },
    ]);

    // 6. Add Support Tickets
    await support.insertMany([
      {
        userId, subject: 'App Crashing on Medicine upload', description: 'When I try to upload my mom prescription, the app crashes.', category: 'bug', priority: 'high', status: 'active', createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), updatedAt: new Date()
      },
      {
        userId, subject: 'How to add insurance policy?', description: 'I want to add a PDF for dad car insurance. How?', category: 'general', priority: 'low', status: 'closed', createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), updatedAt: new Date()
      }
    ]);

    // 7. Add Notifications
    await notifications.insertMany([
      { userId, title: 'Welcome to LifeWise', message: 'Your family OS is ready to use.', type: 'system', isRead: false, createdAt: new Date() },
      { userId, title: 'Bill Due Soon', message: 'Electricity Bill of ₹2500 is due in 5 days.', type: 'reminder', isRead: false, createdAt: new Date() },
      { userId, title: 'Health Log Missing', message: 'You haven\'t logged Mom\'s BP today.', type: 'alert', isRead: true, createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) },
    ]);

    console.log('--- ALL SEED DATA ADDED SUCCESSFULLY ---');
    console.log('Login Email: admin@lifewise.com');
    console.log('Password: password123');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
