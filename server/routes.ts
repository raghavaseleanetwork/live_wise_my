import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { connectMongo, getDb } from './db/mongodb';
import { getFirebaseMessaging } from './firebase-admin';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { Server as SocketServer } from 'socket.io';
import { SupportTicketSchema, SupportMessageSchema, type SupportTicket, type SupportMessage } from './db/support-schema';
import { SubscriptionPlanSchema, PromoCodeSchema, type SubscriptionPlan, type PromoCode } from './db/subscription-schema';
import { SystemSettingsSchema, type SystemSettings } from './db/system-settings-schema';

function toId(id: any): any {
  if (id instanceof ObjectId) return id;
  if (!id) return id;

  let cleanId = String(id);
  // Strip common legacy prefixes if present
  if (cleanId.startsWith('user-')) cleanId = cleanId.replace('user-', '');
  else if (cleanId.startsWith('ticket-')) cleanId = cleanId.replace('ticket-', '');
  else if (cleanId.startsWith('tx-')) cleanId = cleanId.replace('tx-', '');
  else if (cleanId.startsWith('msg-')) cleanId = cleanId.replace('msg-', '');

  return /^[a-f0-9]{24}$/i.test(cleanId) ? new ObjectId(cleanId) : cleanId;
}

async function initIndexes() {
  const db = getDb();
  if (!db) return;
  const transactions = db.collection('transactions');
  const bills = db.collection('bills');
  const users = db.collection('users');
  const billHistory = db.collection('billHistory');
  const family = db.collection('family_members');

  try {
    // Unique index for SMS deduplication: same user, same SMS unique ID
    await (transactions as any).createIndex({ userId: 1, smsId: 1 }, { unique: true, partialFilterExpression: { smsId: { $exists: true } } });
    // Index for common queries
    await (transactions as any).createIndex({ userId: 1, date: -1 });
    await (bills as any).createIndex({ userId: 1 });
    await (billHistory as any).createIndex({ billId: 1, userId: 1, date: -1 });
    await (users as any).createIndex({ email: 1 }, { unique: true });
    await (family as any).createIndex({ userId: 1 });
    console.log('[DB] Indexes initialized');
  } catch (err) {
    console.error('[DB] Index initialization failed:', err);
  }
}

type CategoryType = 'health' | 'bills' | 'family' | 'work' | 'tasks' | 'subscriptions' | 'finance' | 'habits' | 'travel' | 'events' | 'food' | 'shopping' | 'transport' | 'entertainment' | 'education' | 'investment' | 'others';
type ReminderType = 'bill' | 'subscription' | 'custom';
type RepeatType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type ReminderStatus = 'active' | 'paid' | 'snoozed';

const JWT_SECRET = process.env.JWT_SECRET || 'lifewise-secret-change-in-production';
const JWT_EXPIRY = '7d';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REMINDER_EMAIL_FROM = process.env.REMINDER_EMAIL_FROM || 'LifeWise <no-reply@lifewise.app>';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://lifewise.app';
const APP_OPEN_URL = process.env.APP_OPEN_URL || APP_BASE_URL;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || 'asst_WmTjqjLyo3ki1MFHtqDtal6R';
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const S3_BUCKET = process.env.AWS_S3_BUCKET;
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

const reminderTemplatePath = path.resolve(process.cwd(), 'server', 'templates', 'reminder-email.html');
const REMINDER_EMAIL_TEMPLATE = fs.existsSync(reminderTemplatePath)
  ? fs.readFileSync(reminderTemplatePath, 'utf-8')
  : '';

type ReminderChannel = 'email' | 'in_app';

const upload = multer({ storage: multer.memoryStorage() });

const s3 = new S3Client({ region: AWS_REGION });
const textract = new TextractClient({ region: AWS_REGION });

// SMS stub: logs OTP. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE for real SMS.
async function sendSmsOtp(phone: string, otp: string): Promise<void> {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_PHONE;
      const body = `Your LifeWise verification code is: ${otp}. Valid for 10 minutes.`;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        },
        body: new URLSearchParams({ To: phone, From: from!, Body: body }),
      });
      if (!res.ok) {
      }
    } catch (e) {
      console.error('SMS send error:', e);
    }
  } else if (process.env.NODE_ENV !== 'production') {
    console.log(`[SMS OTP] Phone: ${phone}, OTP: ${otp}`);
  }
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

interface JwtPayload {
  userId: string;
  email: string;
}

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    (req as any).userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function adminAuthMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ message: 'Admin authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    (req as any).userId = decoded.userId;
    req.userEmail = decoded.email;

    // Hardcoded admin for now, or check for admin role
    const isAdmin = decoded.email === 'admin@lifewise.app' || 
                    decoded.email === 'demo@lifewise.test' ||
                    decoded.email === 'admin@lifewise.com';
    
    if (!isAdmin) {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
function renderReminderEmailTemplate(params: {
  userName: string;
  reminderType: ReminderType;
  daysLeft: number;
  billName: string;
  dueDateLabel: string;
  category: string;
  amount: number;
  currency: string;
  status: string;
  reminderSchedule: string;
  appUrl: string;
}): string {
  if (!REMINDER_EMAIL_TEMPLATE) return '';
  const plural = params.daysLeft === 1 ? '' : 's';
  return REMINDER_EMAIL_TEMPLATE
    .replace(/{{USER_NAME}}/g, params.userName || 'there')
    .replace(/{{REMINDER_TYPE}}/g, params.reminderType || 'bill')
    .replace(/{{DAYS_LEFT}}/g, String(params.daysLeft))
    .replace(/{{DAYS_LEFT_PLURAL}}/g, plural)
    .replace(/{{BILL_NAME}}/g, params.billName)
    .replace(/{{DUE_DATE}}/g, params.dueDateLabel)
    .replace(/{{CATEGORY}}/g, params.category)
    .replace(/{{CURRENCY}}/g, params.currency)
    .replace(/{{AMOUNT}}/g, params.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
    .replace(/{{STATUS}}/g, params.status)
    .replace(/{{REMINDER_SCHEDULE}}/g, params.reminderSchedule)
    .replace(/{{APP_URL}}/g, params.appUrl);
}

async function sendReminderEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log('[Reminder email] RESEND_API_KEY not set, skipping email send.');
    return;
  }
  if (!opts.html) {
    console.log('[Reminder email] Empty HTML, skipping email send.');
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: REMINDER_EMAIL_FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Resend email error:', err);
    }
  } catch (e) {
    console.error('Reminder email send error:', e);
  }
}

function getOpenAIKey(): string | undefined {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env.OPENAI_TOKEN ||
    process.env.OPEN_AI_API_KEY
  );
}

