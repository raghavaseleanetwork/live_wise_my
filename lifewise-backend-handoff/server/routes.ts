import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import puterModule from '@heyputer/puter.js';
const puter = (puterModule as any).default || puterModule;
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
import { PLANS, LIMITS, FLAGS, PLAN_ORDER, nextPlanUp, getPlanById, type PlanId } from '../constants/plans';
import { parseBankCsv } from './csv-import';
import { categorizeTransactionsWithAI } from './categorization-utils';
import { projectFamilyReminders, notificationBody, notificationBodyMinutes, localDateKey, personalReminderNotificationTitle, familyReminderNotificationTitle, type ProjectedFamilyReminder } from './family-reminders';
import {
  isSupportedPreferredCurrency,
  formatAmountForCurrency,
  CURRENCY_SYMBOLS,
  fetchAndStoreRateForDate,
  backfillRateRange,
  startDailyExchangeRateJob,
  getRateOnOrBefore,
  type SupportedCurrency,
} from './exchange-rates';
import { isExpoFormatToken, sendPushToUser, sendPushToTokenDocs, REMINDER_ACTIONS_CATEGORY } from './push';
import {
  normalizePermissions,
  parsePermissionsInput,
  parsePermissionsUpdate,
  canAccessModule,
  hasAccessLevel,
  isMarkDoneOnlyPatch,
  KIND_TO_MODULE,
  SOURCE_KIND_TO_MODULE,
  type FamilyFeatureKey,
  type CaregiverPermissions,
} from './family-permissions';

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

// Clamps to the last day of the given month instead of rolling into the next
// month (a template set to the 31st fires on Feb 28, never Mar 3).
function clampDayOfMonth(day: number, year: number, monthIndex: number): number {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, day), lastDay);
}

async function initIndexes() {
  const db = getDb();
  if (!db) return;
  const transactions = db.collection('transactions');
  const bills = db.collection('bills');
  const users = db.collection('users');
  const billHistory = db.collection('billHistory');
  const family = db.collection('family_members');
  const caregiverInvites = db.collection('caregiver_invites');
  const usage = db.collection('usage');
  const subscriptionPayments = db.collection('subscription_payments');

  try {
    // Unique index for SMS deduplication: same user, same SMS unique ID
    await (transactions as any).createIndex({ userId: 1, smsId: 1 }, { unique: true, partialFilterExpression: { smsId: { $exists: true } } });
    // Unique index for import/bulk deduplication: same user, same dedupe key
    await (transactions as any).createIndex({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $exists: true } } });
    // Index for common queries
    await (transactions as any).createIndex({ userId: 1, date: -1 });
    await (bills as any).createIndex({ userId: 1 });
    await (billHistory as any).createIndex({ billId: 1, userId: 1, date: -1 });
    await (users as any).createIndex({ email: 1 }, { unique: true });
    await (family as any).createIndex({ userId: 1 });
    await (caregiverInvites as any).createIndex({ inviteeEmail: 1, status: 1 });
    await (caregiverInvites as any).createIndex({ memberId: 1 });
    await (usage as any).createIndex({ userId: 1, yearMonth: 1 }, { unique: true });
    await (db.collection('recurring_expenses') as any).createIndex({ userId: 1 });
    // The reminder scheduler queries reminder_logs once per bill/medicine/family
    // reminder per channel on every tick; push_tokens is queried per-user on
    // every send.
    await (db.collection('reminder_logs') as any).createIndex({ userId: 1, billId: 1, channel: 1, dayOffset: 1 });
    await (db.collection('push_tokens') as any).createIndex({ userId: 1 });
    // RevenueCat retries webhooks on any non-2xx and after transient failures,
    // so eventId must be unique — upsert on it, never blind-insert, or a
    // user's payment history shows duplicated charges.
    await (subscriptionPayments as any).createIndex({ eventId: 1 }, { unique: true });
    await (subscriptionPayments as any).createIndex({ userId: 1, purchasedAt: -1 });
    console.log('[DB] Indexes initialized');
  } catch (err) {
    console.error('[DB] Index initialization failed:', err);
  }
}

type CategoryType = 'health' | 'bills' | 'family' | 'work' | 'tasks' | 'subscriptions' | 'finance' | 'habits' | 'travel' | 'events' | 'food' | 'shopping' | 'transport' | 'entertainment' | 'education' | 'investment' | 'other_expense' | 'others';
// Categories never eligible to be flagged as a money leak — either they're
// already-intentional spend (investment/tax/rent/savings/bills/health/
// education/finance) or, as of other_expense, explicitly user-marked as not
// a leak (P2P transfers, self-transfers, repayments). Shared by GET /api/leaks,
// the ghost-subscription rule, and the AI assistant's leaks snapshot so the
// three surfaces can't drift out of sync with each other.
const LEAK_EXEMPT_CATEGORIES = ['investment', 'tax', 'rent', 'savings', 'bills', 'health', 'education', 'finance', 'other_expense'];
// Whitelist for transaction category writes. `category as CategoryType` is a
// compile-time-only cast — without this check, any string a client sends is
// persisted verbatim, and a typo'd category (e.g. "other-expense") silently
// evades the LEAK_EXEMPT_CATEGORIES $nin filter and reappears as a leak.
const VALID_CATEGORIES: CategoryType[] = [
  'health', 'bills', 'family', 'work', 'tasks', 'subscriptions', 'finance',
  'habits', 'travel', 'events', 'food', 'shopping', 'transport',
  'entertainment', 'education', 'investment', 'other_expense', 'others',
];
function normalizeCategory(raw: unknown): CategoryType {
  const lower = String(raw || '').trim().toLowerCase();
  return (VALID_CATEGORIES as string[]).includes(lower) ? (lower as CategoryType) : 'others';
}
// The import client accepts a narrower set than CategoryType: 'work', 'tasks',
// 'habits' and 'events' are not spend categories and would be silently coerced
// to 'others' on the device. Normalise here so suggestedCategory is always a
// value the client actually honours.
const IMPORT_CATEGORIES = new Set<string>([
  'food', 'transport', 'health', 'bills', 'shopping', 'entertainment',
  'subscriptions', 'education', 'travel', 'investment', 'finance', 'family', 'others',
]);

function toImportCategory(raw: string | undefined): CategoryType {
  const c = (raw || '').trim().toLowerCase();
  return (IMPORT_CATEGORIES.has(c) ? c : 'others') as CategoryType;
}

type PaymentMode = 'upi' | 'cash' | 'card' | 'netbanking';
const PAYMENT_MODES: PaymentMode[] = ['upi', 'cash', 'card', 'netbanking'];
type ReminderType = 'bill' | 'subscription' | 'custom';
type RepeatType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type ReminderStatus = 'active' | 'paid' | 'snoozed';

const JWT_SECRET = process.env.JWT_SECRET || 'lifewise-secret-change-in-production';
const JWT_EXPIRY = '7d';

const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;
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

const caregiverInviteTemplatePath = path.resolve(process.cwd(), 'server', 'templates', 'caregiver-invite-email.html');
const CAREGIVER_INVITE_EMAIL_TEMPLATE = fs.existsSync(caregiverInviteTemplatePath)
  ? fs.readFileSync(caregiverInviteTemplatePath, 'utf-8')
  : '';

type ReminderChannel = 'email' | 'in_app';

const upload = multer({ storage: multer.memoryStorage() });
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// 25MB: a 12-month PDF statement routinely exceeds 10MB. Buffered in memory,
// so this is the ceiling on a single request's footprint.
const statementUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

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
  currencyCode: 'INR' | SupportedCurrency;
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
    .replace(/{{CURRENCY}}/g, CURRENCY_SYMBOLS[params.currencyCode])
    .replace(/{{AMOUNT}}/g, formatAmountForCurrency(params.amount, params.currencyCode))
    .replace(/{{STATUS}}/g, params.status)
    .replace(/{{REMINDER_SCHEDULE}}/g, params.reminderSchedule)
    .replace(/{{APP_URL}}/g, params.appUrl);
}