async function parseReminderWithAI(text: string): Promise<{
  title: string;
  isoDate: string; // YYYY-MM-DD
  hour: number; // 0-23
  minute: number; // 0-59
  repeatType: RepeatType;
  reminderType: ReminderType;
}> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultIso = tomorrow.toISOString().slice(0, 10);

  const openAIKey = getOpenAIKey();
  if (!openAIKey) {
    return {
      title: text.trim().slice(0, 80) || 'Reminder',
      isoDate: defaultIso,
      hour: 9,
      minute: 0,
      repeatType: 'none',
      reminderType: 'custom',
    };
  }

  const prompt =
    'You are a multilingual reminder parser. Given a text in ANY language (English, Hindi, Gujarati), extract:\n' +
    '- title (Summary ONLY - STRICTLY REMOVE all digits, numbers, and currency units like rs, rupees, rupaiya, ₹, रुपये, રૂપિયા)\n' +
    '- amount (numerical value only, extract from any script - if none, use null)\n' +
    '- isoDate (YYYY-MM-DD)\n' +
    '- hour (0-23)\n' +
    '- minute (0-59)\n' +
    '- repeatType one of: none,daily,weekly,monthly,yearly\n' +
    '- reminderType one of: bill,subscription,custom\n' +
    'Rules:\n' +
    '- If no date mentioned, use ' + defaultIso + '.\n' +
    '- If no time mentioned, use 9:00.\n' +
    '- If amount is present, default reminderType to "bill".\n' +
    'Return ONLY strict JSON with keys: title, amount, isoDate, hour, minute, repeatType, reminderType.\n' +
    'Input: ' +
    JSON.stringify(text) +
    '\nOutput in JSON:';

  try {
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (!aiRes.ok) throw new Error('openai_parse_failed');
    const json = await aiRes.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('openai_empty');
    const parsed = JSON.parse(content);

    const title = String(parsed.title || text).trim().slice(0, 80) || 'Reminder';
    const isoDate = String(parsed.isoDate || defaultIso).slice(0, 10);
    const hour = Math.max(0, Math.min(23, Number(parsed.hour)));
    const minute = Math.max(0, Math.min(59, Number(parsed.minute)));
    const repeatType = (String(parsed.repeatType || 'none') as RepeatType) || 'none';
    const reminderType = (String(parsed.reminderType || 'custom') as ReminderType) || 'custom';

    return {
      title,
      isoDate,
      hour: Number.isFinite(hour) ? hour : 9,
      minute: Number.isFinite(minute) ? minute : 0,
      repeatType: (['none', 'daily', 'weekly', 'monthly', 'yearly'] as const).includes(repeatType)
        ? repeatType
        : 'none',
      reminderType: (['bill', 'subscription', 'custom'] as const).includes(reminderType)
        ? reminderType
        : 'custom',
    };
  } catch {
    return {
      title: text.trim().slice(0, 80) || 'Reminder',
      isoDate: defaultIso,
      hour: 9,
      minute: 0,
      repeatType: 'none',
      reminderType: 'custom',
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // API responses are per-user and change constantly; letting anything cache
  // them makes clients show stale data after an add/edit even though they
  // refetched. Also drop ETags so conditional GETs can't 304 into old bodies.
  app.set('etag', false);
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    next();
  });

  // Initialize Socket.IO
  const io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // --- Socket.IO Handlers ---
  io.on('connection', (socket: any) => {
    socket.on('join-ticket', (ticketId: string) => {
      socket.join(`ticket-${ticketId}`);
    });

    socket.on('send-message', async (data: { ticketId: string; userId: string; content: string; senderType: 'user' | 'admin' }) => {
      try {
        const { ticketId, userId, content, senderType } = data;
        const message = {
          ticketId,
          senderId: userId,
          senderType,
          content,
          type: 'text',
          status: 'sent',
          createdAt: new Date(),
        };

        const result = await (getDb().collection('support_messages') as any).insertOne(message);
        const savedMessage = { ...message, _id: result.insertedId };

        const updateData: any = { lastMessageAt: new Date(), updatedAt: new Date() };
        if (senderType === 'admin') updateData.status = 'in_progress';

        await (getDb().collection('support_tickets') as any).updateOne({ _id: toId(ticketId) }, { $set: updateData });
        io.to(`ticket-${ticketId}`).emit('new-message', savedMessage);
        if (senderType === 'admin') io.to(`ticket-${ticketId}`).emit('ticket-status-update', { ticketId, status: 'in_progress' });
      } catch (err) { console.error('Socket send error:', err); }
    });

    socket.on('message-delivered', async (data: { ticketId: string; messageId: string }) => {
      try {
        await (getDb().collection('support_messages') as any).updateOne({ _id: toId(data.messageId), status: 'sent' }, { $set: { status: 'delivered' } });
        io.to(`ticket-${data.ticketId}`).emit('message-status-update', { messageId: data.messageId, status: 'delivered' });
      } catch (err) { console.error('Delivered error:', err); }
    });

    socket.on('message-read', async (data: { ticketId: string; messageId: string }) => {
      try {
        await (getDb().collection('support_messages') as any).updateOne({ _id: toId(data.messageId), status: { $in: ['sent', 'delivered'] } }, { $set: { status: 'read' } });
        io.to(`ticket-${data.ticketId}`).emit('message-status-update', { messageId: data.messageId, status: 'read' });
      } catch (err) { console.error('Read error:', err); }
    });

    socket.on('typing', (data: { ticketId: string; userId: string; isTyping: boolean; senderType: 'user' | 'admin' }) => {
      socket.to(`ticket-${data.ticketId}`).emit('typing-status', data);
    });
  });


  // Simplified and moved to top for absolute priority
  app.post('/api/tickets-read/:id', authMiddleware, async (req, res) => {
    try {
      const ticketId = req.params.id;
      const userId = (req as any).userId;
      console.log(`[Support] Marking read for ticket ${ticketId} (via /api/tickets-read)`);
      
      const result = await (getDb().collection('support_messages') as any).updateMany(
        { ticketId, senderId: { $ne: userId }, status: { $ne: 'read' } },
        { $set: { status: 'read' } }
      );
      
      res.json({ success: true, count: result.modifiedCount });
    } catch (err) {
      console.error('Mark read error:', err);
      res.status(500).json({ message: 'Failed to mark messages as read' });
    }
  });

  // System Status
  app.get('/api/system-status', async (req, res) => {
    try {
      let settings = await (getDb().collection('system_settings') as any).findOne({});
      if (!settings) {
        settings = SystemSettingsSchema.parse({});
      }
      res.json(settings);
    } catch (err) {
      console.error('System status error:', err);
      res.status(500).json({ message: 'Failed to fetch system status' });
    }
  });

  await connectMongo();
  await initIndexes();
  const db = getDb();
  const users = db.collection('users') as any;
  const transactions = db.collection('transactions') as any;
  const bills = db.collection('bills') as any;
  const family = db.collection('family_members') as any;
  const otpStore = db.collection('otp_store') as any;
  const notifications = db.collection('notifications') as any;
  const reminderLogs = db.collection('reminder_logs') as any;
  const pushTokens = db.collection('push_tokens') as any;
  const supportTickets = db.collection('support_tickets') as any;
  const medicineLogs = db.collection('medicine_logs') as any;
  const lifeScores = db.collection('life_scores') as any;
  const supportMessages = db.collection('support_messages') as any;
  const plans = db.collection('plans') as any;
  const promoCodes = db.collection('promo_codes') as any;
  const systemSettings = db.collection('system_settings') as any;
  const billHistory = db.collection('bill_history') as any;

  console.log('[DEBUG] registerRoutes: Initializing priority routes');

  // --- Priority: File Uploads ---
  app.post('/api/upload', authMiddleware, upload.single('file'), async (req: any, res: any) => {
    console.log('[DEBUG] POST /api/upload hit');
    try {
      if (!S3_BUCKET) {
        console.error('[DEBUG] S3_BUCKET not set');
        return res.status(500).json({ message: 'S3 bucket not configured.' });
      }
      const file = (req as any).file;
      if (!file || !file.buffer) {
        console.error('[DEBUG] No file in request');
        return res.status(400).json({ message: 'file is required' });
      }
      const key = `uploads/${(req as any).userId}/${Date.now()}-${file.originalname}`;
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype || 'image/jpeg', ACL: 'public-read',
      } as any));
      const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
      console.log('[DEBUG] Upload success:', url);
      return res.status(201).json({ url });
    } catch (err) {
      console.error('[DEBUG] Upload error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Priority: Family Hub ---
  app.get('/api/family', authMiddleware, async (req, res) => {
    console.log('[DEBUG] GET /api/family hit');
    try {
      const list = await family
        .find({ userId: (req as any).userId })
        .sort({ createdAt: -1 })
        .toArray();
      const out = list.map((m: any) => ({
        id: m._id.toString(),
        name: m.name,
        relationship: m.relationship || 'self',
        avatarUrl: (m as any).avatarUrl || null,
        medicines: Array.isArray(m.medicines) ? m.medicines : [],
      }));
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/family', authMiddleware, async (req, res) => {
    console.log('[DEBUG] POST /api/family hit');
    try {
      const { name, relationship, avatarUrl, dateOfBirth, features } = req.body;
      const doc = {
        userId: (req as any).userId,
        name: String(name || 'New Member').trim(),
        relationship: String(relationship || 'other'),
        avatarUrl: avatarUrl || null,
        dateOfBirth: dateOfBirth || null,
        features: features || { medicines: true, reminders: true, reports: false },
        medicines: [],
        createdAt: new Date(),
      };
      const result = await family.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.put('/api/family/:id', authMiddleware, async (req, res) => {
    console.log('[DEBUG] PUT /api/family/:id hit:', req.params.id);
    try {
      const { id } = req.params;
      const { name, relationship, avatarUrl, dateOfBirth, features } = req.body;
      const update: any = { updatedAt: new Date() };
      if (name !== undefined) update.name = String(name).trim();
      if (relationship !== undefined) update.relationship = String(relationship);
      if (avatarUrl !== undefined) update.avatarUrl = avatarUrl;
      if (dateOfBirth !== undefined) update.dateOfBirth = dateOfBirth;
      if (features !== undefined) update.features = features;
      const result = await family.updateOne({ _id: toId(id), userId: (req as any).userId }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ message: 'Not found' });
      const updated = await family.findOne({ _id: toId(id) });
      return res.json({ id: updated!._id.toString(), ...updated });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.delete('/api/family/:id', authMiddleware, async (req, res) => {
    console.log('[DEBUG] DELETE /api/family/:id hit:', req.params.id);
    try {
      const result = await family.deleteOne({ _id: toId(req.params.id), userId: (req as any).userId });
      if (result.deletedCount === 0) return res.status(404).json({ message: 'Not found' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Support API Routes (Moved to top for priority) ---

  // Get user's tickets with search, filter, and last message
  app.get('/api/support/tickets', authMiddleware, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { search, status, sort = 'desc' } = req.query;
      
      const query: any = { userId };
      if (status && status !== 'all') {
        query.status = status;
      }
      
      const pipeline: any[] = [
        { $match: query },
        {
          $lookup: {
            from: 'support_messages',
            let: { ticketId: { $toString: '$_id' } },
            pipeline: [
              { $match: { $expr: { $eq: ['$ticketId', '$$ticketId'] } } },
              { $sort: { createdAt: -1 } },
              { $limit: 1 }
            ],
            as: 'lastMessage'
          }
        },
        { $addFields: { lastMessage: { $arrayElemAt: ['$lastMessage', 0] } } }
      ];

      if (search) {
        pipeline.push({
          $match: {
            $or: [
              { subject: { $regex: search, $options: 'i' } },
              { 'lastMessage.content': { $regex: search, $options: 'i' } },
              { _id: { $regex: String(search), $options: 'i' } }
            ]
          }
        });
      }

      pipeline.push({ $sort: { lastMessageAt: sort === 'asc' ? 1 : -1 } });

      const tickets = await (supportTickets as any).aggregate(pipeline).toArray();
      res.json(tickets);
    } catch (err) {
      console.error('Fetch tickets error:', err);
      res.status(500).json({ message: 'Failed to fetch tickets' });
    }
  });

  // Get single ticket details
  app.get('/api/support/tickets/:id', authMiddleware, async (req: any, res) => {
    try {
      const userId = req.userId;
      const ticketId = req.params.id;
      
      const ticket = await (supportTickets as any).findOne({ _id: toId(ticketId), userId });
      if (!ticket) {
        return res.status(404).json({ message: 'Ticket not found' });
      }
      res.json(ticket);
    } catch (err) {
      console.error('Fetch single ticket error:', err);
      res.status(500).json({ message: 'Failed to fetch ticket' });
    }
  });

  // Update ticket status (e.g., close ticket)
  app.patch('/api/support/tickets/:id/status', authMiddleware, async (req: any, res) => {
    try {
      const ticketId = req.params.id;
      const { status } = req.body;
      
      if (!['active', 'in_progress', 'closed'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }

      const result = await (supportTickets as any).updateOne(
        { _id: toId(ticketId) },
        { $set: { status, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'Ticket not found' });
      }

      res.json({ success: true, status });
    } catch (err) {
      console.error('Update status error:', err);
      res.status(500).json({ message: 'Failed to update status' });
    }
  });

  // Create new ticket
  app.post('/api/support/tickets', authMiddleware, upload.single('media'), async (req: any, res: any) => {
    try {
      const userId = (req as any).userId;
      const { subject, description, category, priority } = req.body;
      
      let mediaUrl = '';
      if (req.file) {
        if (S3_BUCKET) {
          const key = `support/${userId}/${Date.now()}-${req.file.originalname}`;
          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
          }));
          mediaUrl = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
        }
      }

      const ticketData = SupportTicketSchema.parse({
        userId,
        subject,
        description,
        category,
        priority: priority || 'medium',
        mediaUrl,
        lastMessageAt: new Date(),
        status: 'active',
      });

      const result = await supportTickets.insertOne(ticketData);
      const ticketId = (result as any).insertedId;

      await supportMessages.insertOne({
        ticketId: ticketId.toString(),
        senderId: userId,
        senderType: 'user',
        content: description,
        type: 'text',
        status: 'sent',
        createdAt: new Date(),
      });

      res.status(201).json({ ...ticketData, _id: ticketId });
    } catch (err) {
      console.error('Create ticket error:', err);
      res.status(400).json({ message: 'Failed to create ticket' });
    }
  });

  // Get ticket messages
  app.get('/api/support/tickets/:id/messages', authMiddleware, async (req, res) => {
    try {
      const ticketId = req.params.id;
      const messages = await supportMessages.find({ ticketId }).sort({ createdAt: 1 }).toArray();
      res.json(messages);
    } catch (err) {
      console.error('Fetch messages error:', err);
      res.status(500).json({ message: 'Failed to fetch messages' });
    }
  });

  // Mark all messages as read for a ticket (Moved to /api/tickets-read/:id)

  // --- End Support API Routes ---

  // Seed official admin user
  const officialAdminEmail = 'admin@lifewise.com';
  const officialAdminPassword = 'Ruchit@1415';
  
  try {
    const existingAdmin = await users.findOne({ email: officialAdminEmail });
    const adminHash = await bcrypt.hash(officialAdminPassword, 10);
    if (!existingAdmin) {
      await users.insertOne({
        name: 'Super Admin',
        email: officialAdminEmail,
        passwordHash: adminHash,
        role: 'admin',
        createdAt: new Date(),
        phone: '+910000000000',
        phoneVerified: true
      });
      console.log('[seed] Official admin user created:', officialAdminEmail);
    } else {
      await users.updateOne(
        { _id: existingAdmin._id },
        { $set: { passwordHash: adminHash, role: 'admin' } }
      );
      console.log('[seed] Official admin user updated:', officialAdminEmail);
    }
  } catch (e) {
    console.error('[seed] Official admin failed:', e);
  }

  // Seed a stable demo login for QA / demos.
  const adminEmail = 'admin@lifewise.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Ruchit@1415';
  
  const demoEmail = 'demo@lifewise.test';
  const demoPassword = process.env.DEMO_USER_PASSWORD || 'Radhe@1415';
  const demoName = 'Demo User';
  let demoUserId: any = null;
  try {
    const existingDemo = await users.findOne({ email: demoEmail });
    const demoPasswordHash = await bcrypt.hash(demoPassword, 10);
    if (!existingDemo) {
      const created = await users.insertOne({
        name: demoName,
        email: demoEmail,
        passwordHash: demoPasswordHash,
        createdAt: new Date(),
        phone: '+919999000111',
        phoneVerified: true,
        settings: {
          monthlyBudget: 45000,
          reminderSettings: { defaultReminderDays: [7, 3, 1, 0], soundEnabled: true, vibrationEnabled: true },
        },
      });
      demoUserId = (created as any).insertedId.toString();
      console.log('[seed] demo user created:', demoEmail);
    } else {
      const result = await users.updateOne(
        { _id: (existingDemo as any)._id },
        {
          $set: {
            name: demoName,
            passwordHash: demoPasswordHash,
            phone: (existingDemo as any).phone || '+919999000111',
            phoneVerified: true,
            settings: {
              monthlyBudget: 45000,
              reminderSettings: { defaultReminderDays: [7, 3, 1, 0], soundEnabled: true, vibrationEnabled: true },
            },
          },
        },
      );
      demoUserId = existingDemo._id?.toString?.() ?? String(existingDemo._id);
      console.log('[seed] demo user refreshed:', demoEmail);
    }
  } catch (e) {
    console.error('[seed] demo user failed:', e);
  }

  // Seed realistic static data for the demo user so all flows can be tested.
  if (demoUserId) {
    try {
      const now = new Date();
      const mkDate = (daysOffset: number, hour = 10, minute = 0) => {
        const d = new Date(now);
        d.setDate(d.getDate() + daysOffset);
        d.setHours(hour, minute, 0, 0);
        return d.toISOString();
      };

      await Promise.all([
        transactions.deleteMany({ userId: demoUserId, source: 'demo-seed' } as any),
        bills.deleteMany({ userId: demoUserId, source: 'demo-seed' } as any),
        notifications.deleteMany({ userId: demoUserId, source: 'demo-seed' } as any),
        family.deleteMany({ userId: demoUserId, source: 'demo-seed' } as any),
      ]);

      await (transactions as any).insertMany([
        { userId: demoUserId, merchant: 'Swiggy', amount: 380, category: 'others', date: mkDate(-1, 20, 15), upiId: 'swiggy@upi', isDebit: true, description: 'Dinner order', source: 'demo-seed' },
        { userId: demoUserId, merchant: 'Uber', amount: 240, category: 'travel', date: mkDate(-2, 9, 20), upiId: 'uber@upi', isDebit: true, description: 'Office commute', source: 'demo-seed' },
        { userId: demoUserId, merchant: 'Netflix', amount: 649, category: 'subscriptions', date: mkDate(-3, 8, 0), upiId: 'netflix@upi', isDebit: true, description: 'Monthly subscription', source: 'demo-seed' },
        { userId: demoUserId, merchant: 'Apollo Pharmacy', amount: 1120, category: 'health', date: mkDate(-4, 18, 45), upiId: 'apollo@upi', isDebit: true, description: 'Medicines', source: 'demo-seed' },
        { userId: demoUserId, merchant: 'Salary Credit', amount: 85000, category: 'finance', date: mkDate(-8, 10, 0), upiId: 'employer@hdfcbank', isDebit: false, description: 'Monthly salary', source: 'demo-seed' },
      ]);

      await (bills as any).insertMany([
        { userId: demoUserId, name: 'Electricity Bill', amount: 2350, dueDate: mkDate(0, 20, 0), category: 'bills', isPaid: false, icon: 'flash', reminderType: 'bill', repeatType: 'monthly', status: 'active', reminderDaysBefore: [3, 1, 0], source: 'demo-seed' },
        { userId: demoUserId, name: 'Netflix Premium', amount: 649, dueDate: mkDate(2, 9, 0), category: 'subscriptions', isPaid: false, icon: 'refresh', reminderType: 'subscription', repeatType: 'monthly', status: 'active', reminderDaysBefore: [2, 1, 0], source: 'demo-seed' },
        { userId: demoUserId, name: 'Health Checkup', amount: 0, dueDate: mkDate(1, 7, 30), category: 'health', isPaid: false, icon: 'medkit', reminderType: 'custom', repeatType: 'yearly', status: 'active', reminderDaysBefore: [7, 1, 0], source: 'demo-seed' },
        { userId: demoUserId, name: 'Passport Renewal', amount: 0, dueDate: mkDate(15, 11, 0), category: 'tasks', isPaid: false, icon: 'globe', reminderType: 'custom', repeatType: 'none', status: 'active', reminderDaysBefore: [10, 3, 1], source: 'demo-seed' },
      ]);

      await notifications.insertMany([
        { userId: demoUserId, type: 'reminder', title: 'Electricity Bill', body: 'Due today at 8:00 PM', read: false, createdAt: new Date(), source: 'demo-seed', meta: { billName: 'Electricity Bill' } },
        { userId: demoUserId, type: 'insight', title: 'Spending insight', body: 'Food spending is 14% higher this week.', read: false, createdAt: new Date(Date.now() - 1000 * 60 * 30), source: 'demo-seed' },
      ] as any[]);

      await family.insertMany([
        { userId: demoUserId, name: 'Maa', relationship: 'mother', medicines: [], source: 'demo-seed', createdAt: new Date() },
        { userId: demoUserId, name: 'Papa', relationship: 'father', medicines: [], source: 'demo-seed', createdAt: new Date() },
      ] as any[]);

      console.log('[seed] demo data refreshed for:', demoEmail);
    } catch (seedErr) {
      console.error('[seed] demo data failed:', seedErr);
    }

    // Seed Plans and Promo Codes
    try {
      const planCount = await plans.countDocuments();
      if (planCount === 0) {
        await plans.insertMany([
          { 
            name: "Basic Shield", 
            type: "basic", 
            price: 499, 
            interval: "month", 
            features: ["Basic Support", "Limit to 5 Bills", "Family of 2"],
            status: "active",
            activeUsers: 142,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { 
            name: "Premium Guard", 
            type: "premium", 
            price: 1299, 
            interval: "month", 
            features: ["Priority Support", "Unlimited Bills", "Full Family Suite", "AI Insights"],
            status: "active",
            activeUsers: 89,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { 
            name: "Enterprise Core", 
            type: "enterprise", 
            price: 4999, 
            interval: "year", 
            features: ["24/7 Dedicated Agent", "Asset Management", "Legal Assistance", "Custom Reporting"],
            status: "active",
            activeUsers: 12,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ]);
        console.log('[seed] Plans initialized');
      }

      const promoCount = await promoCodes.countDocuments();
      if (promoCount === 0) {
        await promoCodes.insertMany([
          { 
            code: "WELCOME50", 
            discountPercent: 50, 
            description: "First month discount", 
            status: "active", 
            redemptions: 45, 
            maxRedemptions: 100,
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date()
          },
          { 
            code: "LIFEWISE", 
            discountPercent: 20, 
            description: "Platform wide launch offer", 
            status: "active", 
            redemptions: 12, 
            maxRedemptions: 500,
            createdAt: new Date()
          }
        ]);
        console.log('[seed] Promo codes initialized');
      }
    } catch (err) {
      console.error('[seed] Admin seeding failed:', err);
    }
  }

  // --- AUTH ROUTES ---
  app.post('/api/auth/oauth/google', async (req, res) => {
    try {
      const { idToken } = req.body;
      if (!idToken) {
        return res.status(400).json({ message: 'idToken is required' });
      }

      // Verify Google Token via Google API
      const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
      const verifyRes = await fetch(verifyUrl);
      if (!verifyRes.ok) {
        return res.status(401).json({ message: 'Invalid Google token' });
      }

      const googleUser = await verifyRes.json();
      const { email, name, picture, sub: googleId } = googleUser;

      if (!email) {
        return res.status(400).json({ message: 'Email not provided by Google' });
      }

      const db = getDb();
      if (!db) return res.status(500).json({ message: 'Database connection error' });

      let user = await db.collection('users').findOne({ email }) as any;

      if (!user) {
        // Create new user if doesn't exist
        const result = await db.collection('users').insertOne({
          email,
          name: name || email.split('@')[0],
          avatarUrl: picture || null,
          googleId,
          createdAt: new Date().toISOString(),
          onboarded: false,
        });
        user = { _id: result.insertedId, email, name, avatarUrl: picture };
      }

      const token = jwt.sign(
        { userId: (user as any)._id.toString(), email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      return res.json({
        token,
        user: {
          id: (user as any)._id.toString(),
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        }
      });
    } catch (err) {
      console.error('Google OAuth error:', err);
      return res.status(500).json({ message: 'Internal server error during Google login' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email, and password are required' });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }
      const emailLower = email.toLowerCase().trim();
      const existing = await users.findOne({ email: emailLower });
      if (existing) {
        return res.status(409).json({ message: 'An account with this email already exists' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const doc = {
        name: name.trim(),
        email: emailLower,
        passwordHash,
        createdAt: new Date(),
      };
      const result = await users.insertOne(doc);
      const userId = result.insertedId.toString();
      const userResponse = { id: userId, email: doc.email, name: doc.name };
      const token = jwt.sign({ userId, email: doc.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      return res.status(201).json({ user: userResponse, token });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ message: 'Server error. Please try again.' });
    }
  });

  app.post('/api/auth/verify-otp', async (req, res) => {
    try {
      const { phone, otp } = req.body;
      if (!phone || !otp) {
        return res.status(400).json({ message: 'Phone and OTP are required' });
      }
      const record = (await otpStore.findOne({ phone: String(phone).trim() })) as any;
      if (!record) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }
      const tenMin = 10 * 60 * 1000;
      if (Date.now() - new Date(record.createdAt).getTime() > tenMin) {
        await otpStore.deleteOne({ _id: (record as any)._id });
        return res.status(400).json({ message: 'OTP expired. Please request a new one.' });
      }
      if (String(record.otp) !== String(otp)) {
        return res.status(400).json({ message: 'Invalid OTP' });
      }
      const uid = toId(String((record as any).userId));
      await users.updateOne({ _id: uid }, { $set: { phoneVerified: true } });
      await otpStore.deleteOne({ _id: (record as any)._id });
      const user = (await users.findOne({ _id: uid })) as any;
      if (!user) return res.status(500).json({ message: 'User not found' });
      const userId = (user as any)._id.toString();
      const token = jwt.sign({ userId, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      return res.json({
        user: { id: userId, email: user.email, name: user.name, phone: user.phone, phoneVerified: true },
        token,
      });
    } catch (err) {
      console.error('Verify OTP error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/auth/resend-otp', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ message: 'Phone is required' });
      const phoneStr = String(phone).trim();
      const user = await users.findOne({ phone: phoneStr });
      if (!user) return res.status(404).json({ message: 'No account found for this phone' });
      const otp = generateOtp();
      await otpStore.deleteMany({ phone: phoneStr });
      await otpStore.insertOne({ phone: phoneStr, otp, createdAt: new Date(), userId: (user as any)._id?.toString?.() ?? (user as any)._id });
      await sendSmsOtp(phoneStr, otp);
      return res.json({ message: 'OTP sent' });
    } catch (err) {
      console.error('Resend OTP error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }
      const user = await users.findOne({ email: email.toLowerCase().trim() });
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      const userId = (user as any)._id.toString();
      const token = jwt.sign({ userId, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      return res.json({
        user: { id: userId, email: user.email, name: user.name, phone: user.phone, phoneVerified: user.phoneVerified },
        token,
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ message: 'Server error. Please try again.' });
    }
  });

  app.post('/api/auth/oauth/google', async (req, res) => {
    try {
      const { idToken } = req.body as { idToken?: string };
      if (!idToken) {
        return res.status(400).json({ message: 'idToken is required' });
      }

      const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      if (!verifyRes.ok) {
        return res.status(401).json({ message: 'Invalid Google token' });
      }

      const payload = (await verifyRes.json()) as {
        email?: string;
        email_verified?: string;
        name?: string;
        sub?: string;
      };

      const email = payload.email?.toLowerCase().trim();
      if (!email) {
        return res.status(400).json({ message: 'Google account has no email' });
      }

      let user = await users.findOne({ email });
      if (!user) {
        const doc = {
          name: payload.name || email.split('@')[0],
          email,
          passwordHash: null,
          googleSub: payload.sub || null,
          emailVerified: payload.email_verified === 'true',
          createdAt: new Date(),
        };
        const result = await users.insertOne(doc);
        user = { _id: result.insertedId, ...doc } as any;
      }

      if (!user) {
        return res.status(500).json({ message: 'User retrieval failed' });
      }

      const userId = (user as any)._id.toString();
      const userObj = user as any;
      const token = jwt.sign({ userId, email: userObj.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

      return res.json({
        user: {
          id: userId,
          email: user.email,
          name: user.name,
          phone: (user as any).phone,
          phoneVerified: (user as any).phoneVerified ?? false,
        },
        token,
      });
    } catch (err) {
      console.error('Google OAuth login error:', err);
      return res.status(500).json({ message: 'Server error. Please try again.' });
    }
  });

  app.post('/api/auth/oauth/apple', async (req, res) => {
    try {
      const { appleUserId, email, name } = req.body as {
        appleUserId?: string;
        email?: string;
        name?: string;
      };
      if (!appleUserId) {
        return res.status(400).json({ message: 'appleUserId is required' });
      }

      let user = null;
      if (email) {
        user = await users.findOne({ email: email.toLowerCase().trim() });
      }
      if (!user) {
        user = await users.findOne({ appleUserId });
      }

      if (!user) {
        const finalEmail = email?.toLowerCase().trim() || `${appleUserId}@apple.local`;
        const doc = {
          name: name || 'Apple User',
          email: finalEmail,
          passwordHash: null,
          appleUserId,
          emailVerified: !!email,
          createdAt: new Date(),
        };
        const result = await users.insertOne(doc);
        user = { _id: result.insertedId, ...doc } as any;
      }

      const userId = (user as any)._id.toString();
      const token = jwt.sign({ userId, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

      return res.json({
        user: {
          id: userId,
          email: user.email,
          name: user.name,
          phone: (user as any).phone,
          phoneVerified: (user as any).phoneVerified ?? false,
        },
        token,
      });
    } catch (err) {
      console.error('Apple OAuth login error:', err);
      return res.status(500).json({ message: 'Server error. Please try again.' });
    }
  });

  app.post('/api/push-token', authMiddleware, async (req, res) => {
    try {
      const { token, platform } = req.body as { token?: string; platform?: 'ios' | 'android' | 'web' };
      if (!token) {
        return res.status(400).json({ message: 'token is required' });
      }

      await pushTokens.updateOne(
        { userId: (req as any).userId, token },
        {
          $set: {
            userId: (req as any).userId,
            token,
            platform: platform || 'android',
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
      console.log("[Push] Token registered for user:", (req as any).userId, "Platform:", platform || 'android');
      return res.json({ ok: true });
    } catch (err) {
      console.error('Save push token error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
      const user = await users.findOne({ _id: toId((req as any).userId) });
      if (!user) return res.status(401).json({ message: 'User not found' });
      const uid = (user as { _id: string | { toString: () => string } })._id;
      return res.json({
        user: {
          id: typeof uid === 'string' ? uid : uid.toString(),
          email: user.email,
          name: user.name,
          phone: user.phone,
          phoneVerified: user.phoneVerified,
          avatarUrl: (user as any).avatarUrl || null,
          dateOfBirth: (user as any).dateOfBirth || null,
        },
      });
    } catch (err) {
      console.error('Me error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.put('/api/auth/me', authMiddleware, async (req, res) => {
    try {
      const { name, phone, avatarUrl, email, dateOfBirth } = req.body as {
        name?: string;
        phone?: string | null;
        avatarUrl?: string | null;
        email?: string;
        dateOfBirth?: string | null;
      };
      const update: any = {};
      if (name !== undefined) update.name = String(name).trim();
      if (phone !== undefined) update.phone = phone === null ? null : String(phone).trim();
      if (avatarUrl !== undefined) update.avatarUrl = avatarUrl === null ? null : String(avatarUrl);
      if (email !== undefined) {
        const emailNext = String(email).toLowerCase().trim();
        if (!emailNext) {
          return res.status(400).json({ message: 'Email cannot be empty' });
        }
        const duplicate = await users.findOne({ email: emailNext, _id: { $ne: toId((req as any).userId) } as any });
        if (duplicate) {
          return res.status(409).json({ message: 'An account with this email already exists' });
        }
        update.email = emailNext;
      }
      if (dateOfBirth !== undefined) {
        const dob = dateOfBirth === null ? null : String(dateOfBirth).trim();
        if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          return res.status(400).json({ message: 'Date of birth must be YYYY-MM-DD' });
        }
        update.dateOfBirth = dob;
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
      }

      await users.updateOne({ _id: toId((req as any).userId) }, { $set: update });
      const user = await users.findOne({ _id: toId((req as any).userId) });
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      const uid = (user as { _id: string | { toString: () => string } })._id;
      return res.json({
        user: {
          id: typeof uid === 'string' ? uid : uid.toString(),
          email: user.email,
          name: user.name,
          phone: user.phone,
          phoneVerified: user.phoneVerified,
          avatarUrl: (user as any).avatarUrl,
          dateOfBirth: (user as any).dateOfBirth || null,
        },
      });
    } catch (err) {
      console.error('Update me error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post(
    '/api/avatar',
    authMiddleware,
    upload.single('avatar'),
    async (req: any, res: any) => {
      try {
        if (!S3_BUCKET) {
          return res.status(500).json({ message: 'S3 bucket not configured. Set AWS_S3_BUCKET.' });
        }
        const file = (req as any).file;
        if (!file || !file.buffer) {
          return res.status(400).json({ message: 'avatar file is required' });
        }

        const key = `avatars/${(req as any).userId}/${Date.now()}-${file.originalname}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype || 'image/jpeg',
          } as any),
        );

        const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
        await users.updateOne({ _id: toId((req as any).userId) }, { $set: { avatarUrl: url } });
        return res.status(201).json({ url });
      } catch (err) {
        console.error('Upload avatar error:', err);
        return res.status(500).json({ message: 'Server error.' });
      }
    },
  );

  // ----- In-app notifications -----
  app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
      const list = await notifications
        .find({ userId: (req as any).userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      const out = list.map((n: any) => ({
        id: (n._id || '').toString(),
        type: n.type || 'reminder',
        title: n.title,
        body: n.body,
        read: !!n.read,
        createdAt: n.createdAt,
        meta: n.meta || {},
      }));
      return res.json(out);
    } catch (err) {
      console.error('Get notifications error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/notifications/mark-read', authMiddleware, async (req, res) => {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.json({ updated: 0 });
      }
      const objectIds = ids.map((id) => toId(id));
      const result = await notifications.updateMany(
        { _id: { $in: objectIds as any }, userId: (req as any).userId },
        { $set: { read: true } },
      );
      return res.json({ updated: result.modifiedCount || 0 });
    } catch (err) {
      console.error('Mark notifications read error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/notifications/mark-read-all', authMiddleware, async (req: any, res) => {
    try {
      const result = await notifications.updateMany(
        { userId: (req as any).userId, read: false },
        { $set: { read: true } },
      );
      return res.json({ updated: result.modifiedCount || 0 });
    } catch (err) {
      console.error('Mark all notifications read error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.delete('/api/notifications/:id', authMiddleware, async (req: any, res) => {
    try {
      const result = await notifications.deleteOne({
        _id: toId(req.params.id),
        userId: (req as any).userId,
      });
      if (result.deletedCount === 0) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('Delete notification error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // ----- Support tickets -----
  app.post('/api/support', authMiddleware, async (req, res) => {
    try {
      const { subject, message } = req.body as { subject?: string; message?: string };
      if (!subject || !message) {
        return res.status(400).json({ message: 'Subject and message are required' });
      }

      const doc = {
        userId: (req as any).userId,
        subject: String(subject).slice(0, 120),
        message: String(message).slice(0, 4000),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await supportTickets.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (err) {
      console.error('Create support ticket error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // ----- Transactions -----
  app.get('/api/transactions', authMiddleware, async (req, res) => {
    try {
      const list = await transactions.find({ userId: (req as any).userId }).sort({ date: -1 }).limit(500).toArray();
      const out = list.map((t: any) => ({
        id: t._id.toString(),
        merchant: t.merchant,
        amount: t.amount,
        category: t.category,
        date: t.date,
        upiId: t.upiId || '',
        isDebit: t.isDebit !== false,
        description: t.description || '',
      }));
      return res.json(out);
    } catch (err) {
      console.error('Get transactions error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/transactions', authMiddleware, async (req, res) => {
    try {
      const { merchant, amount, category, date, upiId, isDebit, description } = req.body;
      if (!merchant || amount == null) {
        return res.status(400).json({ message: 'merchant and amount are required' });
      }
      const doc = {
        userId: (req as any).userId,
        merchant: String(merchant),
        amount: Number(amount),
        category: (category as CategoryType) || 'others',
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        upiId: upiId || '',
        isDebit: isDebit !== false,
        description: description || '',
      };
      const result = await transactions.insertOne(doc);
      return res.status(201).json({
        id: result.insertedId.toString(),
        ...doc,
      });
    } catch (err) {
      console.error('Post transaction error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Sync transactions from SMS (app reads SMS, parses, sends here)
  app.post('/api/transactions/sync-from-sms', authMiddleware, async (req, res) => {
    try {
      const { transactions: txs } = req.body;
      if (!Array.isArray(txs) || txs.length === 0) {
        return res.json({ synced: 0, message: 'No transactions to sync' });
      }

      const userId = (req as any).userId;
      const ops = txs.map((t) => {
        const merchant = String(t.merchant || t.sender || 'Unknown');
        const amount = Number(t.amount) || 0;
        const date = t.date ? new Date(t.date).toISOString() : new Date().toISOString();
        const isDebit = t.isDebit !== false;
        const smsId = t.smsId ? String(t.smsId) : null;

        const doc = {
          userId,
          merchant,
          amount,
          date,
          isDebit,
          category: (t.category as CategoryType) || 'others',
          upiId: t.upiId || '',
          description: t.description || String(t.message || ''),
          smsId,
          updatedAt: new Date(),
        };

        // If smsId is provided, we use it for atomic upsert to prevent duplicates
        if (smsId) {
          return {
            updateOne: {
              filter: { userId, smsId },
              update: { $setOnInsert: doc },
              upsert: true,
            },
          };
        } else {
          // Fallback for manual or legacy sync without smsId
          return {
            insertOne: { document: doc },
          };
        }
      });

      const result = await (transactions as any).bulkWrite(ops, { ordered: false });
      
      const synced = (result.upsertedCount || 0) + (result.insertedCount || 0);
      const skipped = txs.length - synced;

      return res.json({ 
        synced, 
        skipped, 
        message: `${synced} synced, ${skipped} duplicates skipped` 
      });
    } catch (err) {
      console.error('Sync from SMS error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // ----- Bills -----
  app.get('/api/bills', authMiddleware, async (req, res) => {
    try {
      const list = await bills.find({ userId: (req as any).userId }).toArray();
      const out = list.map((b: any) => ({
        id: b._id.toString(),
        name: b.name,
        amount: b.amount,
        dueDate: b.dueDate,
        category: b.category || 'bills',
        isPaid: b.isPaid || false,
        icon: b.icon || 'flash',
        reminderType: (b.reminderType as ReminderType) || 'bill',
        repeatType: (b.repeatType as RepeatType) || 'monthly',
        status: (b.status as ReminderStatus) || 'active',
        snoozedUntil: b.snoozedUntil,
        reminderDaysBefore: b.reminderDaysBefore || [3, 1, 0],
        imageUrl: b.imageUrl,
        imageKey: b.imageKey,
        source: b.source,
      }));
      return res.json(out);
    } catch (err) {
      console.error('Get bills error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/bills', authMiddleware, async (req, res) => {
    try {
      const body = req.body;
      const doc = {
        userId: (req as any).userId,
        name: body.name || 'Bill',
        amount: Number(body.amount) || 0,
        dueDate: body.dueDate || new Date().toISOString(),
        category: (body.category as CategoryType) || 'bills',
        isPaid: !!body.isPaid,
        icon: body.icon || 'flash',
        reminderType: (body.reminderType as ReminderType) || 'bill',
        repeatType: (body.repeatType as RepeatType) || 'monthly',
        status: (body.status as ReminderStatus) || 'active',
        snoozedUntil: body.snoozedUntil,
        reminderDaysBefore: Array.isArray(body.reminderDaysBefore) ? body.reminderDaysBefore : [3, 1, 0],
      };
      const result = await bills.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (err) {
      console.error('Post bill error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Scan Bill Preview (image -> OCR -> validated fields, without creating a bill)
  app.post(
    '/api/bills/scan/preview',
    authMiddleware,
    upload.single('image'),
    async (req: any, res: any) => {
      try {
        if (!S3_BUCKET) {
          return res.status(500).json({ message: 'S3 bucket not configured. Set AWS_S3_BUCKET.' });
        }

        const file = (req as any).file;
        if (!file || !file.buffer) {
          return res.status(400).json({ message: 'image file is required' });
        }

        const key = `bills/${(req as any).userId}/${Date.now()}-${file.originalname}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype || 'image/jpeg',
          }),
        );

        // ============================
        // 🧠 REGION-CONTROL ARCHITECTURE (Phase 6)
        // ============================
        const openAIKey = getOpenAIKey();
        const ERROR_MESSAGE = "Unable to extract accurate bill details. Please upload a clearer or valid bill.";
        
        let finalResponse = {
          bill_amount: 0,
          due_date: "",
          status: "error",
          message: ERROR_MESSAGE
        };

        try {
          // Dynamic require for Sharp (handles installation delay)
          let sharp: any;
          try {
            sharp = require('sharp');
          } catch (e) {
            console.warn("Sharp not yet available, falling back to raw buffer.");
          }

          // ⚙️ STEP 1: IMAGE PREPROCESSING
          let processedBuffer = file.buffer;
          if (sharp) {
            try {
              processedBuffer = await sharp(file.buffer)
                .grayscale()
                .normalize()
                .sharpen()
                .toBuffer();
            } catch (e) {
              console.error("Sharp Preprocessing Failed:", e);
            }
          }

          // 📍 STEP 2: REGION CROPPING (Template-based)
          // Coords provided by user for DGVCL matching
          const regions = {
            dueDate: { left: 1000, top: 200, width: 600, height: 300 }, // Expanded for safety
            totalAmount: { left: 1000, top: 1300, width: 600, height: 400 }
          };

          let dueDateText = "";
          let amountText = "";

          if (sharp) {
            try {
              const dueBuffer = await sharp(processedBuffer).extract(regions.dueDate).toBuffer();
              const amtBuffer = await sharp(processedBuffer).extract(regions.totalAmount).toBuffer();
              
              const [dueRes, amtRes] = await Promise.all([
                textract.send(new AnalyzeDocumentCommand({ Document: { Bytes: dueBuffer }, FeatureTypes: ["FORMS"] })),
                textract.send(new AnalyzeDocumentCommand({ Document: { Bytes: amtBuffer }, FeatureTypes: ["FORMS"] }))
              ]);

              dueDateText = (dueRes.Blocks || []).filter(b => b.BlockType === "LINE").map(b => b.Text).join(" ");
              amountText = (amtRes.Blocks || []).filter(b => b.BlockType === "LINE").map(b => b.Text).join(" ");
            } catch (e) {
              console.error("Regional Cropping OCR Failed:", e);
            }
          }

          // 🔍 STEP 3: FIELD EXTRACTION (Regex + Rules)
          const extractDueDate = (text: string) => {
            const match = text.match(/\d{2}-\d{2}-\d{4}/);
            return match ? match[0] : null;
          };

          const extractAmount = (text: string) => {
            const lines = text.split("\n");
            for (let line of lines) {
              if (line.toLowerCase().includes("total")) {
                const match = line.match(/\d+\.\d{2}/);
                if (match) return parseFloat(match[0]);
              }
            }
            const numbers = text.match(/\d+\.\d{2}/g);
            return numbers ? Math.max(...numbers.map(Number)) : null;
          };

          const regDueDate = extractDueDate(dueDateText);
          const regAmount = extractAmount(amountText);

          // 🧪 STEP 4: VALIDATION LAYER
          const isValidAmount = (amt: number | null) => amt && amt > 100 && amt < 20000;
          const isValidDate = (d: string | null) => d && /^\d{2}-\d{2}-\d{4}$/.test(d);

          if (isValidAmount(regAmount) && isValidDate(regDueDate)) {
            // SUCCESS: Regional Control worked
            const [d, m, y] = regDueDate!.split('-');
            const isoDueDate = new Date(`${y}-${m}-${d}`).toISOString();

            const preview = {
              name: 'Utility Bill (Verified)',
              amount: regAmount!,
              dueDate: isoDueDate,
              category: 'bills' as CategoryType,
              icon: 'receipt',
              source: 'scan_bill',
              imageKey: key,
              imageUrl: `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`,
            };

            return res.json({ 
              preview, 
              metadata: { 
                bill_amount: regAmount, 
                due_date: regDueDate, 
                confidence: 99, 
                status: "success",
                method: "region-control"
              } 
            });
          }

          // 🔁 STEP 5: FALLBACK (Phase 5 LLM Strategy)
          console.log("Region-Control failed or low confidence, falling back to LLM...");
          
          if (openAIKey) {
            const base64Image = file.buffer.toString('base64');
            const prompt = `
              - Identify CURRENT Total Bill Amount (Ignore Arrears/Advance).
              - Identify Due Date (DD-MM-YYYY).
              - Final JSON: {"bill_amount": number, "due_date": "DD-MM-YYYY", "status": "success", "confidence": number, "vendor": "string"}
              - If not 100% sure, return status: "error"
            `;

            const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${openAIKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: `data:${file.mimetype || 'image/jpeg'};base64,${base64Image}` } }
                ]}],
                temperature: 0,
                response_format: { type: "json_object" },
              }),
            });

            const aiJson = await aiRes.json();
            const p = JSON.parse(aiJson.choices?.[0]?.message?.content || "{}");

            if (p.status === "success" && isValidAmount(p.bill_amount) && isValidDate(p.due_date)) {
              const [d, m, y] = p.due_date.split('-');
              const isoDueDate = new Date(`${y}-${m}-${d}`).toISOString();

              const preview = {
                name: p.vendor || 'Scanned Bill',
                amount: p.bill_amount,
                dueDate: isoDueDate,
                category: 'bills' as CategoryType,
                icon: 'receipt',
                source: 'scan_bill',
                imageKey: key,
                imageUrl: `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`,
              };

              return res.json({ 
                preview, 
                metadata: { 
                  bill_amount: p.bill_amount, 
                  due_date: p.due_date, 
                  confidence: p.confidence || 90, 
                  status: "success",
                  method: "llm-fallback"
                } 
              });
            }
          }

          // FINAL FALLBACK: Explicit Failure
          return res.status(422).json({
            message: ERROR_MESSAGE,
            status: "error"
          });

        } catch (err) {
          console.error('Phase 6 Architecture Failure:', err);
          return res.status(500).json({ message: ERROR_MESSAGE });
        }
      } catch (err) {
        console.error('Scan bill preview error:', err);
        return res.status(500).json({ message: 'Server error.' });
      }
    },
  );

  // Scan Bill Commit (create a bill reminder from validated preview)
  app.post('/api/bills/scan/commit', authMiddleware, async (req: any, res: any) => {
    try {
      const preview = req.body?.preview;
      if (!preview) return res.status(400).json({ message: 'preview is required' });

      const amount = Number(preview.amount) || 0;
      if (amount <= 0) return res.status(422).json({ message: 'Invalid amount detected.' });

      const due = new Date(preview.dueDate);
      if (Number.isNaN(due.getTime())) return res.status(422).json({ message: 'Invalid due date detected.' });

      const reminderDaysBefore = Array.isArray(preview.reminderDaysBefore) ? preview.reminderDaysBefore : [3, 1, 0];

      const doc = {
        userId: (req as any).userId,
        name: String(preview.name || 'Bill').slice(0, 80),
        amount,
        dueDate: due.toISOString(),
        category: (preview.category as CategoryType) || 'bills',
        isPaid: false,
        icon: preview.icon || 'receipt',
        reminderType: (preview.reminderType as ReminderType) || 'bill',
        repeatType: (preview.repeatType as RepeatType) || 'monthly',
        status: (preview.status as ReminderStatus) || 'active',
        snoozedUntil: preview.snoozedUntil,
        reminderDaysBefore,
        source: preview.source || 'scan_bill',
        imageKey: preview.imageKey,
        imageUrl: preview.imageUrl,
        // New details
        vendorName: preview.vendorName,
        billDate: preview.billDate,
        billNumber: preview.billNumber,
        accountNumber: preview.accountNumber,
        lateFee: preview.lateFee,
        taxAmount: preview.taxAmount,
        phoneNumber: preview.phoneNumber,
        createdAt: new Date(),
      };

      const result = await bills.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (err) {
      console.error('Scan bill commit error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.put('/api/bills/:id', authMiddleware, async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body;
      const update: any = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.amount !== undefined) update.amount = Number(body.amount);
      if (body.dueDate !== undefined) update.dueDate = body.dueDate;
      if (body.category !== undefined) update.category = body.category;
      if (body.isPaid !== undefined) update.isPaid = body.isPaid;
      if (body.icon !== undefined) update.icon = body.icon;
      if (body.reminderType !== undefined) update.reminderType = body.reminderType;
      if (body.repeatType !== undefined) update.repeatType = body.repeatType;
      if (body.status !== undefined) update.status = body.status;
      if (body.snoozedUntil !== undefined) update.snoozedUntil = body.snoozedUntil;
      if (body.reminderDaysBefore !== undefined) update.reminderDaysBefore = body.reminderDaysBefore;
      const result = await bills.updateOne({ _id: toId(id), userId: (req as any).userId }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ message: 'Bill not found' });

      // Log history if status changed
      if (update.status || update.isPaid !== undefined) {
        const db = getDb();
        if (db) {
          await db.collection('billHistory').insertOne({
            billId: toId(id),
            userId: (req as any).userId,
            date: new Date().toISOString(),
            action: update.isPaid ? 'paid' : (update.status || 'updated'),
            amount: update.amount,
            note: update.isPaid ? 'Marked as paid' : 'Information updated'
          });
        }
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('Put bill error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.delete('/api/bills/:id', authMiddleware, async (req: any, res) => {
    try {
      const result = await bills.deleteOne({ _id: toId(req.params.id), userId: (req as any).userId });
      if (result.deletedCount === 0) return res.status(404).json({ message: 'Bill not found' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Delete bill error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/bills/:id/actions', authMiddleware, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { action, days } = req.body as { action: 'snooze' | 'cancel' | 'uncancel'; days?: number };
      const userId = (req as any).userId;

      if (action === 'snooze') {
        const snoozeMinutes = Number(req.body.minutes);
        const snoozedUntil = new Date();
        
        if (snoozeMinutes > 0) {
          snoozedUntil.setMinutes(snoozedUntil.getMinutes() + snoozeMinutes);
        } else {
          const snoozeDays = Number(days) || 1;
          snoozedUntil.setDate(snoozedUntil.getDate() + snoozeDays);
        }
        
        const result = await bills.updateOne(
          { _id: toId(id), userId },
          { $set: { status: 'snoozed', snoozedUntil: snoozedUntil.toISOString(), isPaid: false } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: 'Bill not found' });

        // Log history
        const db = getDb();
        if (db) {
          await db.collection('billHistory').insertOne({
            billId: toId(id),
            userId,
            date: new Date().toISOString(),
            action: 'snoozed',
            note: `Snoozed until ${snoozedUntil.toLocaleDateString()}`
          });
        }

        return res.json({ ok: true, snoozedUntil: snoozedUntil.toISOString() });
      }

      if (action === 'cancel') {
        const result = await bills.updateOne(
          { _id: toId(id), userId },
          { $set: { status: 'cancelled', isPaid: false } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: 'Bill not found' });

        // Log history
        const db = getDb();
        if (db) {
          await db.collection('billHistory').insertOne({
            billId: toId(id),
            userId,
            date: new Date().toISOString(),
            action: 'cancelled',
            note: 'Reminder cancelled'
          });
        }

        return res.json({ ok: true });
      }

      if (action === 'uncancel') {
        const result = await bills.updateOne(
          { _id: toId(id), userId },
          { $set: { status: 'active', isPaid: false } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: 'Bill not found' });

        // Log history
        const db = getDb();
        if (db) {
          await db.collection('billHistory').insertOne({
            billId: toId(id),
            userId,
            date: new Date().toISOString(),
            action: 'restored',
            note: 'Reminder restored'
          });
        }

        return res.json({ ok: true });
      }

      return res.status(400).json({ message: 'Invalid action' });
    } catch (err) {
      console.error('Bill action error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.get('/api/bills/:id/history', authMiddleware, async (req: any, res) => {
    try {
      const db = getDb();
      if (!db) return res.status(500).json({ message: 'DB not available' });
      const history = await db.collection('billHistory')
        .find({ billId: toId(req.params.id), userId: (req as any).userId })
        .sort({ date: -1 })
        .toArray();
      return res.json(history);
    } catch (err) {
      console.error('Get bill history error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Quick Add reminder from free text
  app.post('/api/reminders/quick-add', authMiddleware, async (req, res) => {
    try {
      const { text } = req.body as { text: string };
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ message: 'text is required' });
      }

      const parsed = await parseReminderWithAI(text);
      const due = new Date(`${parsed.isoDate}T00:00:00.000Z`);
      if (Number.isNaN(due.getTime())) {
        return res.status(400).json({ message: 'Could not parse reminder date' });
      }
      due.setHours(parsed.hour, parsed.minute, 0, 0);

      const doc = {
        userId: (req as any).userId,
        name: parsed.title.slice(0, 80),
        amount: 0,
        dueDate: due.toISOString(),
        category: 'bills' as CategoryType,
        isPaid: false,
        icon: 'flash',
        reminderType: parsed.reminderType,
        repeatType: parsed.repeatType,
        status: 'active' as ReminderStatus,
        snoozedUntil: undefined,
        reminderDaysBefore: [0],
        source: 'quick_add',
        createdAt: new Date(),
      };

      const result = await bills.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (err) {
      console.error('Quick add reminder error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Parse reminder text (no save) - used for voice confirm/edit flows
  app.post('/api/reminders/parse', authMiddleware, async (req, res) => {
    try {
      const { text } = req.body as { text?: string };
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ message: 'text is required' });
      }
      const parsed = await parseReminderWithAI(text);
      return res.json(parsed);
    } catch (err) {
      console.error('Parse reminder error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Voice reminder: upload audio -> transcribe -> parse (no save)
  app.post(
    '/api/reminders/voice/parse',
    authMiddleware,
    upload.single('audio'),
    async (req: any, res: any) => {
      try {
        const openAIKey = getOpenAIKey();
        if (!openAIKey) {
          return res.status(500).json({ message: 'Voice is not configured. Set OPENAI_API_KEY.' });
        }
  
        const file = (req as any).file;
        if (!file || !file.buffer) {
          return res.status(400).json({ message: 'audio file is required' });
        }
  
        const MODEL = OPENAI_TRANSCRIBE_MODEL;
        const PROMPT = [
          'The speaker may use English, Hindi, or Gujarati.',
          'CRITICAL RULES:',
          '- Support mixed languages (Hinglish/Gujlish).',
          '- Detect the spoken language accurately.',
          '- If Gujarati is spoken, output in Gujarati script.',
          '- If Hindi is spoken, output in Devanagari script.',
          '- If English is spoken, use Latin script.',
          '- Preserve original spoken words exactly without translation.'
        ].join(' ');

        // Manual Multipart Construction for Node.js (OpenAI requirement)
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const parts: any[] = [];
        
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.originalname || 'voice.m4a'}"\r\nContent-Type: ${file.mimetype || 'audio/m4a'}\r\n\r\n`));
        parts.push(file.buffer);
        parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${MODEL}\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${PROMPT}\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`));
        parts.push(Buffer.from(`--${boundary}--\r\n`));
        
        const body = Buffer.concat(parts);
  
        const tRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${openAIKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body: body as any,
        });
  
        if (!tRes.ok) {
          const errText = await tRes.text();
          console.error('[Voice] Transcription failed:', tRes.status, errText);
          return res.status(500).json({ message: 'Transcription failed.' });
        }
  
        const tJson = (await tRes.json()) as { text?: string; language?: string | null };
        let transcript = String(tJson.text || '').trim();
        console.log('[Voice] Raw transcript:', transcript, 'Detected Lang:', tJson.language);
        
        if (!transcript) {
          return res.status(400).json({ message: 'Could not transcribe any speech. Please try again.' });
        }
  
        // Step 1: cheap script-based language detection, only falling back to AI when ambiguous
        // (handles the Gujarati-spoken-but-Hindi-transcribed case explicitly).
        const { text: normalizedText, language: detectedLang } = await normalizeTranscriptScript({
          text: transcript,
          languageHint: tJson.language || null,
          apiKey: openAIKey,
        });

        // Step 2: extract structured reminder fields from the already-normalized text.
        const parsed = await normalizeAndParseVoiceReminderWithAI(normalizedText, detectedLang);

        return res.json({
          text: parsed.normalizedText,
          language: parsed.detectedLanguage,
          parsed: parsed.data
        });
      } catch (err) {
        console.error('[Voice] E2E Voice Parse error:', err);
        return res.status(500).json({ message: 'Server error processing voice reminder.' });
      }
    }
  );

  async function normalizeAndParseVoiceReminderWithAI(text: string, languageHint: string | null): Promise<{
    normalizedText: string;
    detectedLanguage: string;
    data: any;
  }> {
    const openAIKey = getOpenAIKey();
    if (!openAIKey) {
      const basic = await parseReminderWithAI(text);
      return { normalizedText: text, detectedLanguage: languageHint || 'en', data: basic };
    }

    const now = new Date();
    const defaultIso = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

    const prompt = `You are an expert multilingual assistant.
The user provides a transcript (already script-normalized) in English, Hindi, or Gujarati (or mixed).
Task: Extract reminder data in strict JSON. Do NOT change the script or language of the text — return "normalizedText" exactly as given, only fixing obvious transcription typos.

Rules for Extraction:
- title: concise summary. **ABSOLUTE RULE**: The 'title' MUST NOT contain ANY digits, numbers, or currency words (like rupees, rupaiya, rs, ₹, $, રૂપિયા, रुपये). Strictly remove them.
- isoDate: YYYY-MM-DD. If no date, use ${defaultIso}.
- hour: 0-23. If no time, use 9.
- minute: 0-59. If no time, use 0.
- repeatType: one of [none, daily, weekly, monthly, yearly].
- reminderType: one of [bill, subscription, custom]. 
- amount: numerical value if mentioned (e.g. 500). Extract from any script (Gujarati, Hindi, English). If no amount, return null.

*Heuristic*: If an amount is detected, prefer reminderType 'bill'. Ensure the 'title' is pure text describing the purpose only, with zero price info.

Return ONLY strict JSON:
{
  "normalizedText": "...",
  "data": {
    "title": "...",
    "isoDate": "...",
    "hour": 0,
    "minute": 0,
    "repeatType": "...",
    "reminderType": "...",
    "amount": 500 | null
  }
}

Input Text: "${text}"
Detected Language (already confirmed, do not override): ${languageHint || 'unknown'}

JSON Output:`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAIKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' }
        })
      });
      const json = await res.json();
      const content = JSON.parse(json.choices[0].message.content);
      return {
        normalizedText: content.normalizedText || text,
        detectedLanguage: languageHint || 'en',
        data: content.data
      };
    } catch (e) {
      const fallback = await parseReminderWithAI(text);
      return { normalizedText: text, detectedLanguage: languageHint || 'en', data: fallback };
    }
  }
  
  
  // ============================
  // 🔥 CONVERT HINDI → GUJARATI
  // ============================
  
  async function convertToGujarati(text: string, apiKey: string) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'Convert the given text into Gujarati script only. Do NOT translate meaning. Keep words same, only change script.'
            },
            {
              role: 'user',
              content: text
            }
          ],
        }),
      });
  
      const json = await response.json();
  
      return json?.choices?.[0]?.message?.content?.trim() || text;
  
    } catch (err) {
      console.error('Gujarati conversion error:', err);
      return text; // fallback safe
    }
  }

  type DetectedLang = 'gu' | 'hi' | 'en' | 'mixed' | 'unknown';

  function hasDevanagari(txt: string) {
    return /[\u0900-\u097F]/.test(txt);
  }

  function hasGujaratiScript(txt: string) {
    return /[\u0A80-\u0AFF]/.test(txt);
  }

  function hasLatinScript(txt: string) {
    return /[A-Za-z]/.test(txt);
  }

  async function detectLanguageWithAI(text: string, apiKey: string): Promise<DetectedLang> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Classify the dominant language of the user text. Return JSON only with key "language". Allowed values: gu, hi, en, mixed, unknown.',
            },
            { role: 'user', content: text },
          ],
        }),
      });

      if (!response.ok) return 'unknown';
      const json = await response.json();
      const raw = json?.choices?.[0]?.message?.content;
      if (!raw) return 'unknown';
      const parsed = JSON.parse(raw);
      const val = String(parsed?.language || '').toLowerCase();
      if (val === 'gu' || val === 'hi' || val === 'en' || val === 'mixed' || val === 'unknown') {
        return val;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function normalizeHintLanguage(hint: string | null | undefined): DetectedLang {
    const h = String(hint || '').toLowerCase();
    if (h.startsWith('gu')) return 'gu';
    if (h.startsWith('hi')) return 'hi';
    if (h.startsWith('en')) return 'en';
    return 'unknown';
  }

  async function normalizeTranscriptScript({
    text,
    languageHint,
    apiKey,
  }: {
    text: string;
    languageHint: string | null;
    apiKey: string;
  }): Promise<{ text: string; language: string | null }> {
    let finalText = text.trim();
    if (!finalText) return { text: '', language: null };

    const hintLang = normalizeHintLanguage(languageHint);
    const hasHiScript = hasDevanagari(finalText);
    const hasGuScript = hasGujaratiScript(finalText);
    const hasEnScript = hasLatinScript(finalText);

    let detected: DetectedLang = hintLang;

    // Fast script-based detection first.
    if (hasGuScript && !hasHiScript && !hasEnScript) detected = 'gu';
    else if (hasHiScript && !hasGuScript && !hasEnScript && detected === 'unknown') detected = 'hi';
    else if (hasEnScript && !hasGuScript && !hasHiScript && detected === 'unknown') detected = 'en';

    // Devanagari can still be Gujarati speech rendered in Hindi script; confirm via AI.
    if (hasHiScript && !hasGuScript && (detected === 'unknown' || detected === 'hi')) {
      const aiDetected = await detectLanguageWithAI(finalText, apiKey);
      if (aiDetected !== 'unknown') detected = aiDetected;
    }

    if (hasHiScript && !hasGuScript && detected === 'gu') {
      finalText = await convertToGujarati(finalText, apiKey);
      if (hasGujaratiScript(finalText)) detected = 'gu';
    }

    return {
      text: finalText,
      language: detected === 'unknown' ? (languageHint || null) : detected,
    };
  }

  // ----- Leaks (computed from transactions) -----
  const LEAK_SUGGESTIONS: Record<string, string> = {
    Swiggy: 'Cook at home 3x a week to save more',
    Zomato: 'Limit food delivery to weekends only',
    Starbucks: 'Try brewing coffee at home',
    'Chai Point': 'Make chai at home and carry a flask',
    Uber: 'Use public transport for short distances',
    Ola: 'Consider carpooling or metro for daily commute',
    Netflix: 'Share with family to split costs',
    Spotify: 'Use the free tier or student discount',
    BookMyShow: 'Look for early bird or weekday discounts',
    Amazon: 'Use a wishlist and wait for sales',
  };

  app.get('/api/leaks', authMiddleware, async (req: any, res) => {
    try {
      const userId = (req as any).userId;
      const [txList, billList] = await Promise.all([
        transactions.find({ 
          userId, 
          isDebit: true,
          category: { $nin: ['investment', 'tax', 'rent', 'savings'] } 
        }).sort({ date: -1 }).toArray(),
        bills.find({ userId }).toArray()
      ]);

      const merchantFreq: Record<string, { count: number; total: number; category: CategoryType; amounts: number[]; lastDate: Date }> = {};
      txList.forEach((t: any) => {
        const merchant = String(t.merchant || 'Unknown');
        if (!merchantFreq[merchant]) {
          merchantFreq[merchant] = { 
            count: 0, 
            total: 0, 
            category: (t.category as CategoryType) || 'others',
            amounts: [],
            lastDate: new Date(t.date)
          };
        }
        merchantFreq[merchant].count++;
        merchantFreq[merchant].total += t.amount;
        merchantFreq[merchant].amounts.push(t.amount);
      });

      const leaks: any[] = [];
      const now = new Date();

      // 1. Transaction Frequency & Price Hikes
      Object.entries(merchantFreq).forEach(([merchant, data]) => {
        // Frequency Leak
        if (data.count >= 3) {
          const freq = data.count >= 15 ? 'Daily' : data.count >= 8 ? 'Frequently' : 'Weekly';
          const monthlyEstimate = Math.round(data.total / (data.count > 30 ? 1 : 1)); // Simplified for now
          
          let suggestion = LEAK_SUGGESTIONS[merchant] || 'Review if this expense is necessary';
          
          // Price Hike Detection (compare latest two tx)
          if (data.amounts.length >= 2) {
            const latest = data.amounts[0]; 
            const previous = data.amounts[1];
            // Since we sorted txList by date DESC (line 1687), 
            // the loop (1692) pushes them into 'amounts' in DESC order.
            // So index 0 is newest, index 1 is next newest.
            if (latest > previous * 1.15) { // 15% increase
              suggestion = `⚠️ Price hike detected! ${merchant} cost increased from ${previous} to ${latest}. ${suggestion}`;
            }
          }

          leaks.push({
            id: new ObjectId().toString(),
            merchant,
            category: data.category,
            frequency: freq,
            monthlyEstimate,
            yearlyPrediction: monthlyEstimate * 12,
            transactionCount: data.count,
            suggestion,
          });
        }
      });

      // 2. "Ghost" or "Inactive" Subscriptions
      // If we have a bill reminder but no transaction in 45 days
      billList.forEach((bill: any) => {
        if (bill.reminderType === 'subscription' && bill.status !== 'cancelled') {
          const merchantLower = bill.name.toLowerCase();
          const txMatch = txList.find((t: any) => 
            t.merchant.toLowerCase().includes(merchantLower) ||
            merchantLower.includes(t.merchant.toLowerCase())
          );
          
          if (txMatch) {
            const lastTxDate = new Date(txMatch.date);
            const daysSinceLastPay = (now.getTime() - lastTxDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceLastPay > 45) {
              leaks.push({
                id: new ObjectId().toString(),
                merchant: bill.name,
                category: bill.category,
                frequency: 'Inactive',
                monthlyEstimate: bill.amount,
                yearlyPrediction: bill.amount * 12,
                transactionCount: 0,
                suggestion: `You're paying for ${bill.name} but haven't used it for 45+ days. Consider cancelling.`,
              });
            }
          }
        }
      });

      // 3. Duplicate / Double Charge Detection
      Object.entries(merchantFreq).forEach(([merchant, data]) => {
        if (data.amounts.length >= 2) {
          // Check for identical amounts on the same day or within 24 hours
          for (let i = 0; i < txList.length - 1; i++) {
            const t1 = txList[i];
            const t2 = txList[i+1];
            if (t1.merchant === merchant && t2.merchant === merchant && t1.amount === t2.amount) {
              const d1 = new Date(t1.date);
              const d2 = new Date(t2.date);
              const diffHr = Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60);
              if (diffHr < 24) {
                leaks.push({
                  id: new ObjectId().toString(),
                  merchant: `${merchant} (Double Charge?)`,
                  category: t1.category,
                  frequency: 'Critical',
                  monthlyEstimate: t1.amount,
                  yearlyPrediction: t1.amount,
                  transactionCount: 2,
                  suggestion: `⚠️ Potential double charge detected on ${new Date(t1.date).toLocaleDateString()}. Two identical payments made within 24 hours.`,
                });
                break; // Only report once per merchant
              }
            }
          }
        }
      });

      leaks.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
      return res.json(leaks);
    } catch (err) {
      console.error('Get leaks error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // User settings (budget, reminder settings) - optional storage in users or separate collection
  app.get('/api/settings', authMiddleware, async (req, res) => {
    try {
      const user = await users.findOne({ _id: toId((req as any).userId) });
      const settings =
        (user as { settings?: unknown })?.settings || {
          monthlyBudget: 100000,
          reminderSettings: {
            defaultReminderDays: [3, 1, 0],
            soundEnabled: true,
            vibrationEnabled: true,
          },
        };
      return res.json(settings);
    } catch (err) {
      console.error('Get settings error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });
  app.put('/api/settings', authMiddleware, async (req, res) => {
    try {
      const { monthlyBudget, reminderSettings } = req.body;
      const update: any = {};
      if (monthlyBudget != null) update['settings.monthlyBudget'] = Number(monthlyBudget);
      if (reminderSettings) update['settings.reminderSettings'] = reminderSettings;
      await users.updateOne({ _id: toId((req as any).userId) }, { $set: update });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Put settings error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // ----- AI Assistant (Assistants API: Conversly asst_WmTjqjLyo3ki1MFHtqDtal6R, or fallback chat completions) -----
  app.post('/api/assistant/chat', authMiddleware, async (req, res) => {
    try {
      const openAIKey = getOpenAIKey();
      if (!openAIKey) {
        return res.status(500).json({ message: 'Assistant is not configured. Set OPENAI_API_KEY.' });
      }

      const body = req.body as {
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
      };
      const userMessages = Array.isArray(body.messages) ? body.messages : [];

      const [userDoc, recentTx, recentBills, familyMembers] = await Promise.all([
        users.findOne({ _id: toId((req as any).userId) }),
        transactions.find({ userId: (req as any).userId }).sort({ date: -1 }).limit(50).toArray(),
        bills.find({ userId: (req as any).userId }).limit(20).toArray(),
        family.find({ userId: (req as any).userId }).limit(10).toArray(),
      ]);

      const leakList = await transactions
        .find({ userId: (req as any).userId, isDebit: true })
        .toArray();

      const merchantFreq: Record<string, { count: number; total: number; category: CategoryType }> = {};
      leakList.forEach((t: any) => {
        const merchant = String(t.merchant || 'Unknown');
        if (!merchantFreq[merchant]) {
          merchantFreq[merchant] = {
            count: 0,
            total: 0,
            category: (t.category as CategoryType) || 'others',
          };
        }
        merchantFreq[merchant].count++;
        merchantFreq[merchant].total += t.amount;
      });
      const leaksSnapshot = Object.entries(merchantFreq)
        .filter(([, data]) => data.count >= 3)
        .map(([merchant, data]) => ({
          merchant,
          monthlyEstimate: data.total,
          transactionCount: data.count,
          category: data.category,
        }));

      const snapshot = {
        user: {
          id: (req as any).userId,
          name: (userDoc as any)?.name || undefined,
          email: (userDoc as any)?.email || undefined,
        },
        transactions: recentTx.map((t: any) => ({
          amount: t.amount,
          category: t.category,
          merchant: t.merchant,
          date: t.date,
          isDebit: t.isDebit !== false,
        })),
        bills: recentBills.map((b: any) => ({
          name: b.name,
          amount: b.amount,
          dueDate: b.dueDate,
          status: b.status || 'active',
          reminderType: b.reminderType || 'bill',
        })),
        leaks: leaksSnapshot,
        family: familyMembers.map((m: any) => ({
          name: m.name,
          relationship: m.relationship,
          medicinesCount: Array.isArray(m.medicines) ? m.medicines.length : 0,
        })),
      };

      const authHeader = {
        Authorization: `Bearer ${openAIKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      };
      const baseUrl = 'https://api.openai.com/v1';

      if (OPENAI_ASSISTANT_ID) {
        // Use OpenAI Assistants API (Conversly assistant)
        const createThreadRes = await fetch(`${baseUrl}/threads`, {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({}),
        });
        if (!createThreadRes.ok) {
          const errText = await createThreadRes.text();
          console.error('OpenAI threads error:', errText);
          return res.status(500).json({ message: 'Assistant error. Please try again later.' });
        }
        const { id: threadId } = (await createThreadRes.json()) as { id: string };

        const contextContent =
          'LifeWise user data context (use for personalised advice): ' + JSON.stringify(snapshot);
        const addCtxRes = await fetch(`${baseUrl}/threads/${threadId}/messages`, {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({ role: 'user', content: contextContent }),
        });
        if (!addCtxRes.ok) {
          const errText = await addCtxRes.text();
          console.error('OpenAI add message error:', errText);
          return res.status(500).json({ message: 'Assistant error. Please try again later.' });
        }
        for (const m of userMessages.filter((m) => m.role === 'user' || m.role === 'assistant')) {
          const addRes = await fetch(`${baseUrl}/threads/${threadId}/messages`, {
            method: 'POST',
            headers: authHeader,
            body: JSON.stringify({ role: m.role, content: m.content }),
          });
          if (!addRes.ok) {
            const errText = await addRes.text();
            console.error('OpenAI add message error:', errText);
            return res.status(500).json({ message: 'Assistant error. Please try again later.' });
          }
        }

        const runRes = await fetch(`${baseUrl}/threads/${threadId}/runs`, {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID }),
        });
        if (!runRes.ok) {
          const errText = await runRes.text();
          console.error('OpenAI create run error:', errText);
          return res.status(500).json({ message: 'Assistant error. Please try again later.' });
        }
        const { id: runId } = (await runRes.json()) as { id: string };

        const pollUntil = Date.now() + 60_000;
        let status: string = 'queued';
        while (Date.now() < pollUntil) {
          const runStatusRes = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, {
            headers: { Authorization: `Bearer ${openAIKey}`, 'OpenAI-Beta': 'assistants=v2' },
          });
          if (!runStatusRes.ok) break;
          const runStatus = (await runStatusRes.json()) as { status: string };
          status = runStatus.status;
          if (status === 'completed') break;
          if (status === 'failed' || status === 'cancelled' || status === 'expired') {
            console.error('OpenAI run status:', status);
            return res.status(500).json({ message: 'Assistant error. Please try again later.' });
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (status !== 'completed') {
          return res.status(500).json({ message: 'Assistant is taking too long. Please try again.' });
        }

        const listMsgRes = await fetch(`${baseUrl}/threads/${threadId}/messages`, {
          headers: { Authorization: `Bearer ${openAIKey}`, 'OpenAI-Beta': 'assistants=v2' },
        });
        if (!listMsgRes.ok) {
          const errText = await listMsgRes.text();
          console.error('OpenAI list messages error:', errText);
          return res.status(500).json({ message: 'Assistant error. Please try again later.' });
        }
        const listData = (await listMsgRes.json()) as {
          data?: Array<{ role: string; content?: Array<{ type: string; text?: { value?: string } }> }>;
        };
        const data = listData.data || [];
        const lastAssistant = data.find((m) => m.role === 'assistant');
        const reply =
          lastAssistant?.content?.find((c) => c.type === 'text')?.text?.value ||
          'Sorry, I could not generate a response right now.';
        return res.json({ reply });
      }

      // Fallback: chat completions (no assistant ID)
      const systemPrompt =
        'You are LifeWise, a financial and life assistant for Indian users. ' +
        'You MUST base advice on the provided JSON snapshot of the user data. ' +
        'Explain in simple, friendly language (you can mix light Hinglish but keep it clear). ' +
        'Never invent transactions or bills. Be concise and practical.';
      const messagesForModel = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `User data snapshot (JSON): ${JSON.stringify(snapshot)}` },
        ...userMessages.filter((m) => m.role === 'user' || m.role === 'assistant'),
      ];
      const openAiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: messagesForModel,
          temperature: 0.4,
        }),
      });
      if (!openAiRes.ok) {
        const errText = await openAiRes.text();
        console.error('OpenAI error:', errText);
        return res.status(500).json({ message: 'Assistant error. Please try again later.' });
      }
      const json = await openAiRes.json();
      const reply =
        json.choices?.[0]?.message?.content ||
        'Sorry, I could not generate a response right now.';
      return res.json({ reply });
    } catch (err) {
      console.error('Assistant chat error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // ----- Family Hub (members + medicines) -----
  app.post('/api/family/:id/medicines', authMiddleware, async (req, res) => {
    try {
      const memberId = req.params.id;
      const {
        name,
        dosage,
        appearance,
        color,
        instruction,
        slots,
        scheduleType,
        startDate,
        endDate,
        caregiverName,
        caregiverContact,
      } = req.body as {
        name?: string;
        dosage?: string;
        appearance?: string;
        color?: string;
        instruction?: string;
        slots?: { morning?: string; noon?: string; evening?: string };
        scheduleType?: 'continuous' | 'custom';
        startDate?: string;
        endDate?: string | null;
        caregiverName?: string;
        caregiverContact?: string;
      };

      if (!name) {
        return res.status(400).json({ message: 'Medicine name is required' });
      }

      const medId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const safeSlots = slots && typeof slots === 'object' ? slots : {};
      const todayIso = new Date().toISOString().slice(0, 10);

      const med = {
        id: medId,
        name: String(name).trim(),
        dosage: dosage ? String(dosage).trim() : '',
        appearance: (appearance as string) || 'tablet',
        color: color ? String(color) : '#10B981',
        instruction: (instruction as string) || 'any',
        slots: {
          morning: safeSlots.morning || null,
          noon: safeSlots.noon || null,
          evening: safeSlots.evening || null,
        },
        scheduleType: scheduleType === 'custom' ? 'custom' as const : 'continuous' as const,
        startDate: startDate || todayIso,
        endDate: scheduleType === 'custom' && endDate ? endDate : null,
        caregiverName: caregiverName ? String(caregiverName).trim() : null,
        caregiverContact: caregiverContact ? String(caregiverContact).trim() : null,
        // Tracking fields for adherence / streaks
        totalReminders: 0,
        takenReminders: 0,
        missedReminders: 0,
        adherenceScore: 0,
        streak: 0,
        lastTakenAt: null,
        lastStatus: 'pending',
        createdAt: new Date(),
      };

      const result = await family.updateOne(
        { _id: toId(memberId), userId: (req as any).userId },
        { $push: { medicines: med } } as any,
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'Family member not found' });
      }
      const updated = (await family.findOne({ _id: toId(memberId), userId: (req as any).userId })) as any;
      if (!updated) {
        return res.status(500).json({ message: 'Failed to load updated member' });
      }
      return res.status(201).json({
        id: updated._id.toString(),
        name: updated.name,
        relationship: updated.relationship,
        medicines: updated.medicines || [],
      });
    } catch (err) {
      console.error('Post family medicine error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.patch('/api/family/:memberId/medicines/:medId', authMiddleware, async (req, res) => {
    try {
      const { memberId, medId } = req.params;
      const { action } = req.body as { action: 'taken' | 'snooze' | 'skip' };
      const member = await family.findOne({ _id: toId(memberId), userId: (req as any).userId });
      if (!member) {
        return res.status(404).json({ message: 'Family member not found' });
      }
      const meds = Array.isArray(member.medicines) ? member.medicines : [];
      const now = new Date();

      const updatedMeds = meds.map((m: any) => {
        if (m.id !== medId) return m;

        const base = {
          totalReminders: typeof m.totalReminders === 'number' ? m.totalReminders : 0,
          takenReminders: typeof m.takenReminders === 'number' ? m.takenReminders : 0,
          missedReminders: typeof m.missedReminders === 'number' ? m.missedReminders : 0,
          streak: typeof m.streak === 'number' ? m.streak : 0,
        };

        if (action === 'taken') {
          const total = base.totalReminders + 1;
          const taken = base.takenReminders + 1;
          const adherence = total > 0 ? Math.round((taken / total) * 100) : 0;
          return {
            ...m,
            taken: true,
            snoozed: false,
            lastStatus: 'taken',
            lastTakenAt: now,
            totalReminders: total,
            takenReminders: taken,
            missedReminders: base.missedReminders,
            adherenceScore: adherence,
            streak: base.streak + 1,
          };
        }

        if (action === 'snooze') {
          return {
            ...m,
            snoozed: true,
            lastStatus: 'snoozed',
          };
        }

        if (action === 'skip') {
          const total = base.totalReminders + 1;
          const missed = base.missedReminders + 1;
          const adherence =
            total > 0 ? Math.round((base.takenReminders / total) * 100) : 0;
          return {
            ...m,
            taken: false,
            snoozed: false,
            lastStatus: 'missed',
            totalReminders: total,
            takenReminders: base.takenReminders,
            missedReminders: missed,
            adherenceScore: adherence,
            streak: 0,
          };
        }

        return m;
      });

      await family.updateOne(
        { _id: toId(memberId), userId: (req as any).userId },
        { $set: { medicines: updatedMeds } },
      );

      // Log the event
      await medicineLogs.insertOne({
        userId: (req as any).userId,
        memberId,
        medId,
        action, // 'taken' | 'snooze' | 'skip'
        timestamp: now,
      } as any);

      const updated = (await family.findOne({ _id: toId(memberId), userId: (req as any).userId })) as any;
      if (!updated) {
        return res.status(500).json({ message: 'Failed to load updated member' });
      }
      return res.json({
        id: updated._id.toString(),
        name: updated.name,
        relationship: updated.relationship,
        medicines: updated.medicines || [],
      });
    } catch (err) {
      console.error('Patch family medicine error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // ----- Reminder scheduler (email + in-app) -----
  const REMINDER_CHECK_INTERVAL_MS = 60_000;
  const REMINDER_WINDOW_MINUTES = 5;

  function startReminderScheduler() {
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const now = new Date();
        const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

        const activeBills = await bills
          .find({
            status: { $in: ['active', 'snoozed'] },
            isPaid: { $ne: true },
          })
          .toArray();

        for (const bill of activeBills) {
          try {
            const baseDate = bill.status === 'snoozed' && bill.snoozedUntil ? new Date(bill.snoozedUntil) : new Date(bill.dueDate);
            if (Number.isNaN(baseDate.getTime())) continue;

            const msDiff = baseDate.getTime() - now.getTime();
            const daysLeftRaw = msDiff / (24 * 60 * 60 * 1000);
            const daysLeft = Math.max(0, Math.round(daysLeftRaw));

            const reminderDays: number[] = Array.isArray(bill.reminderDaysBefore) && bill.reminderDaysBefore.length
              ? bill.reminderDaysBefore
              : [3, 1, 0];

            if (!reminderDays.includes(daysLeft)) continue;

            const billTimeWithinWindow =
              baseDate.getTime() >= now.getTime() - 60 * 1000 &&
              baseDate.getTime() <= windowEnd.getTime();

            if (!billTimeWithinWindow && daysLeft !== 0) {
              continue;
            }

            const user = await users.findOne({ _id: bill.userId ? toId(bill.userId) : toId('' + bill.userId) });
            if (!user || !user.email) continue;

            const channels: ReminderChannel[] = ['email', 'in_app'];

            for (const channel of channels) {
              const already = await reminderLogs.findOne({
                userId: (user as any)._id?.toString?.() ?? (user as any)._id,
                billId: (bill as any)._id?.toString?.() ?? (bill as any)._id,
                channel,
                dayOffset: daysLeft,
              });
              if (already) continue;

              if (channel === 'email') {
                const html = renderReminderEmailTemplate({
                  userName: user.name || user.email,
                  reminderType: bill.reminderType || 'bill',
                  daysLeft,
                  billName: bill.name || 'Bill',
                  dueDateLabel: baseDate.toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }),
                  category: bill.category || 'bills',
                  amount: bill.amount || 0,
                  currency: '₹',
                  status: bill.status || 'active',
                  reminderSchedule: (Array.isArray(reminderDays) ? reminderDays : [])
                    .sort((a, b) => a - b)
                    .map((d) => (d === 0 ? 'on due day' : `${d}d before`))
                    .join(', '),
                  appUrl: APP_OPEN_URL,
                });

                await sendReminderEmail({
                  to: user.email,
                  subject: `Reminder: ${bill.name || 'Payment'} due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
                  html,
                });
              } else if (channel === 'in_app') {
                const title = bill.name || 'Upcoming payment';
                const body =
                  daysLeft === 0
                    ? `Your ${bill.name || 'payment'} is due today.`
                    : `Your ${bill.name || 'payment'} is due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`;

                const imageUrl = bill.imageUrl || `https://api.dicebear.com/7.x/shapes/png?seed=${bill.category || 'bill'}&backgroundColor=4f46e5`;

                const meta = {
                  type: 'bill',
                  referenceId: (bill as any)._id.toString(),
                  billId: (bill as any)._id.toString(), // legacy support
                  amount: bill.amount || 0,
                  dueDate: baseDate.toISOString(),
                  reminderType: bill.reminderType || 'bill',
                  imageUrl,
                  route: `/bill-details/${(bill as any)._id.toString()}`,
                  redirectUrl: `/bill-details/${(bill as any)._id.toString()}`,
                };

                await notifications.insertOne({
                  userId: user._id?.toString?.() ?? user._id,
                  type: 'reminder',
                  title,
                  body,
                  read: false,
                  createdAt: new Date(),
                  meta,
                });

                const messaging = getFirebaseMessaging();
                if (messaging) {
                  try {
                    const tokenDocs = await pushTokens
                      .find({ userId: user._id?.toString?.() ?? user._id })
                      .project({ token: 1, _id: 0 })
                      .toArray();

                    const tokens = tokenDocs.map((t: any) => t.token).filter(Boolean);

                    if (tokens.length) {
                        await messaging.sendEachForMulticast({
                          tokens,
                          notification: {
                            title,
                            body,
                            imageUrl,
                          },
                          android: {
                            notification: {
                              imageUrl,
                              priority: 'high',
                            },
                          },
                          data: {
                            type: 'reminder',
                            billId: meta.billId,
                            route: meta.route,
                          },
                        });
                        console.log(`[Push] Multi-device send to ${tokens.length} tokens for user ${user.email}`);
                    }
                  } catch (err) {
                    console.error('FCM send error:', err);
                  }
                }
              }

              await reminderLogs.insertOne({
                userId: user._id?.toString?.() ?? user._id,
                billId: (bill as any)._id.toString(),
                channel,
                dayOffset: daysLeft,
                sentAt: new Date(),
              });
            }
          } catch (err) {
            console.error('Reminder scheduler per-bill error:', err);
          }
        }

        // --- NEW: Family Medicine Reminders ---
        const allFamily = await family.find({}).toArray();
        for (const member of allFamily) {
          const meds = Array.isArray(member.medicines) ? member.medicines : [];
          for (const med of meds) {
            try {
              const slots = med.slots || {};
              // Check each slot (morning, noon, evening)
              for (const [slotKey, slotTime] of Object.entries(slots)) {
                if (!slotTime) continue;

                // Parse slotTime (e.g., "9:00 AM")
                const [time, ampm] = (slotTime as string).split(' ');
                let [hh, mm] = time.split(':').map(Number);
                if (ampm === 'PM' && hh < 12) hh += 12;
                if (ampm === 'AM' && hh === 12) hh = 0;

                const doseTime = new Date(now);
                doseTime.setHours(hh, mm, 0, 0);

                // Check if doseTime is within window
                const withinWindow =
                  doseTime.getTime() >= now.getTime() - 60 * 1000 &&
                  doseTime.getTime() <= windowEnd.getTime();

                if (!withinWindow) continue;

                const user = await users.findOne({ _id: toId(member.userId) });
                if (!user) continue;

                const logId = `med-${member._id}-${med.id}-${slotKey}-${doseTime.toISOString().slice(0, 10)}`;
                const already = await reminderLogs.findOne({
                   userId: user._id.toString(),
                   billId: logId, // using billId field for med log uniqueness
                   channel: 'in_app'
                });
                if (already) continue;

                const title = `Time for ${member.name}'s medicine`;
                const body = `Take ${med.name} (${med.dosage || '1 dose'}) - ${slotKey.charAt(0).toUpperCase() + slotKey.slice(1)}`;
                const route = `/medicine-details/${member._id.toString()}/${med.id}`;

                await notifications.insertOne({
                  userId: user._id.toString(),
                  type: 'reminder',
                  title,
                  body,
                  read: false,
                  createdAt: new Date(),
                  meta: { 
                    type: 'medication', 
                    referenceId: med.id,
                    memberId: member._id.toString(), 
                    medId: med.id,
                    route,
                    redirectUrl: route
                  }
                });

                const messaging = getFirebaseMessaging();
                if (messaging) {
                  const tokenDocs = await pushTokens.find({ userId: user._id.toString() }).project({ token: 1 }).toArray();
                  const tokens = tokenDocs.map((t: any) => t.token).filter(Boolean);
                  if (tokens.length) {
                    await messaging.sendEachForMulticast({
                      tokens,
                      notification: { title, body },
                      data: { type: 'medication', route }
                    });
                  }
                }

                await reminderLogs.insertOne({
                  userId: user._id.toString(),
                  billId: logId,
                  channel: 'in_app',
                  dayOffset: 0,
                  sentAt: new Date()
                });
              }
            } catch (medErr) {
              console.error('Med reminder error:', medErr);
            }
          }
        }
      } catch (err) {
        console.error('Reminder scheduler error:', err);
      } finally {
        running = false;
      }
    }, REMINDER_CHECK_INTERVAL_MS);
  }

  startReminderScheduler();

  // ----- Reports -----
  app.get('/api/reports', authMiddleware, (req: any, res) => {
    (async () => {
      try {
        const { start, end } = req.query as { start?: string; end?: string };
        const userId = (req as any).userId;

        if (!start || !end) {
          return res.status(400).json({ message: 'Start and end dates are required' });
        }

        const startDate = new Date(start);
        const endDate = new Date(end);
        const periodMs = endDate.getTime() - startDate.getTime();
        const prevStartDate = new Date(startDate.getTime() - (periodMs || 1));
        const prevEndDate = new Date(startDate);

        const [currentTxs, prevTxs, allBills] = await Promise.all([
          transactions.find({ userId, date: { $gte: startDate.toISOString(), $lte: endDate.toISOString() } }).toArray(),
          transactions.find({ userId, date: { $gte: prevStartDate.toISOString(), $lte: prevEndDate.toISOString() } }).toArray(),
          bills.find({ userId }).toArray(),
        ]);

        const calculateStats = (txs: any[]) => {
          const stats: Record<string, { total: number; count: number }> = {};
          let totalIncome = 0;
          let totalExpense = 0;

          txs.forEach((tx) => {
            const amount = Number(tx.amount) || 0;
            if (tx.isDebit) {
              totalExpense += amount;
              const cat = tx.category || 'others';
              if (!stats[cat]) stats[cat] = { total: 0, count: 0 };
              stats[cat].total += amount;
              stats[cat].count += 1;
            } else {
              totalIncome += amount;
            }
          });

          return { stats, totalIncome, totalExpense };
        };

        const current = calculateStats(currentTxs);
        const previous = calculateStats(prevTxs);

        // Bills stats
        const totalBillsCount = allBills.length;
        const paidBillsCount = allBills.filter((b: any) => b.isPaid || b.status === 'paid').length;

        return res.json({
          period: { start, end },
          income: current.totalIncome,
          expense: current.totalExpense,
          previousIncome: previous.totalIncome,
          previousExpense: previous.totalExpense,
          categories: current.stats,
          previousCategories: previous.stats,
          bills: {
            total: totalBillsCount,
            paid: paidBillsCount,
            ratio: totalBillsCount > 0 ? paidBillsCount / totalBillsCount : 0,
          }
        });
      } catch (err) {
        console.error('Reports API error:', err);
        return res.status(500).json({ message: 'Server error.' });
      }
    })();
  });

  // ----- Life Score -----
  app.get('/api/life-score', authMiddleware, (req: any, res) => {
    (async () => {
      try {
        const userId = (req as any).userId;
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [userTxs, userBills, medLogs] = await Promise.all([
          transactions.find({ userId, date: { $gte: thirtyDaysAgo.toISOString() } }).toArray(),
          bills.find({ userId }).toArray(),
          medicineLogs.find({ userId, timestamp: { $gte: thirtyDaysAgo } }).toArray(),
        ]);

        // 1. Spending Score (Budget compliance)
        const userData = await users.findOne({ _id: toId(userId) });
        const monthlyBudget = userData?.monthlyBudget ?? 50000;
        const monthlySpend = userTxs.filter((tx: any) => tx.isDebit).reduce((s: number, tx: any) => s + (tx.amount || 0), 0);
        const budgetUsedRatio = Math.min(1.5, (monthlySpend / Math.max(1, monthlyBudget)));
        const spendingScore = Math.max(0, 100 - (budgetUsedRatio * 100));

        // 2. Bills Score
        const billRatio = userBills.length > 0
          ? userBills.filter((b: any) => b.isPaid || b.status === 'paid').length / userBills.length
          : 1;
        const billsScore = billRatio * 100;

        // 3. Health Score (Medicine adherence)
        // Check logs vs expected (we'll simplify for now: percentage of 'taken' vs 'taken'+'skip')
        const taken = medLogs.filter((l: any) => l.action === 'taken').length;
        const totalLogs = medLogs.filter((l: any) => l.action === 'taken' || l.action === 'skip').length;
        const healthScore = totalLogs > 0 ? (taken / totalLogs) * 100 : 100;

        // Weighted final score
        // Budget: 50%, Bills: 30%, Health: 20%
        const hasActivity = userTxs.length > 0 || userBills.length > 0 || medLogs.length > 0;

        const finalScore = hasActivity ? Math.round(
          spendingScore * 0.5 +
          (userBills.length > 0 ? billsScore : 100) * 0.3 +
          (totalLogs > 0 ? healthScore : 100) * 0.2
        ) : 0;

        return res.json({
          score: finalScore,
          breakdown: {
            spending: Math.round(spendingScore),
            bills: userBills.length > 0 ? Math.round(billsScore) : 0,
            health: totalLogs > 0 ? Math.round(healthScore) : 0,
          },
          updatedAt: now.toISOString(),
        });
      } catch (err) {
        console.error('Life score API error:', err);
        return res.status(500).json({ message: 'Server error.' });
      }
    })();
  });

  // ----- Admin API -----
  app.get('/api/admin/stats', adminAuthMiddleware, async (req, res) => {
    try {
      const usersCount = await users.countDocuments();
      const openTicketsCount = await supportTickets.countDocuments();
      const txCount = await transactions.countDocuments();
      
      const volumeData = await transactions.aggregate([
        { $match: { isDebit: false } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]).toArray();
      const volume = volumeData[0]?.total || 0;

      res.json({ users: usersCount, openTickets: openTicketsCount, transactions: txCount, volume });
    } catch (err) {
      console.error('Stats error:', err);
      res.status(500).json({ message: 'Failed to fetch stats' });
    }
  });

  app.get('/api/admin/analytics/growth', adminAuthMiddleware, async (req, res) => {
    try {
      const result = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const startOfDay = new Date(d);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(d);
        endOfDay.setHours(23, 59, 59, 999);
        
        const uCount = await users.countDocuments({ createdAt: { $lte: endOfDay } });
        
        const txs = await transactions.aggregate([
          { $match: { isDebit: false, date: { $gte: startOfDay.toISOString(), $lte: endOfDay.toISOString() } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]).toArray();
        const revenue = txs[0]?.total || 0;
        
        result.push({
          name: d.toLocaleDateString('en-US', { weekday: 'short' }),
          users: uCount,
          revenue: revenue
        });
      }
      res.json(result);
    } catch (err) {
      console.error('Growth error:', err);
      res.status(500).json({ message: 'Failed to fetch growth' });
    }
  });

  app.get('/api/admin/activity', adminAuthMiddleware, async (req, res) => {
    try {
      const latestUsers = await users.find().sort({ createdAt: -1 }).limit(5).toArray();
      const latestTickets = await supportTickets.find().sort({ createdAt: -1 }).limit(5).toArray();
      
      const activities: any[] = [
        ...latestUsers.map((u: any) => ({
          id: `usr_${u._id}`,
          title: 'New User Registration',
          description: `${u.name || u.email} joined`,
          color: 'bg-blue-500',
          timestamp: u.createdAt || new Date()
        })),
        ...latestTickets.map((t: any) => ({
          id: `tkt_${t._id}`,
          title: 'New Ticket Created',
          description: t.subject || 'Support Request',
          color: 'bg-rose-500',
          timestamp: t.createdAt || new Date()
        }))
      ];
      
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(activities.slice(0, 8));
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch activity' });
    }
  });

  app.get('/api/admin/users', adminAuthMiddleware, async (req, res) => {
    try {
      const list = await users.find({}).sort({ createdAt: -1 }).toArray();
      res.json(list.map((u: any) => ({ id: u._id.toString(), ...u })));
    } catch (err) {
      console.error('Admin users error:', err);
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });

  app.get('/api/admin/users/:id', adminAuthMiddleware, async (req, res) => {
    try {
      const user = await users.findOne({ _id: toId(req.params.id) });
      res.json(user);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch user' });
    }
  });

  app.put('/api/admin/users/:id/status', adminAuthMiddleware, async (req, res) => {
    try {
      const { status } = req.body;
      await users.updateOne({ _id: toId(req.params.id) }, { $set: { status, updatedAt: new Date() } });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update user status' });
    }
  });

  app.delete('/api/admin/users/:id', adminAuthMiddleware, async (req, res) => {
    try {
      await users.deleteOne({ _id: toId(req.params.id) });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: 'Failed to delete user' });
    }
  });

  app.get('/api/admin/users/:id/activity', adminAuthMiddleware, async (req, res) => {
    try {
      const txs = await transactions.find({ userId: req.params.id }).limit(10).toArray();
      res.json(txs);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch user activity' });
    }
  });

  app.get('/api/admin/support/tickets', adminAuthMiddleware, async (req, res) => {
    try {
      const list = await supportTickets.find({}).sort({ updatedAt: -1 }).toArray();
      const withUser = await Promise.all(list.map(async (t: any) => {
        const u = await users.findOne({ _id: toId(t.userId) });
        return { ...t, userEmail: u?.email, userName: u?.name, id: t._id.toString() };
      }));
      res.json(withUser);
    } catch (err) {
      console.error('Tickets fail:', err);
      res.status(500).json({ message: 'Tickets fail' });
    }
  });

  app.get('/api/admin/support/tickets/:id/messages', adminAuthMiddleware, async (req, res) => {
    try {
      const msgs = await supportMessages.find({ ticketId: req.params.id }).sort({ createdAt: 1 }).toArray();
      res.json(msgs);
    } catch (err) {
      console.error('Messages fail:', err);
      res.status(500).json({ message: 'Messages fail' });
    }
  });

  app.post('/api/admin/support/tickets/:id/messages', adminAuthMiddleware, async (req: any, res) => {
    try {
      const doc = {
        ticketId: req.params.id,
        senderId: req.userId,
        senderType: 'admin',
        senderRole: 'admin',
        content: req.body.content,
        type: 'text',
        status: 'sent',
        createdAt: new Date()
      };
      const result = await supportMessages.insertOne(doc);
      const savedMsg = { ...doc, _id: result.insertedId };
      
      await supportTickets.updateOne({ _id: toId(req.params.id) }, { $set: { updatedAt: new Date(), status: 'in_progress' } });
      
      io.to(`ticket-${req.params.id}`).emit('new-message', savedMsg);
      io.to(`ticket-${req.params.id}`).emit('ticket-status-update', { ticketId: req.params.id, status: 'in_progress' });
      
      res.json(savedMsg);
    } catch (err) {
      console.error('Reply fail:', err);
      res.status(500).json({ message: 'Reply fail' });
    }
  });

  app.patch('/api/admin/support/tickets/:id/status', adminAuthMiddleware, async (req, res) => {
    try {
      await supportTickets.updateOne({ _id: toId(req.params.id) }, { $set: { status: req.body.status, updatedAt: new Date() } });
      res.json({ success: true });
    } catch (err) {
      console.error('Status fail:', err);
      res.status(500).json({ message: 'Status fail' });
    }
  });

  app.get('/api/admin/plans', adminAuthMiddleware, async (req, res) => {
    try {
      const list = await plans.find().sort({ price: 1 }).toArray();
      res.json(list);
    } catch (err) {
      console.error('Admin plans error:', err);
      res.status(500).json({ message: 'Failed to fetch plans' });
    }
  });

  app.post('/api/admin/plans', adminAuthMiddleware, async (req, res) => {
    try {
      const plan = { ...req.body, createdAt: new Date(), updatedAt: new Date() };
      await plans.insertOne(plan);
      res.status(201).json(plan);
    } catch (err) {
      console.error('Admin plans create error:', err);
      res.status(500).json({ message: 'Failed to create plan' });
    }
  });

  app.get('/api/admin/promo-codes', adminAuthMiddleware, async (req, res) => {
    try {
      const list = await promoCodes.find().sort({ createdAt: -1 }).toArray();
      res.json(list);
    } catch (err) {
      console.error('Admin promo codes error:', err);
      res.status(500).json({ message: 'Failed to fetch promo codes' });
    }
  });

  app.post('/api/admin/promo-codes', adminAuthMiddleware, async (req, res) => {
    try {
      const code = { ...req.body, createdAt: new Date() };
      await promoCodes.insertOne(code);
      res.status(201).json(code);
    } catch (err) {
      console.error('Admin promo codes create error:', err);
      res.status(500).json({ message: 'Failed to create promo code' });
    }
  });

  app.get('/api/admin/system-settings', adminAuthMiddleware, async (req, res) => {
    try {
      let settings = await systemSettings.findOne({});
      res.json(settings || {});
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch settings' });
    }
  });

  app.post('/api/admin/system-settings', adminAuthMiddleware, async (req, res) => {
    try {
      await systemSettings.updateOne({}, { $set: req.body }, { upsert: true });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update settings' });
    }
  });

  return httpServer;
}