function renderCaregiverInviteEmailTemplate(params: {
  inviterName: string;
  inviterEmail: string;
  memberName: string;
  inviteeEmail: string;
  appUrl: string;
}): string {
  if (!CAREGIVER_INVITE_EMAIL_TEMPLATE) return '';
  return CAREGIVER_INVITE_EMAIL_TEMPLATE
    .replace(/{{INVITER_NAME}}/g, params.inviterName || 'Someone')
    .replace(/{{INVITER_EMAIL}}/g, params.inviterEmail || '')
    .replace(/{{MEMBER_NAME}}/g, params.memberName || 'a family member')
    .replace(/{{INVITEE_EMAIL}}/g, params.inviteeEmail || '')
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
  const healthReadings = db.collection('health_readings') as any;
  const caregiverInvites = db.collection('caregiver_invites') as any;
  const usage = db.collection('usage') as any;
  const recurringExpenses = db.collection('recurring_expenses') as any;
  const exchangeRates = db.collection('exchange_rates') as any;
  const subscriptionPayments = db.collection('subscription_payments') as any;

  // --- Subscription helpers ---
  function withSubscriptionFields(user: any) {
    return {
      plan: user.plan || 'free',
      planInterval: user.planInterval || 'month',
      planStatus: user.planStatus || 'active',
      planRenewsAt: user.planRenewsAt || null,
      planSource: user.planSource || null,
      trialStartedAt: user.trialStartedAt || null,
      trialUsed: !!user.trialUsed,
    };
  }

  // Test grants are only ever available outside production, and only ever
  // change bookkeeping (planSource, planRenewsAt) — never the entitlement
  // resolution itself. getEffectivePlan/checkLimit read user.plan directly
  // and never branch on planSource, so a granted plan yields identical
  // limits/flags to a real purchase everywhere those are enforced.
  const ALLOW_TEST_GRANTS = process.env.NODE_ENV !== 'production' && process.env.ALLOW_TEST_GRANTS !== 'false';

  const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

  function getEffectivePlan(user: any): PlanId {
    const trialActive = !!user.trialStartedAt &&
      (Date.now() - new Date(user.trialStartedAt).getTime()) < TRIAL_DURATION_MS;
    return trialActive ? 'family' : ((user.plan || 'free') as PlanId);
  }

  function getTrialDaysRemaining(user: any): number {
    if (!user.trialStartedAt) return 0;
    const elapsed = Date.now() - new Date(user.trialStartedAt).getTime();
    const remainingMs = TRIAL_DURATION_MS - elapsed;
    return remainingMs > 0 ? Math.ceil(remainingMs / (24 * 60 * 60 * 1000)) : 0;
  }

  function currentYearMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  async function getOrCreateUsage(userId: string) {
    const yearMonth = currentYearMonth();
    const existing = await usage.findOne({ userId, yearMonth });
    if (existing) return existing;
    const fresh = {
      userId,
      yearMonth,
      voiceReminderPerMonth: 0,
      billScanPerMonth: 0,
      wiseAiPerMonth: 0,
      bankPdfImportPerMonth: 0,
      noticeboardPostsPerMonth: 0,
    };
    try {
      await usage.insertOne(fresh);
    } catch (err) {
      // Unique-index race: another request created it first this instant — reread.
      const raced = await usage.findOne({ userId, yearMonth });
      if (raced) return raced;
      throw err;
    }
    return fresh;
  }

  type LimitKey = keyof typeof LIMITS.free;

  // TEMP: subscription enforcement disabled for this phase — every checkLimit()
  // call site (family members, reminders, bill scan, voice, WiseAI) short-circuits
  // to "no limit hit" below. Flip back to false to restore enforcement exactly as
  // it was; nothing else needs to change.
  const SUBSCRIPTION_ENFORCEMENT_DISABLED = true;

  async function checkLimit(userId: string, limitKey: LimitKey, currentCount: number): Promise<{ error: string; limitKey: LimitKey; recommendedPlan: PlanId } | null> {
    if (SUBSCRIPTION_ENFORCEMENT_DISABLED) return null;
    const user = await users.findOne({ _id: toId(userId) });
    if (!user) return null;
    const effectivePlan = getEffectivePlan(user);
    const limit = LIMITS[effectivePlan][limitKey];
    if (limit === null || limit === undefined) return null;
    if (currentCount >= limit) {
      return { error: 'plan_limit', limitKey, recommendedPlan: nextPlanUp(effectivePlan) };
    }
    return null;
  }

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
    try {
      const list = await family
        .find({ userId: (req as any).userId })
        .sort({ createdAt: -1 })
        .toArray();
      const out = list.map((m: any) => ({
        id: m._id.toString(),
        name: m.name,
        relationship: m.relationship || 'self',
        avatarUrl: m.avatarUrl || null,
        dateOfBirth: m.dateOfBirth || null,
        bloodGroup: m.bloodGroup || null,
        phone: m.phone || null,
        modules: Array.isArray(m.modules) ? m.modules : [],
        // null when unset — {} is indistinguishable from "never configured"
        // on the client (§8 of CAREGIVER-PERMISSIONS-THE-EXACT-MISSING-PIECE).
        features: m.features ?? null,
        caregivers: Array.isArray(m.caregivers) ? m.caregivers : [],
        medicines: Array.isArray(m.medicines) ? m.medicines : [],
      }));
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Family members shared with the current user as a caregiver ---
  // Must be registered before GET /api/family/:id so "shared-with-me" isn't
  // swallowed as an :id param.
  app.get('/api/family/shared-with-me', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const list = await family
        .find({ 'connectedCaregivers.userId': requesterId })
        .sort({ createdAt: -1 })
        .toArray();
      const out = list.map((m: any) => {
        const connected: any[] = Array.isArray(m.connectedCaregivers) ? m.connectedCaregivers : [];
        const entry = connected.find((c: any) => c.userId === requesterId);
        const permissions = normalizePermissions(entry?.permissions);
        const features = m.features ?? null;
        // §6.3: don't advertise modules this caregiver isn't allowed to open.
        // allowedModules === null means unrestricted, so features pass through
        // unchanged — this only narrows for an explicitly restricted caregiver.
        // null stays null either way — nothing to scope down from "never set".
        const scopedFeatures = !features || permissions.allowedModules === null
          ? features
          : Object.fromEntries(
              Object.entries(features).filter(([key]) => canAccessModule(permissions, key as FamilyFeatureKey)),
            );
        return {
          id: m._id.toString(),
          name: m.name,
          relationship: m.relationship || 'self',
          avatarUrl: m.avatarUrl || null,
          dateOfBirth: m.dateOfBirth || null,
          bloodGroup: m.bloodGroup || null,
          phone: m.phone || null,
          modules: Array.isArray(m.modules) ? m.modules : [],
          features: scopedFeatures,
          caregivers: Array.isArray(m.caregivers) ? m.caregivers : [],
          medicines: Array.isArray(m.medicines) ? m.medicines : [],
        };
      });
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.get('/api/family/:id', authMiddleware, async (req, res) => {
    try {
      const m = await family.findOne({ _id: toId(req.params.id), userId: (req as any).userId });
      if (!m) return res.status(404).json({ message: 'Not found' });
      return res.json({
        id: m._id.toString(),
        name: m.name,
        relationship: m.relationship || 'self',
        avatarUrl: m.avatarUrl || null,
        dateOfBirth: m.dateOfBirth || null,
        bloodGroup: m.bloodGroup || null,
        phone: m.phone || null,
        modules: Array.isArray(m.modules) ? m.modules : [],
        // null when unset — {} is indistinguishable from "never configured"
        // on the client (§8 of CAREGIVER-PERMISSIONS-THE-EXACT-MISSING-PIECE).
        features: m.features ?? null,
        caregivers: Array.isArray(m.caregivers) ? m.caregivers : [],
        medicines: Array.isArray(m.medicines) ? m.medicines : [],
      });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/family', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const memberCount = await family.countDocuments({ userId: requesterId });
      const limitHit = await checkLimit(requesterId, 'familyMembers', memberCount);
      if (limitHit) return res.status(403).json(limitHit);

      const { name, relationship, avatarUrl, dateOfBirth, bloodGroup, phone, modules, features } = req.body;
      const doc = {
        userId: (req as any).userId,
        name: String(name || 'New Member').trim(),
        relationship: String(relationship || 'other'),
        avatarUrl: avatarUrl || null,
        dateOfBirth: dateOfBirth || null,
        bloodGroup: bloodGroup || null,
        phone: phone || null,
        modules: Array.isArray(modules) ? modules : [],
        // null when the client sends nothing, not {} — an empty object was
        // indistinguishable from "never configured" on read (§8 of
        // CAREGIVER-PERMISSIONS-THE-EXACT-MISSING-PIECE). Existing members
        // created before this change still have {} stored; this only fixes
        // new members going forward.
        features: features ?? null,
        caregivers: [],
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
    try {
      const { id } = req.params;
      const { name, relationship, avatarUrl, dateOfBirth, bloodGroup, phone, modules, features } = req.body;
      const update: any = { updatedAt: new Date() };
      if (name !== undefined) update.name = String(name).trim();
      if (relationship !== undefined) update.relationship = String(relationship);
      if (avatarUrl !== undefined) update.avatarUrl = avatarUrl;
      if (dateOfBirth !== undefined) update.dateOfBirth = dateOfBirth;
      if (bloodGroup !== undefined) update.bloodGroup = bloodGroup;
      if (phone !== undefined) update.phone = phone;
      if (modules !== undefined) update.modules = modules;
      if (features !== undefined) update.features = features;
      const result = await family.updateOne({ _id: toId(id), userId: (req as any).userId }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ message: 'Not found' });
      const updated = await family.findOne({ _id: toId(id) });
      if (!updated) return res.status(404).json({ message: 'Not found' });
      return res.json({
        id: updated._id.toString(), name: updated.name, relationship: updated.relationship,
        avatarUrl: updated.avatarUrl, dateOfBirth: updated.dateOfBirth, bloodGroup: updated.bloodGroup,
        phone: updated.phone, modules: updated.modules || [], features: updated.features || {},
        caregivers: updated.caregivers || [], medicines: updated.medicines || [],
      });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.delete('/api/family/:id', authMiddleware, async (req, res) => {
    try {
      const result = await family.deleteOne({ _id: toId(req.params.id), userId: (req as any).userId });
      if (result.deletedCount === 0) return res.status(404).json({ message: 'Not found' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Family: Health Readings ---
  app.get('/api/family/:id/health', authMiddleware, async (req, res) => {
    try {
      const healthReadings = db.collection('health_readings') as any;
      const readings = await healthReadings
        .find({ memberId: req.params.id, userId: (req as any).userId })
        .sort({ date: -1 })
        .limit(50)
        .toArray();
      return res.json(readings.map((r: any) => ({ ...r, id: r._id.toString() })));
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/family/:id/health', authMiddleware, async (req, res) => {
    try {
      const { type, value, unit, notes } = req.body;
      if (!type || value === undefined) return res.status(400).json({ message: 'type and value required' });
      const healthReadings = db.collection('health_readings') as any;
      const doc = {
        memberId: req.params.id,
        userId: (req as any).userId,
        type: String(type),
        value: String(value),
        unit: unit || '',
        notes: notes || '',
        date: new Date(),
        createdAt: new Date(),
      };
      const result = await healthReadings.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Family: Caregivers ---
  app.get('/api/family/:id/caregivers', authMiddleware, async (req, res) => {
    try {
      const m = await family.findOne({ _id: toId(req.params.id), userId: (req as any).userId });
      if (!m) return res.status(404).json({ message: 'Not found' });
      return res.json(Array.isArray(m.caregivers) ? m.caregivers : []);
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/family/:id/caregivers', authMiddleware, async (req, res) => {
    try {
      const { name, email, phone, permission } = req.body;
      if (!name) return res.status(400).json({ message: 'name required' });
      const caregiver = {
        id: new ObjectId().toString(),
        name: String(name),
        email: email || null,
        phone: phone || null,
        permission: permission || 'view',
        addedAt: new Date(),
      };
      await family.updateOne(
        { _id: toId(req.params.id), userId: (req as any).userId },
        { $push: { caregivers: caregiver } as any }
      );
      return res.status(201).json(caregiver);
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.delete('/api/family/:id/caregivers/:cid', authMiddleware, async (req, res) => {
    try {
      await family.updateOne(
        { _id: toId(req.params.id), userId: (req as any).userId },
        { $pull: { caregivers: { id: req.params.cid } } as any }
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Connected Caregiver (linked-account sharing) ---
  app.get('/api/family/:memberId/connected-caregivers', authMiddleware, async (req, res) => {
    try {
      const member = await family.findOne({ _id: toId(req.params.memberId) });
      if (!member) return res.status(404).json({ message: 'Not found' });

      const requesterId = (req as any).userId;
      const connected: any[] = Array.isArray(member.connectedCaregivers) ? member.connectedCaregivers : [];
      const isOwner = member.userId === requesterId;
      const isCaregiver = connected.some((c: any) => c.userId === requesterId);
      if (!isOwner && !isCaregiver) return res.status(403).json({ message: 'Forbidden' });

      const allUserIds = [member.userId, ...connected.map((c: any) => c.userId)];
      const userDocs = await users.find({ _id: { $in: allUserIds.map((id: string) => toId(id)) } }).toArray();
      const userById = new Map<string, any>(userDocs.map((u: any) => [u._id.toString(), u]));

      const ownerUser = userById.get(String(member.userId));
      const out = [
        {
          id: member.userId,
          userId: member.userId,
          name: ownerUser?.name || null,
          email: ownerUser?.email || null,
          avatarUrl: ownerUser?.avatarUrl || null,
          role: 'owner',
          connectedAt: member.createdAt || null,
        },
        ...connected.map((c: any) => {
          const u = userById.get(String(c.userId));
          return {
            id: c.userId,
            userId: c.userId,
            name: u?.name || null,
            email: u?.email || null,
            avatarUrl: u?.avatarUrl || null,
            role: 'caregiver',
            connectedAt: c.connectedAt || null,
            // Absent/null on the stored entry ⇒ full access (§1); only send an
            // explicit object when the owner has actually restricted this
            // caregiver, so the client's own "absent → full" normalization
            // still applies to every pre-existing connection.
            ...(c.permissions ? { permissions: c.permissions } : {}),
          };
        }),
      ];
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Outgoing invites for a member — "who have I invited" as opposed to
  // GET /api/caregiver-invites ("who has invited me"). Owner-only: invitee
  // email addresses are the owner's information, not something a connected
  // caregiver should see about other invitees.
  app.get('/api/family/:memberId/connected-caregivers/invites', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const member = await family.findOne({ _id: toId(req.params.memberId) });
      if (!member) return res.status(404).json({ message: 'Not found' });
      if (member.userId !== requesterId) return res.status(403).json({ message: 'Forbidden' });

      const list = await caregiverInvites
        .find({ memberId: member._id, status: 'pending' })
        .sort({ createdAt: -1 })
        .toArray();
      return res.json(list.map(serializeCaregiverInvite));
    } catch (err) {
      console.error('Get pending caregiver invites error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/family/:memberId/connected-caregivers/invite', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const member = await family.findOne({ _id: toId(req.params.memberId) });
      if (!member) return res.status(404).json({ message: 'Not found' });
      if (member.userId !== requesterId) return res.status(403).json({ message: 'Forbidden' });

      const emailRaw = (req.body?.email || '').toString().trim().toLowerCase();
      if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
        return res.status(400).json({ message: 'A valid email is required' });
      }

      const parsedPermissions = parsePermissionsInput(req.body?.permissions);
      if ('error' in parsedPermissions) {
        return res.status(400).json({ message: parsedPermissions.error });
      }

      const requesterUser = await users.findOne({ _id: toId(requesterId) });
      if (requesterUser?.email && String(requesterUser.email).toLowerCase() === emailRaw) {
        return res.status(400).json({ message: 'You cannot invite yourself' });
      }

      const connected: any[] = Array.isArray(member.connectedCaregivers) ? member.connectedCaregivers : [];
      const alreadyCaregiverUserIds = connected.map((c: any) => c.userId);
      if (alreadyCaregiverUserIds.length) {
        const existingUsers = await users.find({ _id: { $in: alreadyCaregiverUserIds.map((id: string) => toId(id)) } }).toArray();
        if (existingUsers.some((u: any) => String(u.email).toLowerCase() === emailRaw)) {
          return res.status(409).json({ message: 'This person is already a caregiver' });
        }
      }

      const existingInvite = await caregiverInvites.findOne({
        memberId: member._id,
        inviteeEmail: emailRaw,
        status: 'pending',
      });
      if (existingInvite) {
        return res.status(409).json({ message: 'An invite is already pending for this email' });
      }

      const inviteDoc = {
        memberId: member._id,
        memberName: member.name,
        memberAvatarUrl: member.avatarUrl || null,
        invitedByUserId: requesterId,
        invitedByName: requesterUser?.name || '',
        invitedByEmail: requesterUser?.email || '',
        inviteeEmail: emailRaw,
        status: 'pending' as const,
        createdAt: new Date(),
        respondedAt: null,
        // null = full access (§1/§4 of the permissions spec); only stored as an
        // explicit object when the inviting owner chose to restrict up front.
        permissions: parsedPermissions.value,
      };
      const result = await caregiverInvites.insertOne(inviteDoc);

      try {
        const invitee = await users.findOne({ email: emailRaw });
        if (invitee) {
          await sendPushToUser(getFirebaseMessaging(), pushTokens, invitee._id.toString(), {
            title: 'Caregiver invite',
            body: `${inviteDoc.invitedByName || 'Someone'} wants to add you as a caregiver for ${member.name}.`,
            channelId: 'default',
            data: {
              type: 'caregiver-invite',
              inviteId: result.insertedId.toString(),
              route: '/caregiver-invites',
            },
          });
        }
      } catch (pushErr) {
        console.error('Caregiver invite push error:', pushErr);
      }

      const inviteEmailHtml = renderCaregiverInviteEmailTemplate({
        inviterName: inviteDoc.invitedByName,
        inviterEmail: inviteDoc.invitedByEmail,
        memberName: inviteDoc.memberName,
        inviteeEmail: inviteDoc.inviteeEmail,
        appUrl: APP_OPEN_URL,
      });
      sendReminderEmail({
        to: inviteDoc.inviteeEmail,
        subject: `${inviteDoc.invitedByName || 'Someone'} invited you to help care for ${inviteDoc.memberName} on LifeWise`,
        html: inviteEmailHtml,
      }).catch((e) => console.error('Caregiver invite email send error:', e));

      return res.status(201).json({ id: result.insertedId.toString(), ...inviteDoc });
    } catch (err) {
      console.error('Caregiver invite error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.delete('/api/family/:memberId/connected-caregivers/:caregiverUserId', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const { memberId, caregiverUserId } = req.params;
      const member = await family.findOne({ _id: toId(memberId) });
      if (!member) return res.status(404).json({ message: 'Not found' });

      const isOwner = member.userId === requesterId;
      if (!isOwner && caregiverUserId !== requesterId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const connected: any[] = Array.isArray(member.connectedCaregivers) ? member.connectedCaregivers : [];
      if (!connected.some((c: any) => c.userId === caregiverUserId)) {
        return res.status(404).json({ message: 'Caregiver not found' });
      }

      await family.updateOne(
        { _id: toId(memberId) },
        { $pull: { connectedCaregivers: { userId: caregiverUserId } } as any }
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Lets the owner change a connected caregiver's permissions after the fact —
  // the common case, since owners usually discover they over-shared later.
  // OWNER ONLY: a caregiver must never be able to widen their own access.
  app.patch('/api/family/:memberId/connected-caregivers/:caregiverUserId/permissions', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const { memberId, caregiverUserId } = req.params;
      const member = await family.findOne({ _id: toId(memberId) });
      if (!member) return res.status(404).json({ message: 'Not found' });
      if (member.userId !== requesterId) return res.status(403).json({ message: 'Forbidden' });

      const connected: any[] = Array.isArray(member.connectedCaregivers) ? member.connectedCaregivers : [];
      if (!connected.some((c: any) => c.userId === caregiverUserId)) {
        return res.status(404).json({ message: 'Caregiver not found' });
      }

      const parsed = parsePermissionsUpdate(req.body);
      if ('error' in parsed) {
        return res.status(400).json({ message: parsed.error });
      }

      await family.updateOne(
        { _id: toId(memberId), 'connectedCaregivers.userId': caregiverUserId },
        { $set: { 'connectedCaregivers.$.permissions': parsed.value } } as any,
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('Update caregiver permissions error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Caregiver invite inbox ---
  // Shared shape for both directions of a caregiver invite — "who invited me"
  // (GET /api/caregiver-invites) and "who have I invited for this member"
  // (GET /api/family/:memberId/connected-caregivers/invites). Keep these in
  // sync deliberately; the client parses both lists with one type.
  function serializeCaregiverInvite(inv: any) {
    return {
      id: inv._id.toString(),
      memberId: inv.memberId?.toString?.() ?? inv.memberId,
      memberName: inv.memberName,
      memberAvatarUrl: inv.memberAvatarUrl || null,
      invitedByName: inv.invitedByName,
      invitedByEmail: inv.invitedByEmail,
      inviteeEmail: inv.inviteeEmail,
      status: inv.status,
      createdAt: inv.createdAt,
    };
  }

  app.get('/api/caregiver-invites', authMiddleware, async (req, res) => {
    try {
      const email = ((req as any).userEmail || '').toString().toLowerCase();
      const list = await caregiverInvites
        .find({ inviteeEmail: email, status: 'pending' })
        .sort({ createdAt: -1 })
        .toArray();
      return res.json(list.map(serializeCaregiverInvite));
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/caregiver-invites/:inviteId/accept', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const email = ((req as any).userEmail || '').toString().toLowerCase();
      const invite = await caregiverInvites.findOne({ _id: toId(req.params.inviteId) });
      if (!invite || invite.status !== 'pending') return res.status(404).json({ message: 'Invite not found' });
      if (invite.inviteeEmail !== email) return res.status(403).json({ message: 'Forbidden' });

      await family.updateOne(
        { _id: toId(invite.memberId), 'connectedCaregivers.userId': { $ne: requesterId } },
        {
          $push: {
            connectedCaregivers: {
              userId: requesterId,
              role: 'caregiver',
              connectedAt: new Date(),
              // Carries the permissions chosen at invite time (§2); null/absent
              // means the invite didn't restrict anything, so this caregiver
              // gets full access like every pre-existing connection.
              permissions: invite.permissions || null,
            },
          },
        } as any
      );

      await caregiverInvites.updateOne(
        { _id: invite._id },
        { $set: { status: 'accepted', respondedAt: new Date() } }
      );

      try {
        const owner = await users.findOne({ _id: toId(invite.invitedByUserId) });
        const acceptingUser = await users.findOne({ _id: toId(requesterId) });
        if (owner) {
          await sendPushToUser(getFirebaseMessaging(), pushTokens, owner._id.toString(), {
            title: 'Caregiver invite accepted',
            body: `${acceptingUser?.name || 'Someone'} accepted your caregiver invite for ${invite.memberName}.`,
            channelId: 'default',
            data: {
              type: 'caregiver-invite-accepted',
              memberId: String(invite.memberId),
              route: '/caregiver-invites',
            },
          });
        }
      } catch (pushErr) {
        console.error('Caregiver accept push error:', pushErr);
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('Caregiver accept error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/caregiver-invites/:inviteId/decline', authMiddleware, async (req, res) => {
    try {
      const email = ((req as any).userEmail || '').toString().toLowerCase();
      const invite = await caregiverInvites.findOne({ _id: toId(req.params.inviteId) });
      if (!invite || invite.status !== 'pending') return res.status(404).json({ message: 'Invite not found' });
      if (invite.inviteeEmail !== email) return res.status(403).json({ message: 'Forbidden' });

      await caregiverInvites.updateOne(
        { _id: invite._id },
        { $set: { status: 'declined', respondedAt: new Date() } }
      );
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });


  // --- Family: Member Reminders ---
  app.get('/api/family/:id/reminders', authMiddleware, async (req, res) => {
    try {
      const memberReminders = await bills
        .find({ userId: (req as any).userId, memberId: req.params.id })
        .sort({ dueDate: 1 })
        .toArray();
      return res.json(memberReminders.map((b: any) => ({ ...b, id: b._id.toString() })));
    } catch (err) {
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Family Hub Phase 5: generic array-backed sub-resources on family_members ---
  // Each feature stores its items as an array field on the family_members document,
  // matching the existing medicines/caregivers pattern above (not separate collections).

  // A member is accessible to its owner or to any user listed in connectedCaregivers
  // (see /api/family/shared-with-me) — caregivers get full read/write on these sub-resources.
  async function findAccessibleFamilyMember(memberId: string, requesterId: string) {
    const member = await family.findOne({ _id: toId(memberId) });
    if (!member) return null;
    const connected: any[] = Array.isArray(member.connectedCaregivers) ? member.connectedCaregivers : [];
    const isOwner = member.userId === requesterId;
    const isCaregiver = connected.some((c: any) => c.userId === requesterId);
    if (!isOwner && !isCaregiver) return null;
    return member;
  }

  // The owner is never restricted (§1). A caregiver's effective permissions
  // come from their connectedCaregivers entry; absent/null there means full
  // access, so every caregiver connected before this feature existed is
  // unaffected. Returns null only if the requester has no relationship to
  // this member at all (caller should treat that as not-found/forbidden).
  function resolveRequesterPermissions(member: any, requesterId: string): CaregiverPermissions | null {
    if (member.userId === requesterId) return { allowedModules: null, accessLevel: 'full' };
    const connected: any[] = Array.isArray(member.connectedCaregivers) ? member.connectedCaregivers : [];
    const entry = connected.find((c: any) => c.userId === requesterId);
    if (!entry) return null;
    return normalizePermissions(entry.permissions);
  }

  function registerFamilyArrayFeature(field: string) {
    const moduleKey = KIND_TO_MODULE[field];

    app.get(`/api/family/:memberId/${field}`, authMiddleware, async (req, res) => {
      try {
        const member = await findAccessibleFamilyMember(req.params.memberId, (req as any).userId);
        if (!member) return res.status(404).json({ message: 'Family member not found' });
        const permissions = resolveRequesterPermissions(member, (req as any).userId)!;
        if (moduleKey && !canAccessModule(permissions, moduleKey)) {
          return res.status(403).json({ message: 'Not permitted to access this module' });
        }
        return res.json(Array.isArray((member as any)[field]) ? (member as any)[field] : []);
      } catch (err) {
        console.error(`Get family ${field} error:`, err);
        return res.status(500).json({ message: 'Server error.' });
      }
    });

    // Accepts an optional client-generated `id` in the body (see Family Hub
    // Records — Server Persistence, §3.3): the client's id is the join key
    // for reminder projections and must survive the device-to-server upload.
    // Posting an id that already exists on this member upserts (merges) that
    // item in place rather than creating a duplicate — required for the
    // multi-device upload in §5 to converge instead of erroring.
    app.post(`/api/family/:memberId/${field}`, authMiddleware, async (req, res) => {
      try {
        const memberId = req.params.memberId;
        const member = await findAccessibleFamilyMember(memberId, (req as any).userId);
        if (!member) return res.status(404).json({ message: 'Family member not found' });
        const permissions = resolveRequesterPermissions(member, (req as any).userId)!;
        if (moduleKey && !canAccessModule(permissions, moduleKey)) {
          return res.status(403).json({ message: 'Not permitted to access this module' });
        }
        // A POST always creates-or-fully-replaces an item, so it always needs
        // `full` — even the upsert-merge branch below can overwrite fields
        // that aren't a completion/snooze toggle (§6.2).
        if (!hasAccessLevel(permissions, 'full')) {
          return res.status(403).json({ message: 'Not permitted to create or edit this item' });
        }

        const { id: bodyId, createdAt: _ignoredCreatedAt, ...rest } = req.body || {};
        const clientId = bodyId != null ? String(bodyId) : null;
        const items = Array.isArray((member as any)[field]) ? (member as any)[field] : [];
        const existing = clientId ? items.find((it: any) => it.id === clientId) : null;

        if (existing) {
          const merged = { ...existing, ...rest, id: existing.id, createdAt: existing.createdAt };
          const nextItems = items.map((it: any) => (it.id === existing.id ? merged : it));
          await family.updateOne({ _id: toId(memberId) }, { $set: { [field]: nextItems } } as any);
          return res.status(200).json(merged);
        }

        const item = {
          id: clientId || `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          ...rest,
          createdAt: new Date(),
        };
        await family.updateOne(
          { _id: toId(memberId) },
          { $push: { [field]: item } } as any,
        );
        return res.status(201).json(item);
      } catch (err) {
        console.error(`Post family ${field} error:`, err);
        return res.status(500).json({ message: 'Server error.' });
      }
    });

    // Merges the patch onto the existing item; `id`/`createdAt` in the body
    // are ignored (immutable, per §3.2). If the body includes `updatedAt`,
    // it is only applied when newer than the stored value (last-write-wins,
    // §6) — a patch with no `updatedAt` is always applied, unconditionally,
    // matching pre-sync client behavior where no clock is available to compare.
    app.patch(`/api/family/:memberId/${field}/:itemId`, authMiddleware, async (req, res) => {
      try {
        const requesterId = (req as any).userId;
        const { memberId, itemId } = req.params;
        const member = await findAccessibleFamilyMember(memberId, requesterId);
        if (!member) return res.status(404).json({ message: 'Family member not found' });
        const permissions = resolveRequesterPermissions(member, requesterId)!;
        if (moduleKey && !canAccessModule(permissions, moduleKey)) {
          return res.status(403).json({ message: 'Not permitted to access this module' });
        }
        // A patch that only flips a completion/snooze field needs `mark_done`;
        // any other field being edited needs `full` (§6.2).
        const requiredLevel = isMarkDoneOnlyPatch(req.body || {}) ? 'mark_done' : 'full';
        if (!hasAccessLevel(permissions, requiredLevel)) {
          return res.status(403).json({ message: 'Not permitted to make this change' });
        }
        const items = Array.isArray((member as any)[field]) ? (member as any)[field] : [];
        const current = items.find((it: any) => it.id === itemId);
        if (!current) return res.status(404).json({ message: 'Item not found' });

        const { id: _ignoredId, createdAt: _ignoredCreatedAt, updatedAt: incomingUpdatedAt, ...rest } = req.body || {};

        if (incomingUpdatedAt !== undefined && current.updatedAt) {
          const incoming = new Date(incomingUpdatedAt).getTime();
          const stored = new Date(current.updatedAt).getTime();
          if (!Number.isNaN(incoming) && !Number.isNaN(stored) && incoming < stored) {
            return res.json(current); // stale patch: stored value already newer, no-op
          }
        }

        const updatedItem = { ...current, ...rest, id: current.id, createdAt: current.createdAt, updatedAt: new Date() };
        const nextItems = items.map((it: any) => (it.id === itemId ? updatedItem : it));
        await family.updateOne(
          { _id: toId(memberId) },
          { $set: { [field]: nextItems } } as any,
        );
        notifyOtherCaregivers(member, requesterId, { type: 'sync', memberId, field, itemId });
        return res.json(updatedItem);
      } catch (err) {
        console.error(`Patch family ${field} error:`, err);
        return res.status(500).json({ message: 'Server error.' });
      }
    });

    app.delete(`/api/family/:memberId/${field}/:itemId`, authMiddleware, async (req, res) => {
      try {
        const { memberId, itemId } = req.params;
        const requesterId = (req as any).userId;
        const member = await findAccessibleFamilyMember(memberId, requesterId);
        if (!member) return res.status(404).json({ message: 'Family member not found' });
        const permissions = resolveRequesterPermissions(member, requesterId)!;
        if (moduleKey && !canAccessModule(permissions, moduleKey)) {
          return res.status(403).json({ message: 'Not permitted to access this module' });
        }
        if (!hasAccessLevel(permissions, 'full')) {
          return res.status(403).json({ message: 'Not permitted to delete this item' });
        }
        await family.updateOne(
          { _id: toId(memberId) },
          { $pull: { [field]: { id: itemId } } } as any,
        );
        return res.json({ ok: true });
      } catch (err) {
        console.error(`Delete family ${field} error:`, err);
        return res.status(500).json({ message: 'Server error.' });
      }
    });
  }

  [
    'appointments',       // Doctor Appointments
    'healthLogs',         // Health Monitoring
    'medicationStock',    // Medication Stock (see also PATCH /adjust-stock below)
    'routines',           // Daily Routine
    'familyBills',        // Bill Management
    'subscriptions',      // Subscription Tracking
    'familyExpenses',     // Expense Tracking
    'familyTasks',        // Reminder Tasks
    'documents',          // Insurance & Documents
    'checkins',           // Call & Check-in
    'travelItems',        // Travel & Visits
    'customItems',        // Custom Feature
    // --- Family Hub PRD compliance: previously-missing modules (2026-08) ---
    // dietProfile / studyProfile / emergencyProfile are single-record-per-member
    // kinds but use this same list-shaped CRUD: the client POSTs one record whose
    // `id` equals the memberId and reads `[0]` from the GET. The upsert-by-id
    // behavior in the POST handler above already makes repeat posts idempotent,
    // so no special-casing is needed here.
    'dietProfile',         // Diet & Meal Planning (PRD 12) — single record
    'fitnessItems',        // Fitness Tracking (PRD 15)
    'studyProfile',        // Study & Education (PRD 16) — single record
    'moodLogs',            // Mental Health — mood log (PRD 17)
    'wellnessReminders',   // Mental Health — reminders (PRD 17)
    'vehicles',            // Vehicle Management (PRD 18)
    'fuelLog',             // Vehicle Management — fuel entries (PRD 18)
    'homeMaintenance',     // Home Maintenance (PRD 19)
    'emergencyProfile',    // Emergency SOS medical profile (PRD 4) — single record
  ].forEach(registerFamilyArrayFeature);

  // --- Family Hub Phase 2: projected reminders ---
  // Read-only view derived from family records (owned + shared-as-caregiver).
  // The family record is authoritative; this projection is never persisted.
  app.get('/api/reminders/family', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const members = await family
        .find({ $or: [{ userId: requesterId }, { 'connectedCaregivers.userId': requesterId }] })
        .toArray();
      const reminders = projectFamilyReminders(members);
      // §7: a caregiver must not see reminders for a module they aren't
      // allowed to open — same leak this whole spec exists to close, just via
      // the reminders feed instead of the record routes directly.
      const permissionsByMember = new Map<string, CaregiverPermissions>();
      for (const member of members) {
        const memberId = member._id?.toString?.() ?? String(member._id);
        permissionsByMember.set(memberId, resolveRequesterPermissions(member, requesterId) || { allowedModules: [], accessLevel: 'view' });
      }
      const scoped = reminders.filter((r) => {
        const permissions = permissionsByMember.get(r.memberId);
        if (!permissions) return false;
        const moduleKey = SOURCE_KIND_TO_MODULE[r.sourceKind];
        return !moduleKey || canAccessModule(permissions, moduleKey);
      });
      return res.json(scoped);
    } catch (err) {
      console.error('Get family reminders error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });
  ['post', 'put', 'delete', 'patch'].forEach((method) => {
    (app as any)[method]('/api/reminders/family', authMiddleware, (_req: any, res: any) => {
      return res.status(405).json({ message: 'Family reminders are read-only; mutate the underlying family record instead.' });
    });
  });

  // Medication Stock: increment/decrement quantityRemaining without a full item replace
  app.patch('/api/family/:memberId/medicationStock/:itemId/adjust-stock', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const { memberId, itemId } = req.params;
      const delta = Number(req.body?.delta);
      if (!Number.isFinite(delta)) return res.status(400).json({ message: 'delta must be a number' });
      const member = await findAccessibleFamilyMember(memberId, requesterId);
      if (!member) return res.status(404).json({ message: 'Family member not found' });
      const permissions = resolveRequesterPermissions(member, requesterId)!;
      if (!canAccessModule(permissions, 'stock')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      // Adjusting quantityRemaining isn't a completion/snooze toggle, so it
      // needs `full` rather than `mark_done` (§6.2).
      if (!hasAccessLevel(permissions, 'full')) {
        return res.status(403).json({ message: 'Not permitted to make this change' });
      }
      const items = Array.isArray((member as any).medicationStock) ? (member as any).medicationStock : [];
      let updatedItem: any = null;
      const nextItems = items.map((it: any) => {
        if (it.id !== itemId) return it;
        const current = typeof it.quantityRemaining === 'number' ? it.quantityRemaining : 0;
        updatedItem = { ...it, quantityRemaining: Math.max(0, current + delta), updatedAt: new Date() };
        return updatedItem;
      });
      if (!updatedItem) return res.status(404).json({ message: 'Item not found' });
      await family.updateOne(
        { _id: toId(memberId) },
        { $set: { medicationStock: nextItems } } as any,
      );
      notifyOtherCaregivers(member, requesterId, { type: 'sync', memberId, field: 'medicationStock', itemId });
      return res.json(updatedItem);
    } catch (err) {
      console.error('Adjust medication stock error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Family Hub Phase 5: Emergency Alerts ---
  // emergencySettings is a single object per member (not an array); emergencyLog is an array.
  app.get('/api/family/:memberId/emergency-settings', authMiddleware, async (req, res) => {
    try {
      const member = await findAccessibleFamilyMember(req.params.memberId, (req as any).userId);
      if (!member) return res.status(404).json({ message: 'Family member not found' });
      const permissions = resolveRequesterPermissions(member, (req as any).userId)!;
      if (!canAccessModule(permissions, 'emergency')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      return res.json((member as any).emergencySettings || {});
    } catch (err) {
      console.error('Get emergency settings error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.put('/api/family/:memberId/emergency-settings', authMiddleware, async (req, res) => {
    try {
      const memberId = req.params.memberId;
      const requesterId = (req as any).userId;
      const member = await findAccessibleFamilyMember(memberId, requesterId);
      if (!member) return res.status(404).json({ message: 'Family member not found' });
      const permissions = resolveRequesterPermissions(member, requesterId)!;
      if (!canAccessModule(permissions, 'emergency')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      if (!hasAccessLevel(permissions, 'full')) {
        return res.status(403).json({ message: 'Not permitted to make this change' });
      }
      await family.updateOne(
        { _id: toId(memberId) },
        { $set: { emergencySettings: req.body || {} } } as any,
      );
      return res.json(req.body || {});
    } catch (err) {
      console.error('Put emergency settings error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.get('/api/family/:memberId/emergency-log', authMiddleware, async (req, res) => {
    try {
      const member = await findAccessibleFamilyMember(req.params.memberId, (req as any).userId);
      if (!member) return res.status(404).json({ message: 'Family member not found' });
      const permissions = resolveRequesterPermissions(member, (req as any).userId)!;
      if (!canAccessModule(permissions, 'emergency')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      return res.json(Array.isArray((member as any).emergencyLog) ? (member as any).emergencyLog : []);
    } catch (err) {
      console.error('Get emergency log error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.patch('/api/family/:memberId/emergency-log/:itemId', authMiddleware, async (req, res) => {
    try {
      const requesterId = (req as any).userId;
      const { memberId, itemId } = req.params;
      const member = await findAccessibleFamilyMember(memberId, requesterId);
      if (!member) return res.status(404).json({ message: 'Family member not found' });
      const permissions = resolveRequesterPermissions(member, requesterId)!;
      if (!canAccessModule(permissions, 'emergency')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      const requiredLevel = isMarkDoneOnlyPatch(req.body || {}) ? 'mark_done' : 'full';
      if (!hasAccessLevel(permissions, requiredLevel)) {
        return res.status(403).json({ message: 'Not permitted to make this change' });
      }
      const items = Array.isArray((member as any).emergencyLog) ? (member as any).emergencyLog : [];
      let updatedItem: any = null;
      const nextItems = items.map((it: any) => {
        if (it.id !== itemId) return it;
        updatedItem = { ...it, ...req.body, id: it.id, updatedAt: new Date() };
        return updatedItem;
      });
      if (!updatedItem) return res.status(404).json({ message: 'Item not found' });
      await family.updateOne(
        { _id: toId(memberId) },
        { $set: { emergencyLog: nextItems } } as any,
      );
      notifyOtherCaregivers(member, requesterId, { type: 'sync', memberId, field: 'emergencyLog', itemId });
      return res.json(updatedItem);
    } catch (err) {
      console.error('Patch emergency log error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Custom Feature: customConfig is a single object per member, customItems already registered above.
  app.get('/api/family/:memberId/custom-config', authMiddleware, async (req, res) => {
    try {
      const member = await findAccessibleFamilyMember(req.params.memberId, (req as any).userId);
      if (!member) return res.status(404).json({ message: 'Family member not found' });
      const permissions = resolveRequesterPermissions(member, (req as any).userId)!;
      if (!canAccessModule(permissions, 'custom')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      return res.json((member as any).customConfig || {});
    } catch (err) {
      console.error('Get custom config error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.put('/api/family/:memberId/custom-config', authMiddleware, async (req, res) => {
    try {
      const memberId = req.params.memberId;
      const requesterId = (req as any).userId;
      const member = await findAccessibleFamilyMember(memberId, requesterId);
      if (!member) return res.status(404).json({ message: 'Family member not found' });
      const permissions = resolveRequesterPermissions(member, requesterId)!;
      if (!canAccessModule(permissions, 'custom')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      if (!hasAccessLevel(permissions, 'full')) {
        return res.status(403).json({ message: 'Not permitted to make this change' });
      }
      await family.updateOne(
        { _id: toId(memberId) },
        { $set: { customConfig: req.body || {} } } as any,
      );
      return res.json(req.body || {});
    } catch (err) {
      console.error('Put custom config error:', err);
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
        await plans.insertMany(
          PLANS.map((p) => ({
            name: p.name,
            type: p.id,
            price: p.priceMonthly,
            priceYearly: p.priceYearly,
            interval: 'month' as const,
            features: [],
            limits: p.limits,
            flags: p.flags,
            productIdMonthly: p.productIdMonthly,
            productIdYearly: p.productIdYearly,
            status: 'active',
            activeUsers: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
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
          ...withSubscriptionFields(user),
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
      const userResponse = { id: userId, email: doc.email, name: doc.name, ...withSubscriptionFields(doc) };
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
        user: { id: userId, email: user.email, name: user.name, phone: user.phone, phoneVerified: true, ...withSubscriptionFields(user) },
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
        user: { id: userId, email: user.email, name: user.name, phone: user.phone, phoneVerified: user.phoneVerified, ...withSubscriptionFields(user) },
        token,
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ message: 'Server error. Please try again.' });
    }
  });

  app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current password and new password are required' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters' });
      }

      const userId = (req as any).userId;
      const user = await users.findOne({ _id: toId(userId) });
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      if (!user.passwordHash) {
        return res.status(400).json({ message: 'This account has no password set (signed in with Google or Apple)' });
      }

      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      await users.updateOne({ _id: toId(userId) }, { $set: { passwordHash: newPasswordHash } });

      return res.json({ message: 'Password updated' });
    } catch (err) {
      console.error('Change password error:', err);
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
          ...withSubscriptionFields(user),
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
      const { token, platform, tokenType } = req.body as { token?: string; platform?: 'ios' | 'android' | 'web'; tokenType?: string };
      if (!token) {
        return res.status(400).json({ message: 'token is required' });
      }
      // Expo push tokens are meaningful only to Expo's relay, not FCM — firebase-admin
      // rejects every one of them. Refusing to store keeps push_tokens free of rows
      // that can never succeed, rather than failing silently at send time.
      if (isExpoFormatToken(token)) {
        return res.status(400).json({ message: 'Expected a native FCM/APNs token, not an Expo push token.' });
      }

      await pushTokens.updateOne(
        { userId: (req as any).userId, token },
        {
          $set: {
            userId: (req as any).userId,
            token,
            platform: platform || 'android',
            tokenType: tokenType || 'fcm',
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
          preferredCurrency: (user as any).preferredCurrency || 'INR',
          ...withSubscriptionFields(user),
        },
      });
    } catch (err) {
      console.error('Me error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.put('/api/auth/me', authMiddleware, async (req, res) => {
    try {
      const { name, phone, avatarUrl, email, dateOfBirth, preferredCurrency } = req.body as {
        name?: string;
        phone?: string | null;
        avatarUrl?: string | null;
        email?: string;
        dateOfBirth?: string | null;
        preferredCurrency?: string;
      };
      const update: any = {};
      if (name !== undefined) update.name = String(name).trim();
      if (phone !== undefined) update.phone = phone === null ? null : String(phone).trim();
      if (avatarUrl !== undefined) update.avatarUrl = avatarUrl === null ? null : String(avatarUrl);
      if (preferredCurrency !== undefined) {
        const code = String(preferredCurrency).toUpperCase().trim();
        if (!isSupportedPreferredCurrency(code)) {
          return res.status(400).json({ message: 'Unsupported currency. Must be one of INR, USD, EUR, GBP, JPY, AUD, CAD.' });
        }
        update.preferredCurrency = code;
      }
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
          preferredCurrency: (user as any).preferredCurrency || 'INR',
          ...withSubscriptionFields(user),
        },
      });
    } catch (err) {
      console.error('Update me error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Exchange rate history (INR base) ---
  // A past day's rate is immutable once stored, so this is safe to cache hard client-side.
  app.get('/api/exchange-rates/history', authMiddleware, async (req, res) => {
    try {
      const from = String(req.query.from || '');
      const to = String(req.query.to || '');
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRe.test(from) || !dateRe.test(to)) {
        return res.status(400).json({ message: 'from and to are required as YYYY-MM-DD' });
      }
      if (from > to) {
        return res.status(400).json({ message: 'from must not be after to' });
      }

      const docs = await exchangeRates
        .find({ date: { $gte: from, $lte: to } })
        .sort({ date: 1 })
        .toArray();

      const rates: Record<string, Record<string, number>> = {};
      for (const doc of docs) {
        rates[doc.date] = doc.rates;
      }
      return res.json({ base: 'INR', rates });
    } catch (err) {
      console.error('Exchange rate history error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // --- Subscription / Plans (customer-facing) ---
  app.get('/api/plans', async (req, res) => {
    return res.json(PLANS);
  });

  app.get('/api/subscription/me', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const user = await users.findOne({ _id: toId(userId) });
      if (!user) return res.status(404).json({ message: 'User not found' });
      const effectivePlan = getEffectivePlan(user);
      const usageDoc = await getOrCreateUsage(userId);
      return res.json({
        ...withSubscriptionFields(user),
        effectivePlan,
        trialDaysRemaining: getTrialDaysRemaining(user),
        usage: {
          voiceReminderPerMonth: usageDoc.voiceReminderPerMonth,
          billScanPerMonth: usageDoc.billScanPerMonth,
          wiseAiPerMonth: usageDoc.wiseAiPerMonth,
          bankPdfImportPerMonth: usageDoc.bankPdfImportPerMonth,
          noticeboardPostsPerMonth: usageDoc.noticeboardPostsPerMonth,
        },
        limits: LIMITS[effectivePlan],
        flags: FLAGS[effectivePlan],
      });
    } catch (err) {
      console.error('Subscription me error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/subscription/trial', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const user = await users.findOne({ _id: toId(userId) });
      if (!user) return res.status(404).json({ message: 'User not found' });
      if (user.trialUsed) {
        return res.status(409).json({ message: 'Trial has already been used' });
      }
      const trialStartedAt = new Date();
      await users.updateOne({ _id: toId(userId) }, { $set: { trialStartedAt, trialUsed: true } });
      return res.json({ ok: true, trialStartedAt });
    } catch (err) {
      console.error('Subscription trial error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  const USAGE_KEYS = ['voiceReminderPerMonth', 'billScanPerMonth', 'wiseAiPerMonth', 'bankPdfImportPerMonth', 'noticeboardPostsPerMonth'] as const;

  app.post('/api/subscription/usage', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { key } = req.body as { key?: string };
      if (!key || !(USAGE_KEYS as readonly string[]).includes(key)) {
        return res.status(400).json({ message: `key must be one of: ${USAGE_KEYS.join(', ')}` });
      }
      const existing = await getOrCreateUsage(userId);
      const yearMonth = currentYearMonth();
      const count = (Number(existing[key]) || 0) + 1;
      await usage.updateOne({ userId, yearMonth }, { $set: { [key]: count } });

      const user = await users.findOne({ _id: toId(userId) });
      const effectivePlan = user ? getEffectivePlan(user) : 'free';
      const limit = (LIMITS[effectivePlan] as any)[key];
      const exceeded = limit !== null && limit !== undefined && count > limit;

      return res.json({ count, limit: limit ?? null, exceeded });
    } catch (err) {
      console.error('Subscription usage error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/subscription/purchase', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { planId, interval } = req.body as { planId?: string; interval?: string };
      const plan = planId ? getPlanById(planId) : undefined;
      if (!plan) {
        return res.status(400).json({ message: `planId must be one of: ${PLAN_ORDER.join(', ')}` });
      }
      if (interval !== 'month' && interval !== 'year') {
        return res.status(400).json({ message: 'interval must be "month" or "year"' });
      }
      const now = Date.now();
      const renewsAt = new Date(interval === 'year' ? now + 365 * 24 * 60 * 60 * 1000 : now + 30 * 24 * 60 * 60 * 1000);
      await users.updateOne(
        { _id: toId(userId) },
        { $set: { plan: plan.id, planInterval: interval, planStatus: 'active', planSource: 'store', planRenewsAt: renewsAt } },
      );
      return res.json({ ok: true, plan: plan.id, planInterval: interval, planRenewsAt: renewsAt });
    } catch (err) {
      console.error('Subscription purchase error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Non-production only: instantly grants a plan with no payment, for QA before
  // the store listing is live. Resolves through the exact same getEffectivePlan/
  // checkLimit path as a real purchase, so it unlocks identical limits and flags.
  // Distinguished from a real purchase only by planSource ("test" vs "store") and
  // by never setting planRenewsAt — a test grant does not expire on its own and
  // never counts toward revenue reporting.
  app.post('/api/subscription/test-grant', authMiddleware, async (req, res) => {
    if (!ALLOW_TEST_GRANTS) {
      // 404, not 403 — do not reveal that this endpoint exists in production.
      return res.status(404).json({ message: 'Not found' });
    }
    try {
      const userId = (req as any).userId;
      const { planId, interval } = req.body as { planId?: string; interval?: string };
      const plan = planId ? getPlanById(planId) : undefined;
      if (!plan) {
        return res.status(400).json({ message: `planId must be one of: ${PLAN_ORDER.join(', ')}` });
      }
      if (interval !== 'month' && interval !== 'year') {
        return res.status(400).json({ message: 'interval must be "month" or "year"' });
      }
      await users.updateOne(
        { _id: toId(userId) },
        {
          $set: { plan: plan.id, planInterval: interval, planStatus: 'active', planSource: 'test' },
          $unset: { planRenewsAt: '' },
        },
      );
      console.log(`[TEST GRANT] userId=${userId} plan=${plan.id} interval=${interval}`);
      return res.json({ ok: true, plan: plan.id, planInterval: interval, planSource: 'test' });
    } catch (err) {
      console.error('Subscription test-grant error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // product_id -> { plan, interval } from the single source of truth in
  // constants/plans.ts, instead of trusting RevenueCat's entitlement_ids
  // naming to line up with our PlanId values.
  const PRODUCT_ID_TO_PLAN = new Map<string, { plan: PlanId; interval: 'month' | 'year' }>();
  for (const p of PLANS) {
    if (p.productIdMonthly) PRODUCT_ID_TO_PLAN.set(p.productIdMonthly, { plan: p.id, interval: 'month' });
    if (p.productIdYearly) PRODUCT_ID_TO_PLAN.set(p.productIdYearly, { plan: p.id, interval: 'year' });
  }

  const REVENUECAT_EVENT_TYPES = new Set([
    'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'CANCELLATION',
    'UNCANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED',
    'TRANSFER', 'REFUND', 'REFUND_REVERSED',
  ]);

  // RevenueCat retries on any non-2xx and after transient failures, so this
  // must be idempotent (upsert on eventId) and must not depend on our own
  // user JWT — the caller is RevenueCat's server, not an app user.
  app.post('/api/webhooks/revenuecat', async (req, res) => {
    try {
      if (!REVENUECAT_WEBHOOK_SECRET) {
        console.error('[RevenueCat webhook] REVENUECAT_WEBHOOK_SECRET not configured, rejecting.');
        return res.status(401).json({ message: 'Webhook not configured' });
      }
      const auth = req.headers.authorization || '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
      if (provided !== REVENUECAT_WEBHOOK_SECRET) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const event = (req.body && req.body.event) || req.body || {};
      const eventId = event.id ? String(event.id) : null;
      const eventType = String(event.type || '');
      const userId = event.app_user_id ? String(event.app_user_id) : null;

      // Ack anything we can't attribute so RevenueCat doesn't retry forever,
      // but don't write a row we can't dedupe or scope to a user.
      if (!eventId || !userId || !REVENUECAT_EVENT_TYPES.has(eventType)) {
        return res.status(200).json({ ok: true, skipped: true });
      }

      const productId = event.product_id ? String(event.product_id) : null;
      const mapped = productId ? PRODUCT_ID_TO_PLAN.get(productId) : undefined;

      const doc = {
        eventId,
        userId,
        type: eventType,
        productId,
        plan: mapped?.plan || null,
        interval: mapped?.interval || null,
        amount: typeof event.price === 'number' ? event.price : null,
        currency: event.currency || null,
        taxPercentage: typeof event.tax_percentage === 'number' ? event.tax_percentage : null,
        store: event.store || null,
        environment: event.environment || null,
        purchasedAt: event.purchased_at_ms ? new Date(event.purchased_at_ms) : null,
        expiresAt: event.expiration_at_ms ? new Date(event.expiration_at_ms) : null,
        isRenewal: eventType === 'RENEWAL',
        isRefunded: eventType === 'REFUND',
        rawEvent: event,
        createdAt: new Date(),
      };

      await subscriptionPayments.updateOne(
        { eventId },
        { $setOnInsert: doc },
        { upsert: true },
      );

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('RevenueCat webhook error:', err);
      // Still 200: a 500 makes RevenueCat retry an event that may have
      // already failed for a reason retrying won't fix (e.g. a malformed
      // payload), and repeated retries are themselves noisy/costly. The
      // eventId-unique index means a genuinely transient failure is safe
      // to lose here — a real resend will just upsert again later.
      return res.status(200).json({ ok: false });
    }
  });

  app.get('/api/subscription/payments', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const before = req.query.before ? new Date(String(req.query.before)) : null;

      const query: Record<string, any> = {
        userId,
        environment: { $ne: 'SANDBOX' },
      };
      if (before && !Number.isNaN(before.getTime())) {
        query.purchasedAt = { $lt: before };
      }

      const rows = await subscriptionPayments
        .find(query)
        .sort({ purchasedAt: -1 })
        .limit(limit + 1)
        .toArray();

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return res.json({
        payments: page.map((p: any) => ({
          id: p._id.toString(),
          type: p.type,
          plan: p.plan,
          productId: p.productId,
          interval: p.interval,
          amount: p.amount,
          currency: p.currency,
          store: p.store,
          purchasedAt: p.purchasedAt,
          expiresAt: p.expiresAt,
          isRefunded: !!p.isRefunded,
        })),
        hasMore,
      });
    } catch (err) {
      console.error('Get subscription payments error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post(
    '/api/avatar',
    authMiddleware,
    (req: any, res: any, next: any) => {
      avatarUpload.single('avatar')(req, res, (err: any) => {
        if (err?.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'Avatar image must be 5MB or smaller.' });
        }
        if (err) {
          console.error('Avatar multer error:', err);
          return res.status(400).json({ message: 'Invalid upload.' });
        }
        next();
      });
    },
    async (req: any, res: any) => {
      try {
        if (!S3_BUCKET) {
          return res.status(500).json({ message: 'S3 bucket not configured. Set AWS_S3_BUCKET.' });
        }
        const file = (req as any).file;
        if (!file || !file.buffer) {
          return res.status(400).json({ message: 'avatar file is required' });
        }
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
          return res.status(400).json({ message: 'Only image files are allowed.' });
        }

        const key = `avatars/${(req as any).userId}/${Date.now()}-${file.originalname}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype || 'image/jpeg',
            ACL: 'public-read',
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

  app.post(
    '/api/uploads/receipt',
    authMiddleware,
    (req: any, res: any, next: any) => {
      avatarUpload.single('receipt')(req, res, (err: any) => {
        if (err?.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'Receipt image must be 5MB or smaller.' });
        }
        if (err) {
          console.error('Receipt multer error:', err);
          return res.status(400).json({ message: 'Invalid upload.' });
        }
        next();
      });
    },
    async (req: any, res: any) => {
      try {
        if (!S3_BUCKET) {
          return res.status(500).json({ message: 'S3 bucket not configured. Set AWS_S3_BUCKET.' });
        }
        const file = (req as any).file;
        if (!file || !file.buffer) {
          return res.status(400).json({ message: 'receipt file is required' });
        }
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
          return res.status(400).json({ message: 'Only image files are allowed.' });
        }

        const key = `receipts/${(req as any).userId}/${Date.now()}-${file.originalname}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype || 'image/jpeg',
            ACL: 'public-read',
          } as any),
        );

        const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
        return res.status(201).json({ url });
      } catch (err) {
        console.error('Upload receipt error:', err);
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
        memberId: t.memberId || null,
        paymentMode: (t.paymentMode as PaymentMode) || 'upi',
        receiptUrl: t.receiptUrl || '',
        source: t.source || 'manual',
        dedupeKey: t.dedupeKey || undefined,
      }));
      return res.json(out);
    } catch (err) {
      console.error('Get transactions error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/transactions', authMiddleware, async (req, res) => {
    try {
      const { merchant, amount, category, date, upiId, isDebit, description, memberId, paymentMode, receiptUrl, source, dedupeKey } = req.body;
      if (!merchant || amount == null) {
        return res.status(400).json({ message: 'merchant and amount are required' });
      }

      const userId = (req as any).userId;
      let resolvedMemberId: string | null = null;
      if (memberId) {
        const member = await family.findOne({ _id: toId(memberId), userId });
        resolvedMemberId = member ? String(memberId) : null;
      }

      const doc: Record<string, any> = {
        userId,
        merchant: String(merchant),
        amount: Number(amount),
        category: normalizeCategory(category),
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        upiId: upiId || '',
        isDebit: isDebit !== false,
        description: description || '',
        memberId: resolvedMemberId,
        paymentMode: PAYMENT_MODES.includes(paymentMode) ? (paymentMode as PaymentMode) : 'upi',
        receiptUrl: receiptUrl || '',
        source: source || 'manual',
      };

      if (dedupeKey) {
        doc.dedupeKey = String(dedupeKey);
        await (transactions as any).updateOne(
          { userId, dedupeKey: doc.dedupeKey },
          { $setOnInsert: doc },
          { upsert: true },
        );
        const saved = await transactions.findOne({ userId, dedupeKey: doc.dedupeKey });
        return res.status(201).json({ id: saved!._id.toString(), ...saved });
      }

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

  // Re-tag an existing transaction's category (e.g. mark an SMS-synced P2P
  // transfer as other_expense after the fact — the app never shows a category
  // picker during SMS sync, so this is the only way to correct one post-hoc).
  // categoryLockedByUser makes the "never auto-overwrite a user's explicit
  // choice" invariant explicit in the data, instead of relying on the AI
  // re-categorizer's query happening to stay narrowly scoped to 'others'.
  app.patch('/api/transactions/:id', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { category } = req.body;
      if (category === undefined) {
        return res.status(400).json({ message: 'category is required' });
      }
      const rawCategory = String(category || '').trim().toLowerCase();
      if (!(VALID_CATEGORIES as string[]).includes(rawCategory)) {
        return res.status(400).json({ message: 'Invalid category' });
      }

      const result = await transactions.findOneAndUpdate(
        { _id: toId(req.params.id), userId },
        { $set: { category: rawCategory as CategoryType, categoryLockedByUser: true, updatedAt: new Date() } },
        { returnDocument: 'after' } as any,
      );
      const updated = (result as any)?.value ?? result;
      if (!updated) return res.status(404).json({ message: 'Not found' });
      return res.json({ id: updated._id.toString(), ...updated });
    } catch (err) {
      console.error('Patch transaction error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // Statement import preview — CSV only for now (near-100% accurate across every
  // bank per the product doc's own assessment; PDF parsing is a separate, deferred
  // effort scoped to HDFC/ICICI). Read-only: never writes to the database. The
  // client reviews/unchecks rows, then commits the kept ones via POST /api/transactions/bulk.
  app.post(
    '/api/transactions/import/preview',
    authMiddleware,
    (req: any, res: any, next: any) => {
      statementUpload.single('file')(req, res, (err: any) => {
        // 413 (not 400): the client has a specific "try a shorter date range"
        // message for this status. Anything else reads as a generic failure.
        if (err?.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ message: 'That file is too large. Try exporting a shorter date range.' });
        }
        if (err) {
          console.error('Import preview multer error:', err);
          return res.status(400).json({ message: 'Invalid upload.' });
        }
        next();
      });
    },
    async (req: any, res: any) => {
      try {
        const file = (req as any).file;
        if (!file || !file.buffer) {
          return res.status(400).json({ message: 'file is required' });
        }

        // Sniff the bytes, not the multipart content-type: Android's document
        // picker reports files in Downloads as application/octet-stream, so
        // gating on mimetype alone rejects valid statements.
        const buf: Buffer = file.buffer;
        const name: string = file.originalname || '';
        const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || /\.pdf$/i.test(name);
        // xlsx is a zip ("PK"); xls is an OLE2 compound file.
        const isXlsx = buf.subarray(0, 2).toString('latin1') === 'PK' && /\.xlsx?$/i.test(name);
        const isXls = buf.subarray(0, 4).toString('hex') === 'd0cf11e0' || /\.xls$/i.test(name);

        if (isPdf) {
          return res.status(422).json({
            message: "PDF statements aren't supported yet. Please use your bank's CSV export from net banking.",
          });
        }
        if (isXlsx || isXls) {
          return res.status(422).json({
            message: "Excel statements aren't supported yet. Please use your bank's CSV export from net banking.",
          });
        }

        const isCsv = /\.csv$/i.test(name) || file.mimetype === 'text/csv';
        if (!isCsv) {
          return res.status(422).json({ message: 'Could not read this statement. Try the CSV export from your bank instead.' });
        }

        const text = buf.toString('utf-8');
        const { rows, rowsSkipped } = parseBankCsv(text);

        // A structurally-fine file that simply held no transactions is a 200
        // with an empty array ("No transactions found"), not an error. Only a
        // file we could not make sense of at all is a 422.
        if (rows.length === 0 && rowsSkipped === 0) {
          return res.json({ rows: [], meta: { format: 'csv', rowsFound: 0, rowsSkipped: 0 } });
        }
        if (rows.length === 0) {
          return res.status(422).json({ message: 'Could not read this statement. Try the CSV export from your bank instead.' });
        }

        // Categorisation is best-effort: it must never hold the preview hostage.
        // Batches of 50 run with bounded concurrency and an overall deadline —
        // previously this was 10-at-a-time strictly sequentially, so a 3000-row
        // statement meant 300 serial OpenAI round-trips (~10min) and the request
        // effectively never returned. Rows past the cap, or any batch that fails
        // or times out, simply fall back to 'others'.
        const openAIKey = getOpenAIKey();
        const categories: string[] = new Array(rows.length).fill('others');
        // Batch stays at 10: larger prompts overrun the model's output limit and
        // come back as truncated, unparseable JSON — a batch of 50 measured 249s
        // and yielded nothing. 10 returns in ~2s.
        const AI_ROW_CAP = 1000;
        const AI_BATCH = 10;
        const AI_CONCURRENCY = 4;
        const AI_DEADLINE_MS = 25_000;
        const AI_CALL_TIMEOUT_MS = 15_000;

        if (openAIKey) {
          const batches: { start: number; items: typeof rows }[] = [];
          for (let i = 0; i < Math.min(rows.length, AI_ROW_CAP); i += AI_BATCH) {
            batches.push({ start: i, items: rows.slice(i, i + AI_BATCH) });
          }

          const deadline = Date.now() + AI_DEADLINE_MS;
          let cursor = 0;
          const worker = async () => {
            while (cursor < batches.length && Date.now() < deadline) {
              const { start, items } = batches[cursor++];
              try {
                // The deadline above only gates between batches; race each call
                // so one slow response cannot outlive it.
                const out = await Promise.race([
                  categorizeTransactionsWithAI(
                    items.map((r) => ({ merchant: r.description, description: r.description })),
                    openAIKey,
                  ),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_CALL_TIMEOUT_MS)),
                ]);
                if (out) {
                  out.forEach((c, j) => {
                    if (c) categories[start + j] = c;
                  });
                }
              } catch (err) {
                console.error('Import preview categorization batch failed:', err);
              }
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(AI_CONCURRENCY, batches.length) }, worker),
          );
        }

        const dates = rows.map((r) => new Date(r.date).getTime());
        const outRows = rows.map((r, i) => ({
          date: r.date,
          description: r.description,
          amount: r.amount,
          isDebit: r.isDebit,
          suggestedCategory: toImportCategory(categories[i]),
          dedupeKey: r.dedupeKey,
        }));

        return res.json({
          rows: outRows,
          meta: {
            format: 'csv',
            rowsFound: outRows.length,
            rowsSkipped,
            confidence: rowsSkipped === 0 ? 'high' : 'medium',
            dateRange: {
              from: new Date(Math.min(...dates)).toISOString(),
              to: new Date(Math.max(...dates)).toISOString(),
            },
          },
        });
      } catch (err) {
        console.error('Import preview error:', err);
        return res.status(500).json({ message: 'Server error.' });
      }
    },
  );

  // Bulk transaction insert (statement/CSV import) — same shape as POST /api/transactions,
  // upserting on dedupeKey when present so overlapping re-imports don't duplicate rows.
  app.post('/api/transactions/bulk', authMiddleware, async (req, res) => {
    try {
      const { transactions: txs } = req.body;
      if (!Array.isArray(txs) || txs.length === 0) {
        return res.json({ saved: 0, skipped: 0, failed: 0 });
      }

      const userId = (req as any).userId;
      const memberIds = Array.from(
        new Set(txs.map((t) => t.memberId).filter((id) => !!id)),
      );
      const validMembers = memberIds.length
        ? await family.find({ userId, _id: { $in: memberIds.map((id) => toId(id)) } }).toArray()
        : [];
      const validMemberIdSet = new Set(validMembers.map((m: any) => m._id.toString()));

      let failed = 0;
      const ops = txs
        .map((t) => {
          if (!t.merchant || t.amount == null) {
            failed++;
            return null;
          }
          const dedupeKey = t.dedupeKey ? String(t.dedupeKey) : null;
          const doc: Record<string, any> = {
            userId,
            merchant: String(t.merchant),
            amount: Number(t.amount),
            category: normalizeCategory(t.category),
            date: t.date ? new Date(t.date).toISOString() : new Date().toISOString(),
            upiId: t.upiId || '',
            isDebit: t.isDebit !== false,
            description: t.description || '',
            memberId: t.memberId && validMemberIdSet.has(String(t.memberId)) ? String(t.memberId) : null,
            paymentMode: PAYMENT_MODES.includes(t.paymentMode) ? (t.paymentMode as PaymentMode) : 'upi',
            receiptUrl: t.receiptUrl || '',
            source: t.source || 'import',
          };

          if (dedupeKey) {
            doc.dedupeKey = dedupeKey;
            return {
              updateOne: {
                filter: { userId, dedupeKey },
                update: { $setOnInsert: doc },
                upsert: true,
              },
            };
          }
          return { insertOne: { document: doc } };
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);

      let result: any = { upsertedCount: 0, insertedCount: 0 };
      if (ops.length > 0) {
        try {
          result = await (transactions as any).bulkWrite(ops, { ordered: false });
        } catch (err: any) {
          // Duplicate-key errors from the unordered batch just mean "already imported" —
          // the rest of the batch still committed.
          if (err?.code === 11000 || err?.writeErrors) {
            result = err.result ?? err;
          } else {
            throw err;
          }
        }
      }

      const saved = (result.upsertedCount || 0) + (result.insertedCount || 0);
      const skipped = ops.length - saved;

      return res.json({ saved, skipped, failed });
    } catch (err) {
      console.error('Bulk transaction error:', err);
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
          category: normalizeCategory(t.category),
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

      let result;
      try {
        result = await (transactions as any).bulkWrite(ops, { ordered: false });
      } catch (err: any) {
        // Duplicate-key (11000) from the unique (userId, smsId) index just means
        // "already synced" — the rest of the unordered batch still committed.
        if (err?.code === 11000 || err?.writeErrors) {
          result = err.result ?? err;
        } else {
          throw err;
        }
      }

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

  // ----- Recurring Expense Templates -----
  function toRecurringDto(r: any) {
    return {
      id: r._id.toString(),
      name: r.name,
      amount: r.amount,
      category: r.category,
      dayOfMonth: r.dayOfMonth,
      memberId: r.memberId || null,
      paymentMode: (r.paymentMode as PaymentMode) || undefined,
      lastHandledPeriod: r.lastHandledPeriod || null,
      createdAt: r.createdAt,
    };
  }

  app.get('/api/recurring', authMiddleware, async (req, res) => {
    try {
      const list = await recurringExpenses.find({ userId: (req as any).userId }).sort({ createdAt: -1 }).toArray();
      return res.json(list.map(toRecurringDto));
    } catch (err) {
      console.error('Get recurring error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/recurring', authMiddleware, async (req, res) => {
    try {
      const { name, amount, category, dayOfMonth, memberId, paymentMode } = req.body;
      if (!name || amount == null || dayOfMonth == null) {
        return res.status(400).json({ message: 'name, amount and dayOfMonth are required' });
      }

      const userId = (req as any).userId;
      let resolvedMemberId: string | null = null;
      if (memberId) {
        const member = await family.findOne({ _id: toId(memberId), userId });
        resolvedMemberId = member ? String(memberId) : null;
      }

      const now = new Date();
      const doc = {
        userId,
        name: String(name).trim(),
        amount: Number(amount),
        category: (category as CategoryType) || 'others',
        dayOfMonth: clampDayOfMonth(Number(dayOfMonth), now.getFullYear(), now.getMonth()),
        memberId: resolvedMemberId,
        paymentMode: PAYMENT_MODES.includes(paymentMode) ? (paymentMode as PaymentMode) : undefined,
        lastHandledPeriod: null,
        createdAt: now,
      };
      const result = await recurringExpenses.insertOne(doc);
      return res.status(201).json(toRecurringDto({ _id: result.insertedId, ...doc }));
    } catch (err) {
      console.error('Post recurring error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.put('/api/recurring/:id', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).userId;
      const { name, amount, category, dayOfMonth, memberId, paymentMode } = req.body;

      const update: Record<string, any> = {};
      if (name !== undefined) update.name = String(name).trim();
      if (amount !== undefined) update.amount = Number(amount);
      if (category !== undefined) update.category = category as CategoryType;
      if (dayOfMonth !== undefined) {
        const now = new Date();
        update.dayOfMonth = clampDayOfMonth(Number(dayOfMonth), now.getFullYear(), now.getMonth());
      }
      if (paymentMode !== undefined) {
        update.paymentMode = PAYMENT_MODES.includes(paymentMode) ? (paymentMode as PaymentMode) : undefined;
      }
      if (memberId !== undefined) {
        if (memberId) {
          const member = await family.findOne({ _id: toId(memberId), userId });
          update.memberId = member ? String(memberId) : null;
        } else {
          update.memberId = null;
        }
      }

      const result = await recurringExpenses.updateOne({ _id: toId(id), userId }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ message: 'Not found' });
      const updated = await recurringExpenses.findOne({ _id: toId(id) });
      if (!updated) return res.status(404).json({ message: 'Not found' });
      return res.json(toRecurringDto(updated));
    } catch (err) {
      console.error('Put recurring error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.delete('/api/recurring/:id', authMiddleware, async (req, res) => {
    try {
      const result = await recurringExpenses.deleteOne({ _id: toId(req.params.id), userId: (req as any).userId });
      if (result.deletedCount === 0) return res.status(404).json({ message: 'Not found' });
      return res.status(204).send();
    } catch (err) {
      console.error('Delete recurring error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  app.post('/api/recurring/:id/handled', authMiddleware, async (req, res) => {
    try {
      const { period } = req.body;
      if (!period) return res.status(400).json({ message: 'period is required' });
      const result = await recurringExpenses.updateOne(
        { _id: toId(req.params.id), userId: (req as any).userId },
        { $set: { lastHandledPeriod: String(period) } },
      );
      if (result.matchedCount === 0) return res.status(404).json({ message: 'Not found' });
      return res.status(204).send();
    } catch (err) {
      console.error('Handle recurring error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }
  });

  // ----- Bills -----
  app.get('/api/bills', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const now = new Date();

      // Revert any snooze whose time has passed back to 'active'
      await bills.updateMany(
        {
          userId,
          status: 'snoozed',
          snoozedUntil: { $lte: now.toISOString() },
        },
        { $set: { status: 'active' } }
      );

      const list = await bills.find({ userId }).toArray();
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
      const requesterId = (req as any).userId;
      const billCount = await bills.countDocuments({ userId: requesterId });
      const limitHit = await checkLimit(requesterId, 'reminders', billCount);
      if (limitHit) return res.status(403).json(limitHit);

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
        // 🧠 BILL SCAN ENGINE v3
        // PRIMARY:  Google Cloud Vision API  → Puter.js LLM (structured JSON)
        // FALLBACK: Tesseract.js OCR         → Puter.js LLM
        // LAST:     Regex on raw OCR text
        // ============================
        const base64Image = file.buffer.toString('base64');
        const mimeType = (file.mimetype || 'image/jpeg') as string;

        let extractedAmount: number | null = null;
        let extractedDueDate: string | null = null;
        let extractedVendor: string = 'Scanned Bill';
        let extractionMethod = 'none';
        let rawOcrText = '';

        const parseAnyDate = (dateStr: string): string | null => {
          if (!dateStr) return null;
          const s = String(dateStr).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
          if (m1) {
            const day = m1[1].padStart(2, '0');
            const month = m1[2].padStart(2, '0');
            const year = m1[3];
            return `${year}-${month}-${day}`;
          }
          const m2 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
          if (m2) {
            const day = m2[1].padStart(2, '0');
            const month = m2[2].padStart(2, '0');
            const year = `20${m2[3]}`;
            return `${year}-${month}-${day}`;
          }
          return null;
        };
        const parseAmount = (val: any): number | null => {
          if (!val) return null;
          const n = parseFloat(String(val).replace(/[,₹Rs\s]/g, ''));
          return isNaN(n) || n <= 0 ? null : n;
        };

        const buildLlmPrompt = (ocrText: string) =>
          `You are an expert bill/invoice data extractor. Below is raw OCR text from a bill image.
RAW TEXT:\n---\n${ocrText}\n---
CRITICAL INSTRUCTION FOR due_date: Find the PAYMENT DUE DATE by looking for these exact label patterns (case-insensitive, with or without colon):
- "due date"
- "payment due"
- "pay by"
- "due on"
- "payable by"
- "last date"
- "last payment date"
Match the LABEL, then extract the date associated with it. Do NOT pick invoice date, statement period start/end, or bill date. If you cannot find a due date label, return null — do not guess or substitute.

Extract: 1) bill_amount: FINAL TOTAL payable (look for Total/Net Amount/Amount Payable/Net Payable/ભરવાની રકમ/कुल देय). 2) due_date: As described above — null if not found. Parse as DD/MM/YYYY from the bill, convert to YYYY-MM-DD format. 3) vendor: service provider name. 4) bill_type: electricity/water/gas/internet/telephone/other
RULES: ONLY valid JSON, no explanation. Return null for due_date if not found — never guess a date.
{"bill_amount": <number>, "due_date": "<YYYY-MM-DD or null>", "vendor": "<string>", "bill_type": "<string>"}`;

        const callPuterLlm = async (ocrText: string): Promise<boolean> => {
          const puterToken = process.env.PUTER_AUTH_TOKEN;
          if (!puterToken) {
            console.warn('[BillScan] PUTER_AUTH_TOKEN not set — skipping LLM extraction, falling back to regex.');
            return false;
          }
          try {
            puter.authToken = puterToken;
            const puterRes = await puter.ai.chat([{ role: 'user', content: buildLlmPrompt(ocrText) }]);
            let puterText = '';
            if (typeof puterRes === 'string') puterText = puterRes;
            else if (puterRes?.message?.content) {
              puterText = Array.isArray(puterRes.message.content)
                ? puterRes.message.content.map((c: any) => c.text || '').join('')
                : String(puterRes.message.content);
            } else if (puterRes?.text) puterText = String(puterRes.text);
            console.log('[BillScan] Puter LLM:', puterText.substring(0, 300));
            const jm = puterText.replace(/```json\n?|\n?```/g, '').match(/\{[\s\S]*\}/);
            if (jm) {
              const parsed = JSON.parse(jm[0]);
              const amt = parseAmount(parsed.bill_amount);
              if (amt && amt > 0) {
                extractedAmount = amt;
                extractedVendor = parsed.vendor || parsed.bill_type || 'Scanned Bill';
                if (parsed.due_date && parsed.due_date !== 'null') {
                  const pd = parseAnyDate(parsed.due_date);
                  if (pd) extractedDueDate = pd;
                }
                return true;
              }
            }
          } catch (e: any) {
            if (e?.status === 401 || e?.code === 'reauth_required') {
              console.error('[BillScan] Puter token expired/invalid — set a fresh PUTER_AUTH_TOKEN. Falling back to regex.');
            } else {
              console.error('[BillScan] Puter LLM error:', e);
            }
          }
          return false;
        };

        // ─── PRIMARY: Google Cloud Vision ───
        const visionKey = process.env.GOOGLE_VISION_API_KEY || process.env.GEMINI_API_KEY;
        if (visionKey) {
          try {
            console.log('[BillScan] Trying Google Cloud Vision API...');
            const vRes = await fetch(
              `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  requests: [{
                    image: { content: base64Image },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }]
                  }]
                })
              }
            );
            if (vRes.ok) {
              const vj = await vRes.json();
              const fullText = vj?.responses?.[0]?.fullTextAnnotation?.text || vj?.responses?.[0]?.textAnnotations?.[0]?.description || '';
              if (fullText.length > 10) {
                rawOcrText = fullText;
                console.log('[BillScan] Google Vision text (500):', rawOcrText.substring(0, 500));
                const ok = await callPuterLlm(rawOcrText);
                if (ok) extractionMethod = 'google-vision + puter-llm';
              }
            } else {
              console.error('[BillScan] Google Vision error:', vRes.status, (await vRes.text()).substring(0, 200));
            }
          } catch (e) { console.error('[BillScan] Google Vision exception:', e); }
        }

        // ─── FALLBACK: Tesseract.js ───
        if (!extractedAmount || extractedAmount === 0) {
          try {
            console.log('[BillScan] Falling back to Tesseract.js OCR...');
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker(['eng', 'hin', 'guj'], 1, { logger: () => {} });
            const { data: { text } } = await worker.recognize(file.buffer);
            await worker.terminate();
            rawOcrText = text.trim();
            if (rawOcrText.length > 10) {
              const ok = await callPuterLlm(rawOcrText);
              if (ok) extractionMethod = 'tesseract + puter-llm';
            }
          } catch (e) { console.error('[BillScan] Tesseract error:', e); }
        }

        // ─── LAST RESORT: Regex ───
        if ((!extractedAmount || extractedAmount === 0) && rawOcrText) {
          const amtPatterns = [
            /(?:total|net amount|amount payable|payable|net payable|bill amount|amount due)[^\d₹Rs]*[₹Rs]?\s*([\d,]+\.?\d{0,2})/gi,
            /[₹Rs]\s*([\d,]+\.?\d{0,2})/g, /([\d,]+\.\d{2})/g
          ];
          for (const pattern of amtPatterns) {
            const matches = [...rawOcrText.matchAll(pattern)];
            const amounts = matches.map(m => parseFloat(m[1].replace(/,/g, ''))).filter(n => n > 0 && n < 1000000);
            if (amounts.length > 0) { extractedAmount = Math.max(...amounts); extractionMethod = 'regex'; break; }
          }
          // Try multiple patterns to find due date label
          const duePatterns = [
            /(?:due date|payment due|pay by|due on|payable by|last date|last payment date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
            /due\s*date[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
            /payment.*?due[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
            /pay\s*by[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i
          ];
          for (const pattern of duePatterns) {
            const dm = rawOcrText.match(pattern);
            if (dm) {
              const pd = parseAnyDate(dm[1]);
              if (pd) {
                extractedDueDate = pd;
                break;
              }
            }
          }
          const vm = rawOcrText.match(/(DGVCL|PGVCL|MGVCL|UGVCL|BESCOM|MSEDCL|CESC|BSES|Airtel|BSNL|Jio|Tata|Adani|TORRENT)/i);
          if (vm) extractedVendor = vm[1];
        }

        // ─── RESPONSE ───
        let finalDueDate: string | null = null;
        let dateExtracted = false;
        if (extractedDueDate) {
          try {
            const d = new Date(extractedDueDate);
            if (!isNaN(d.getTime())) {
              const year = d.getUTCFullYear();
              const month = String(d.getUTCMonth() + 1).padStart(2, '0');
              const day = String(d.getUTCDate()).padStart(2, '0');
              finalDueDate = `${year}-${month}-${day}T00:00:00.000Z`;
              dateExtracted = true;
            }
          } catch (e) {
            console.error('[BillScan] Date parse error:', e);
          }
        }

        const finalAmount = extractedAmount && extractedAmount > 0 ? extractedAmount : 0;
        const overallConfidence = finalAmount > 0 && dateExtracted ? 95 : (finalAmount > 0 ? 70 : 40);
        console.log('[BillScan] ✅ FINAL:', { finalAmount, finalDueDate, extractedVendor, dateExtracted, extractionMethod });

        return res.json({
          preview: {
            name: extractedVendor, amount: finalAmount, dueDate: finalDueDate,
            category: 'bills' as CategoryType, icon: 'receipt', source: 'scan_bill',
            imageKey: key, imageUrl: `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`,
          },
          metadata: {
            bill_amount: finalAmount, due_date: finalDueDate,
            status: finalAmount > 0 ? 'success' : 'partial',
            confidence: overallConfidence,
            method: extractionMethod,
            note: !finalDueDate ? 'Due date not detected. Please enter manually.' : (finalAmount === 0 ? 'Amount not detected. Please enter manually.' : undefined)
          }
        });

      } catch (err) {
        console.error('Bill scan error:', err);
        return res.status(500).json({ message: 'Server error during bill scan.' });
      }
    },
  );

  // Scan Bill Commit (create a bill reminder from validated preview)
  app.post('/api/bills/scan/commit', authMiddleware, async (req: any, res: any) => {
    try {
      const requesterId = (req as any).userId;
      const scanUsage = await getOrCreateUsage(requesterId);
      const limitHit = await checkLimit(requesterId, 'billScanPerMonth', scanUsage.billScanPerMonth);
      if (limitHit) return res.status(403).json(limitHit);

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

      const scanYearMonth = currentYearMonth();
      await usage.updateOne(
        { userId: requesterId, yearMonth: scanYearMonth },
        { $set: { billScanPerMonth: (Number(scanUsage.billScanPerMonth) || 0) + 1 } },
      );

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
      if (body.imageUrl !== undefined) update.imageUrl = body.imageUrl;
      if (body.imageKey !== undefined) update.imageKey = body.imageKey;
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

        const requesterId = (req as any).userId;
        const voiceUsage = await getOrCreateUsage(requesterId);
        const limitHit = await checkLimit(requesterId, 'voiceReminderPerMonth', voiceUsage.voiceReminderPerMonth);
        if (limitHit) return res.status(403).json(limitHit);

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
  
        const normalized = await normalizeTranscriptScript({
          text: transcript,
          languageHint: tJson.language || null,
          apiKey: openAIKey,
        });

        const parsed = await normalizeAndParseVoiceReminderWithAI(normalized.text, normalized.language);

        const voiceYearMonth = currentYearMonth();
        await usage.updateOne(
          { userId: requesterId, yearMonth: voiceYearMonth },
          { $set: { voiceReminderPerMonth: (Number(voiceUsage.voiceReminderPerMonth) || 0) + 1 } },
        );

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
The user provides an already-normalized transcript in English, Hindi, or Gujarati (or mixed).
Task: Extract reminder data in strict JSON.

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
Language Hint: ${languageHint || 'unknown'}

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
        normalizedText: text,
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
          category: { $nin: LEAK_EXEMPT_CATEGORIES }
        }).sort({ date: -1 }).toArray(),
        bills.find({ userId }).toArray()
      ]);

      const merchantFreq: Record<string, { count: number; total: number; category: CategoryType; amounts: number[]; lastDate: Date; firstDate: Date }> = {};
      txList.forEach((t: any) => {
        const merchant = String(t.merchant || 'Unknown');
        const txDate = new Date(t.date);
        if (!merchantFreq[merchant]) {
          merchantFreq[merchant] = {
            count: 0,
            total: 0,
            category: (t.category as CategoryType) || 'others',
            amounts: [],
            lastDate: txDate,
            firstDate: txDate
          };
        }
        merchantFreq[merchant].count++;
        merchantFreq[merchant].total += t.amount;
        merchantFreq[merchant].amounts.push(t.amount);
        if (txDate > merchantFreq[merchant].lastDate) merchantFreq[merchant].lastDate = txDate;
        if (txDate < merchantFreq[merchant].firstDate) merchantFreq[merchant].firstDate = txDate;
      });

      const leaks: any[] = [];
      const now = new Date();

      // 1. Transaction Frequency & Price Hikes
      Object.entries(merchantFreq).forEach(([merchant, data]) => {
        // Frequency Leak
        if (data.count >= 3) {
          const freq = data.count >= 15 ? 'Daily' : data.count >= 8 ? 'Frequently' : 'Weekly';
          const spanDays = Math.max(1, (data.lastDate.getTime() - data.firstDate.getTime()) / (1000 * 60 * 60 * 24));
          const spanMonths = Math.max(1, spanDays / 30);
          const monthlyEstimate = Math.round(data.total / spanMonths);
          
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
        if (LEAK_EXEMPT_CATEGORIES.includes(bill.category)) return;
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

  // ----- AI Assistant Context Endpoint -----
  app.get('/api/assistant/context', authMiddleware, async (req, res) => {
    try {
      const [userDoc, recentTx, recentBills, familyMembers] = await Promise.all([
        users.findOne({ _id: toId((req as any).userId) }),
        transactions.find({ userId: (req as any).userId }).sort({ date: -1 }).limit(50).toArray(),
        bills.find({ userId: (req as any).userId }).limit(20).toArray(),
        family.find({ userId: (req as any).userId }).limit(10).toArray(),
      ]);

      const leakList = await transactions
        .find({
          userId: (req as any).userId,
          isDebit: true,
          category: { $nin: LEAK_EXEMPT_CATEGORIES },
        })
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
          medicines: m.medicines,
        })),
      };

      return res.json(snapshot);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch context' });
    }
  });

  // ----- AI Assistant (Assistants API: Conversly asst_WmTjqjLyo3ki1MFHtqDtal6R, or fallback chat completions) -----
  app.post('/api/assistant/chat', authMiddleware, async (req, res) => {
    try {
      const openAIKey = getOpenAIKey();
      if (!openAIKey) {
        return res.status(500).json({ message: 'Assistant is not configured. Set OPENAI_API_KEY.' });
      }

      const requesterId = (req as any).userId;
      const wiseAiUsage = await getOrCreateUsage(requesterId);
      const limitHit = await checkLimit(requesterId, 'wiseAiPerMonth', wiseAiUsage.wiseAiPerMonth);
      if (limitHit) return res.status(403).json(limitHit);

      const body = req.body as {
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
      };
      const userMessages = Array.isArray(body.messages) ? body.messages : [];

      const [userDoc, recentTx, recentBills, familyMembers, recentLogs] = await Promise.all([
        users.findOne({ _id: toId((req as any).userId) }),
        transactions.find({ userId: (req as any).userId }).sort({ date: -1 }).limit(50).toArray(),
        bills.find({ userId: (req as any).userId }).limit(20).toArray(),
        family.find({ userId: (req as any).userId }).limit(10).toArray(),
        healthReadings.find({ userId: (req as any).userId }).sort({ date: -1 }).limit(30).toArray(),
      ]);

      const leakList = await transactions
        .find({
          userId: (req as any).userId,
          isDebit: true,
          category: { $nin: LEAK_EXEMPT_CATEGORIES },
        })
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
        healthLogs: recentLogs.map((l: any) => ({
          type: l.type,
          value: l.value,
          unit: l.unit,
          notes: l.notes,
          date: l.date,
          memberId: l.memberId
        })),
        leaks: leaksSnapshot,
        family: familyMembers.map((m: any) => ({
          id: m._id,
          name: m.name,
          relationship: m.relationship,
          medicinesCount: Array.isArray(m.medicines) ? m.medicines.length : 0,
          medicines: m.medicines,
        })),
      };

      const sysPrompt = `You are LifeWise AI, an expert, multilingual family, health and financial assistant for the 'LifeWise' app.
You have access to the user's latest data snapshot in JSON format:
${JSON.stringify(snapshot)}

CRITICAL RULES:
1. STRICT SCOPE: You MUST ONLY answer questions related to the user's finances, health, family, bills, budget, or the LifeWise app.
2. OUT OF SCOPE: If the user asks general knowledge questions, coding questions, or anything completely unrelated to this app, YOU MUST REFUSE and politely state that you can only assist with LifeWise-related topics (Finances, Health, Family).
3. Be polite, concise, and highly accurate (100% accurate). Use simple Gujarati, Hindi, or English based on the user's language.
4. Scan EVERYTHING in the snapshot before answering.
5. If asked about Health (blood pressure, sugar, etc.), thoroughly check 'healthLogs'.
6. If asked about family members, check 'family'. If asked about medicines, check 'family.medicines'.
7. DO NOT invent data. If you don't know, say so.`;

      const chatMessages = [
        { role: 'system', content: sysPrompt },
        ...userMessages.filter(m => m.role === 'user' || m.role === 'assistant')
      ];

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAIKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: chatMessages,
          temperature: 0.4,
        }),
      });

      if (!aiRes.ok) {
        const errBody = await aiRes.text();
        throw new Error(`openai_chat_failed: ${aiRes.status} ${errBody}`);
      }

      const json = await aiRes.json();
      const reply = json.choices?.[0]?.message?.content || 'Sorry, I could not generate a response right now.';

      const yearMonth = currentYearMonth();
      await usage.updateOne(
        { userId: requesterId, yearMonth },
        { $set: { wiseAiPerMonth: (Number(wiseAiUsage.wiseAiPerMonth) || 0) + 1 } },
      );

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
      const requesterId = (req as any).userId;
      const { action } = req.body as { action: 'taken' | 'snooze' | 'skip' };
      const member = await family.findOne({
        _id: toId(memberId),
        $or: [{ userId: requesterId }, { 'connectedCaregivers.userId': requesterId }],
      });
      if (!member) {
        return res.status(404).json({ message: 'Family member not found' });
      }
      const permissions = resolveRequesterPermissions(member, requesterId)!;
      if (!canAccessModule(permissions, 'medicines')) {
        return res.status(403).json({ message: 'Not permitted to access this module' });
      }
      // taken/snooze/skip are all completion-flavored actions, so `mark_done`
      // is always sufficient here (§6.2) — this route never edits the
      // medicine's own fields (name, dosage, schedule, etc).
      if (!hasAccessLevel(permissions, 'mark_done')) {
        return res.status(403).json({ message: 'Not permitted to make this change' });
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
        { _id: toId(memberId) },
        { $set: { medicines: updatedMeds } },
      );

      // Log the event
      await medicineLogs.insertOne({
        userId: requesterId,
        memberId,
        medId,
        action, // 'taken' | 'snooze' | 'skip'
        timestamp: now,
      } as any);

      const updated = (await family.findOne({ _id: toId(memberId) })) as any;
      if (!updated) {
        return res.status(500).json({ message: 'Failed to load updated member' });
      }

      // Notify other connected caregivers to refetch, so a mark-done by one
      // caregiver shows up for everyone else without waiting on their own poll.
      try {
        const otherRecipientIds = getRecipientUserIds(updated).filter((id) => id !== requesterId);
        if (otherRecipientIds.length) {
          const tokenDocs = await pushTokens
            .find({ userId: { $in: otherRecipientIds } })
            .project({ token: 1, userId: 1, _id: 0 })
            .toArray();
          await sendPushToTokenDocs(getFirebaseMessaging(), pushTokens, tokenDocs, {
            data: { type: 'sync', memberId, medId },
          });
        }
      } catch (syncErr) {
        console.error('Medicine sync push error:', syncErr);
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

  // Owner + all accepted caregivers for a family member — used to fan out
  // reminders/alerts to everyone connected, not just the owner.
  function getRecipientUserIds(member: any): string[] {
    const ids = new Set<string>([String(member.userId)]);
    for (const c of Array.isArray(member.connectedCaregivers) ? member.connectedCaregivers : []) {
      if (c?.userId) ids.add(String(c.userId));
    }
    return Array.from(ids);
  }

  // Silent data-only push to every connected caregiver except the one who
  // just made the change, so a mark-done/status update by one caregiver
  // shows up for everyone else without waiting on their own poll. Never
  // throws — a push failure must not fail the mutation that triggered it.
  function notifyOtherCaregivers(member: any, requesterId: string, data: Record<string, any>): void {
    (async () => {
      try {
        const otherRecipientIds = getRecipientUserIds(member).filter((id) => id !== requesterId);
        if (!otherRecipientIds.length) return;
        const tokenDocs = await pushTokens
          .find({ userId: { $in: otherRecipientIds } })
          .project({ token: 1, userId: 1, _id: 0 })
          .toArray();
        await sendPushToTokenDocs(getFirebaseMessaging(), pushTokens, tokenDocs, { data });
      } catch (syncErr) {
        console.error('Caregiver sync push error:', syncErr);
      }
    })();
  }

  // ----- Reminder scheduler (email + in-app) -----
  const REMINDER_CHECK_INTERVAL_MS = 60_000;
  const REMINDER_WINDOW_MINUTES = 5;
  // Advance reminders ("N days before") are day-based, not minute-based: they
  // should land at a predictable hour on the right day, not only when the
  // bill's exact due timestamp happens to fall inside the 5-minute scheduler
  // window — which for a bill days away is never. Server local time; if
  // per-user timezones are required this needs to move to a per-user check.
  const REMINDER_SEND_HOUR = 9;

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

            let shouldSend: boolean;
            if (daysLeft === 0) {
              // Same-day: fire near the actual due time, as before.
              shouldSend =
                baseDate.getTime() >= now.getTime() - 60 * 1000 &&
                baseDate.getTime() <= windowEnd.getTime();
              // Catch up a same-day bill whose due time already passed while the
              // server was down or busy. reminderLogs dedup below still enforces
              // exactly one send per (bill, dayOffset).
              if (!shouldSend && baseDate.getTime() < now.getTime()) shouldSend = true;
            } else {
              // Advance reminder: fire once at/after the send hour. ">=" (not
              // "==") means a tick missed around a restart still catches up
              // later the same day; dedup guarantees it only sends once.
              shouldSend = now.getHours() >= REMINDER_SEND_HOUR;
            }

            if (!shouldSend) continue;

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
                // Amounts are stored in INR (see exchange-rates.ts); convert to the
                // user's preferred currency for display only, using the latest known
                // daily rate. Never rewrite the stored amount.
                const userCurrency = isSupportedPreferredCurrency((user as any).preferredCurrency)
                  ? (user as any).preferredCurrency
                  : 'INR';
                const rawAmount = bill.amount || 0;
                let displayAmount = rawAmount;
                if (userCurrency !== 'INR') {
                  const latestRate = await getRateOnOrBefore(exchangeRates, new Date().toISOString().slice(0, 10));
                  const rate = latestRate?.rates?.[userCurrency];
                  if (typeof rate === 'number') displayAmount = rawAmount * rate;
                }

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
                  amount: displayAmount,
                  currencyCode: userCurrency as 'INR' | SupportedCurrency,
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

                // Only use an image the bill actually has — never fabricate one.
                // This used to fall back to a dicebear.com abstract avatar, which
                // isn't the app logo and made rendering depend on a third-party
                // service being reachable.
                const imageUrl: string | undefined = bill.imageUrl || undefined;

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

                try {
                  // Client spec §2: the push notification's own title gets the
                  // "Reminder: " prefix; the in-app notifications-list title above
                  // stays as the bare bill name (that list is already under a
                  // "Reminders" heading, so re-prefixing there would be redundant).
                  await sendPushToUser(getFirebaseMessaging(), pushTokens, user._id?.toString?.() ?? user._id, {
                    title: personalReminderNotificationTitle(title),
                    body,
                    imageUrl,
                    channelId: 'default',
                    categoryId: REMINDER_ACTIONS_CATEGORY,
                    data: {
                      type: 'reminder',
                      billId: meta.billId,
                      route: meta.route,
                    },
                  });
                } catch (err) {
                  console.error('FCM send error:', err);
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

                // Fire in the normal 5-minute window, or any time after if the
                // dose was missed earlier today (e.g. a server restart at dose
                // time) — logId is scoped to today's date, so dedup still caps
                // this at one send per slot per day.
                const withinWindow =
                  doseTime.getTime() <= windowEnd.getTime() &&
                  (doseTime.getTime() >= now.getTime() - 60 * 1000 || doseTime.getTime() < now.getTime());

                if (!withinWindow) continue;

                // §7: exclude any caregiver not permitted to see the medicines module.
                const recipientIds = getRecipientUserIds(member).filter((id) => {
                  const permissions = resolveRequesterPermissions(member, id);
                  return !!permissions && canAccessModule(permissions, 'medicines');
                });
                const recipientUsers = await users.find({ _id: { $in: recipientIds.map((id) => toId(id)) } }).toArray();
                if (!recipientUsers.length) continue;

                const logId = `med-${member._id}-${med.id}-${slotKey}-${doseTime.toISOString().slice(0, 10)}`;
                // Client spec §2: Family Hub reminder title format.
                const title = familyReminderNotificationTitle(member.name, med.name);
                const body = `Take ${med.name} (${med.dosage || '1 dose'}) - ${slotKey.charAt(0).toUpperCase() + slotKey.slice(1)}`;
                const route = `/medicine-details/${member._id.toString()}/${med.id}`;

                const freshRecipients: any[] = [];
                for (const recipient of recipientUsers) {
                  const already = await reminderLogs.findOne({
                    userId: recipient._id.toString(),
                    billId: logId, // using billId field for med log uniqueness
                    channel: 'in_app',
                  });
                  if (already) continue;
                  freshRecipients.push(recipient);
                }
                if (!freshRecipients.length) continue;

                for (const recipient of freshRecipients) {
                  await notifications.insertOne({
                    userId: recipient._id.toString(),
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
                }

                {
                  // §7: view-level caregivers get the reminder but not the
                  // Snooze/Done buttons (they can't act on either).
                  const buttonEligible = freshRecipients.filter((r: any) =>
                    hasAccessLevel(resolveRequesterPermissions(member, r._id.toString()) || { allowedModules: [], accessLevel: 'view' }, 'mark_done'),
                  );
                  const viewOnly = freshRecipients.filter((r: any) => !buttonEligible.includes(r));

                  const sendGroup = async (recipients: any[], categoryId?: string) => {
                    if (!recipients.length) return;
                    const tokenDocs = await pushTokens
                      .find({ userId: { $in: recipients.map((r: any) => r._id.toString()) } })
                      .project({ token: 1, userId: 1, _id: 0 })
                      .toArray();
                    // memberId/medId are required, not just route — the client rebuilds
                    // navigation state from these fields, not by parsing the route string.
                    await sendPushToTokenDocs(getFirebaseMessaging(), pushTokens, tokenDocs, {
                      title,
                      body,
                      channelId: 'default',
                      ...(categoryId ? { categoryId } : {}),
                      data: { type: 'medication', memberId: member._id.toString(), medId: med.id, route },
                    });
                  };

                  await sendGroup(buttonEligible, REMINDER_ACTIONS_CATEGORY);
                  await sendGroup(viewOnly);
                }

                for (const recipient of freshRecipients) {
                  await reminderLogs.insertOne({
                    userId: recipient._id.toString(),
                    billId: logId,
                    channel: 'in_app',
                    dayOffset: 0,
                    sentAt: new Date()
                  });
                }
              }
            } catch (medErr) {
              console.error('Med reminder error:', medErr);
            }
          }
        }

        // --- Family Hub Phase 3: projected reminder push notifications ---
        // Fans out to owner + connected caregivers, same as medicine reminders above.
        // Dedup key mirrors the bill scheduler: (userId, billId=natural key, channel, dayOffset).
        for (const member of allFamily) {
          let projected: ProjectedFamilyReminder[];
          try {
            projected = projectFamilyReminders([member]);
          } catch (projErr) {
            console.error('Family reminder projection error:', projErr);
            continue;
          }

          for (const reminder of projected) {
            try {
              const due = new Date(reminder.dueDate);
              if (Number.isNaN(due.getTime())) continue;

              // Client spec §4.4: recurring kinds (routine, checkin) fire at
              // recurrence.hour:minute on each weekday in recurrence.weekdays
              // (empty = every day) — never off dueDate, which is only a
              // derived "next occurrence" for sorting/display. Everything
              // else fires at day- or minute-based offsets before dueDate.
              const fireSlots: { fireAt: Date; offsetLabel: number; offsetUnit: 'days' | 'minutes' }[] = [];

              if (reminder.recurrence) {
                const { hour, minute, weekdays } = reminder.recurrence;
                const matchesToday = weekdays.length === 0 || weekdays.includes(now.getDay());
                if (matchesToday) {
                  const candidate = new Date(now);
                  candidate.setHours(hour, minute, 0, 0);
                  fireSlots.push({ fireAt: candidate, offsetLabel: 0, offsetUnit: 'minutes' });
                }
              } else if (reminder.leadMinutes && reminder.leadMinutes.length) {
                // Client spec §4.3: sub-day lead time (appointment reminderLead,
                // travel reminderHoursBefore) — replaces reminderDaysBefore.
                for (const minutesBefore of reminder.leadMinutes) {
                  fireSlots.push({
                    fireAt: new Date(due.getTime() - minutesBefore * 60 * 1000),
                    offsetLabel: minutesBefore,
                    offsetUnit: 'minutes',
                  });
                }
              } else {
                for (const daysBefore of reminder.reminderDaysBefore) {
                  let fireAt = new Date(due.getTime() - daysBefore * 24 * 60 * 60 * 1000);
                  // Client spec §4.2: a day-based offset on a date-only record
                  // (no real time of day) fires at 09:00 local, not midnight.
                  // Records with a genuine time of day keep it.
                  if (!reminder.hasExplicitTime) {
                    fireAt = new Date(fireAt);
                    fireAt.setHours(REMINDER_SEND_HOUR, 0, 0, 0);
                  }
                  fireSlots.push({ fireAt, offsetLabel: daysBefore, offsetUnit: 'days' });
                }
              }

              for (const { fireAt, offsetLabel, offsetUnit } of fireSlots) {
                // Skip lead times already in the past — a record added on/after its due
                // date must not fire a burst of backdated alerts (spec §4.3).
                if (fireAt.getTime() < now.getTime() - 60 * 1000) continue;

                const withinWindow = fireAt.getTime() <= windowEnd.getTime();
                if (!withinWindow) continue;

                // reminderLogs.dayOffset is a plain number shared with the bill
                // scheduler, which only ever uses non-negative day counts — encode
                // a minute-based offset as a distinct negative number so it can
                // never collide with a real day-based dedupe entry.
                const dayOffset = offsetUnit === 'days' ? offsetLabel : -(offsetLabel + 1);

                // §7: a caregiver must not be notified about a module they can't
                // see — filter recipients by allowedModules before anything is
                // logged or pushed, not just at read time.
                const reminderModuleKey = SOURCE_KIND_TO_MODULE[reminder.sourceKind];
                const recipientIds = getRecipientUserIds(member).filter((id) => {
                  const permissions = resolveRequesterPermissions(member, id);
                  return !!permissions && (!reminderModuleKey || canAccessModule(permissions, reminderModuleKey));
                });
                const recipientUsers = await users.find({ _id: { $in: recipientIds.map((id) => toId(id)) } }).toArray();
                if (!recipientUsers.length) continue;

                // Client spec §2: the notification/push title uses the
                // "Family Hub: <member> – <title>" format (reminder.recordTitle,
                // the bare record title with no member suffix). The body still
                // composes off reminder.name ("<title> · <memberName>") — that's
                // an unrelated, already-correct format for the body sentence
                // ("… · Papa in 3 days" would read fine either way, but changing
                // it isn't what was asked for here).
                const title = familyReminderNotificationTitle(reminder.memberName, reminder.recordTitle);
                const body = offsetUnit === 'days'
                  ? notificationBody(reminder.name, offsetLabel)
                  : notificationBodyMinutes(reminder.name, offsetLabel);
                const route = `/family-reminder/${reminder.id}`;

                // Daily/weekday-repeating kinds (routines, check-ins) reuse the same
                // reminder.id every occurrence — their dueDate is always "next
                // occurrence," not a fixed date. Without a calendar-day component,
                // the very first fire would permanently dedupe every subsequent
                // day's occurrence. One-off kinds don't need this: their dueDate
                // never recurs, so (reminder.id, dayOffset) alone is unique per
                // real-world event.
                const dedupeBillId = reminder.repeatType === 'daily'
                  ? `${reminder.id}:${localDateKey(fireAt)}`
                  : reminder.id;

                const freshRecipients: any[] = [];
                for (const recipient of recipientUsers) {
                  const already = await reminderLogs.findOne({
                    userId: recipient._id.toString(),
                    billId: dedupeBillId,
                    channel: 'in_app',
                    dayOffset,
                  });
                  if (already) continue;
                  freshRecipients.push(recipient);
                }
                if (!freshRecipients.length) continue;

                for (const recipient of freshRecipients) {
                  await notifications.insertOne({
                    userId: recipient._id.toString(),
                    type: 'reminder',
                    title,
                    body,
                    read: false,
                    createdAt: new Date(),
                    meta: {
                      type: 'family-reminder',
                      memberId: reminder.memberId,
                      reminderId: reminder.id,
                      sourceKind: reminder.sourceKind,
                      sourceId: reminder.sourceId,
                      referenceId: reminder.sourceId,
                      route,
                      redirectUrl: route,
                    },
                  });
                }

                try {
                  // §7: a view-level caregiver gets the reminder push but not the
                  // Snooze/Done buttons — those imply write access they don't have,
                  // and the actions are rejected server-side regardless (see the
                  // family-reminder Done/Snooze handler) but the buttons shouldn't
                  // render as usable in the first place.
                  const buttonEligible = freshRecipients.filter((r: any) =>
                    hasAccessLevel(resolveRequesterPermissions(member, r._id.toString()) || { allowedModules: [], accessLevel: 'view' }, 'mark_done'),
                  );
                  const viewOnly = freshRecipients.filter((r: any) => !buttonEligible.includes(r));

                  const sendGroup = async (recipients: any[], categoryId?: string) => {
                    if (!recipients.length) return;
                    const tokenDocs = await pushTokens
                      .find({ userId: { $in: recipients.map((r: any) => r._id.toString()) } })
                      .project({ token: 1, userId: 1, _id: 0 })
                      .toArray();
                    // memberId/reminderId/sourceKind/sourceId are all required per the
                    // client's payload spec (§4.5) — reminderId is the same
                    // fam:<kind>:<memberId>:<sourceId> composite as reminder.id, sent
                    // explicitly so the client doesn't have to reconstruct it.
                    await sendPushToTokenDocs(getFirebaseMessaging(), pushTokens, tokenDocs, {
                      title,
                      body,
                      channelId: 'default',
                      ...(categoryId ? { categoryId } : {}),
                      data: {
                        type: 'family-reminder',
                        memberId: reminder.memberId,
                        reminderId: reminder.id,
                        sourceKind: reminder.sourceKind,
                        sourceId: reminder.sourceId,
                        route,
                      },
                    });
                  };

                  await sendGroup(buttonEligible, REMINDER_ACTIONS_CATEGORY);
                  await sendGroup(viewOnly);
                } catch (pushErr) {
                  console.error('Family reminder FCM send error:', pushErr);
                }

                for (const recipient of freshRecipients) {
                  await reminderLogs.insertOne({
                    userId: recipient._id.toString(),
                    billId: dedupeBillId,
                    channel: 'in_app',
                    dayOffset,
                    sentAt: new Date(),
                  });
                }
              }
            } catch (famReminderErr) {
              console.error('Family reminder scheduler error:', famReminderErr);
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
  startDailyExchangeRateJob(exchangeRates);

  // ----- Emergency Alerts scheduler (missed-medicine notifications) -----
  // Notifies the owner and all accepted connected caregivers (see getRecipientUserIds).
  const EMERGENCY_CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

  function findMissedMedicines(medicines: any[], thresholdHours: number): any[] {
    const now = new Date();
    const thresholdMs = (Number(thresholdHours) || 4) * 60 * 60 * 1000;
    return (Array.isArray(medicines) ? medicines : []).filter((med: any) => {
      if (med.lastStatus !== 'pending') return false;
      const slots = med.slots || {};
      return Object.values(slots).some((slotTime: any) => {
        if (!slotTime) return false;
        const [time, ampm] = String(slotTime).split(' ');
        let [hh, mm] = time.split(':').map(Number);
        if (ampm === 'PM' && hh < 12) hh += 12;
        if (ampm === 'AM' && hh === 12) hh = 0;
        const doseTime = new Date(now);
        doseTime.setHours(hh, mm, 0, 0);
        return now.getTime() - doseTime.getTime() > thresholdMs;
      });
    });
  }

  function startEmergencyAlertScheduler() {
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const members = await family.find({ 'emergencySettings.missedMedicineAlertEnabled': true }).toArray();
        for (const member of members) {
          try {
            const settings = (member as any).emergencySettings || {};
            const missed = findMissedMedicines((member as any).medicines, settings.missedMedicineThresholdHours);
            if (missed.length === 0) continue;

            const recipientIds = getRecipientUserIds(member as any);
            const recipientUsers = await users.find({ _id: { $in: recipientIds.map((id) => toId(id)) } }).toArray();
            if (!recipientUsers.length) continue;

            const title = `Missed medicine alert: ${member.name}`;
            const body = `${missed.length} dose${missed.length > 1 ? 's' : ''} missed for ${member.name}: ${missed.map((m: any) => m.name).join(', ')}`;
            const logEntry = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              type: 'missed_medicine',
              message: body,
              medicineIds: missed.map((m: any) => m.id),
              createdAt: new Date(),
              acknowledged: false,
            };

            await family.updateOne(
              { _id: (member as any)._id },
              { $push: { emergencyLog: logEntry } } as any,
            );

            for (const recipient of recipientUsers) {
              await notifications.insertOne({
                userId: recipient._id.toString(),
                type: 'alert',
                title,
                body,
                read: false,
                createdAt: new Date(),
                meta: { type: 'emergency', memberId: (member as any)._id.toString() },
              } as any);
            }

            {
              const tokenDocs = await pushTokens
                .find({ userId: { $in: recipientUsers.map((r: any) => r._id.toString()) } })
                .project({ token: 1, userId: 1, _id: 0 })
                .toArray();
              await sendPushToTokenDocs(getFirebaseMessaging(), pushTokens, tokenDocs, {
                title,
                body,
                channelId: 'default',
                data: { type: 'emergency', memberId: (member as any)._id.toString() },
              });
            }
          } catch (memberErr) {
            console.error('Emergency alert per-member error:', memberErr);
          }
        }
      } catch (err) {
        console.error('Emergency alert scheduler error:', err);
      } finally {
        running = false;
      }
    }, EMERGENCY_CHECK_INTERVAL_MS);
  }

  startEmergencyAlertScheduler();

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

  app.put('/api/admin/plans/:id', adminAuthMiddleware, async (req, res) => {
    try {
      const update = { ...req.body, updatedAt: new Date() };
      delete update._id;
      const result = await plans.updateOne({ _id: toId(req.params.id) }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ message: 'Plan not found' });
      const updated = await plans.findOne({ _id: toId(req.params.id) });
      res.json(updated);
    } catch (err) {
      console.error('Admin plans update error:', err);
      res.status(500).json({ message: 'Failed to update plan' });
    }
  });

  app.delete('/api/admin/plans/:id', adminAuthMiddleware, async (req, res) => {
    try {
      const result = await plans.deleteOne({ _id: toId(req.params.id) });
      if (result.deletedCount === 0) return res.status(404).json({ message: 'Plan not found' });
      res.json({ ok: true });
    } catch (err) {
      console.error('Admin plans delete error:', err);
      res.status(500).json({ message: 'Failed to delete plan' });
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
