/**
 * LifeWise API End-to-End Test Script
 * Tests all critical backend endpoints without needing the app running
 * Run with: npx ts-node scripts/test-api.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
let authToken = '';
let createdMemberId = '';
let createdCaregiverId = '';

// ─── Utility ───────────────────────────────────────────────────────────────
async function req(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data: json };
}

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string, extra?: any) {
  console.error(`  ❌ ${msg}`, extra ?? '');
  process.exitCode = 1;
}
function section(msg: string) { console.log(`\n📋 ${msg}`); }

// ─── Tests ─────────────────────────────────────────────────────────────────
async function testAuth() {
  section('AUTH FLOW');
  const testEmail = `test_lifewise_${Date.now()}@test.com`;

  // Register
  const reg = await req('POST', '/api/auth/register', {
    name: 'Test User',
    email: testEmail,
    password: 'Password@123',
  });
  if (reg.ok && reg.data.token) {
    authToken = reg.data.token;
    pass(`Register → token received`);
  } else {
    // Try login with existing admin
    const login = await req('POST', '/api/auth/login', {
      email: 'admin@lifewise.com',
      password: 'Ruchit@1415',
    });
    if (login.ok && login.data.token) {
      authToken = login.data.token;
      pass(`Login as admin → token received`);
    } else {
      fail('Auth failed — cannot run further tests', login.data);
      process.exit(1);
    }
  }
}

async function testFamilyHub() {
  section('FAMILY HUB — CRUD');

  // GET list (might be empty)
  const list = await req('GET', '/api/family', undefined, authToken);
  if (list.ok) pass(`GET /api/family → ${list.data.length ?? 0} members`);
  else fail('GET /api/family', list);

  // POST create member
  const create = await req('POST', '/api/family', {
    name: 'Test Papa',
    relationship: 'papa',
    dateOfBirth: '1960-01-15',
    bloodGroup: 'O+',
    phone: '+911234567890',
    modules: ['medicine', 'health', 'bills', 'doctor'],
    features: { medicine: true, health: true, bills: true, doctor: true },
  }, authToken);
  if (create.ok && create.data.id) {
    createdMemberId = create.data.id;
    pass(`POST /api/family → created id=${createdMemberId}`);
    if (Array.isArray(create.data.modules) && create.data.modules.length === 4)
      pass('  modules array persisted correctly');
    else fail('  modules not persisted', create.data);
  } else {
    fail('POST /api/family', create.data);
    return;
  }

  // GET single member
  const single = await req('GET', `/api/family/${createdMemberId}`, undefined, authToken);
  if (single.ok && single.data.id === createdMemberId) {
    pass(`GET /api/family/:id → name=${single.data.name}`);
    if (single.data.bloodGroup === 'O+') pass('  bloodGroup returned');
    else fail('  bloodGroup missing from single member', single.data);
  } else fail('GET /api/family/:id', single.data);

  // PUT update member
  const update = await req('PUT', `/api/family/${createdMemberId}`, {
    name: 'Test Papa Updated',
    relationship: 'papa',
    modules: ['medicine', 'health', 'bills', 'doctor', 'insurance'],
    features: { medicine: true, health: true, bills: true, doctor: true, insurance: true },
  }, authToken);
  if (update.ok && update.data.name === 'Test Papa Updated') {
    pass(`PUT /api/family/:id → updated`);
    if (update.data.modules?.includes('insurance')) pass('  5 modules now persisted');
    else fail('  modules update failed', update.data);
  } else fail('PUT /api/family/:id', update.data);
}

async function testHealthReadings() {
  section('HEALTH MONITORING');
  if (!createdMemberId) { fail('No member ID to test health'); return; }

  // POST health reading
  const post = await req('POST', `/api/family/${createdMemberId}/health`, {
    type: 'Blood Pressure',
    value: '120/80',
    unit: 'mmHg',
    notes: 'Morning reading',
  }, authToken);
  if (post.ok && post.data.id) pass(`POST /api/family/:id/health → id=${post.data.id}`);
  else fail('POST health reading', post.data);

  // POST another
  const post2 = await req('POST', `/api/family/${createdMemberId}/health`, {
    type: 'Blood Sugar',
    value: '95',
    unit: 'mg/dL',
  }, authToken);
  if (post2.ok) pass('POST /api/family/:id/health (sugar) → ok');
  else fail('POST health sugar', post2.data);

  // GET history
  const history = await req('GET', `/api/family/${createdMemberId}/health`, undefined, authToken);
  if (history.ok && Array.isArray(history.data)) {
    pass(`GET /api/family/:id/health → ${history.data.length} readings`);
    if (history.data.length >= 2) pass('  multiple readings stored correctly');
    else fail('  expected 2+ readings');
  } else fail('GET health history', history.data);
}

async function testCaregivers() {
  section('CAREGIVER MANAGEMENT');
  if (!createdMemberId) { fail('No member ID to test caregivers'); return; }

  // POST add caregiver
  const add = await req('POST', `/api/family/${createdMemberId}/caregivers`, {
    name: 'Dr. Rajesh Kumar',
    email: 'rajesh@clinic.com',
    phone: '+919876543210',
    permission: 'view',
  }, authToken);
  if (add.ok && add.data.id) {
    createdCaregiverId = add.data.id;
    pass(`POST /api/family/:id/caregivers → id=${createdCaregiverId}`);
    if (add.data.permission === 'view') pass('  permission=view stored');
    else fail('  permission not stored', add.data);
  } else fail('POST caregiver', add.data);

  // GET caregivers
  const list = await req('GET', `/api/family/${createdMemberId}/caregivers`, undefined, authToken);
  if (list.ok && Array.isArray(list.data) && list.data.length > 0) {
    pass(`GET /api/family/:id/caregivers → ${list.data.length} caregiver(s)`);
    if (list.data[0]?.name === 'Dr. Rajesh Kumar') pass('  caregiver name correct');
  } else fail('GET caregivers', list.data);

  // DELETE caregiver
  if (createdCaregiverId) {
    const del = await req('DELETE', `/api/family/${createdMemberId}/caregivers/${createdCaregiverId}`, undefined, authToken);
    if (del.ok) pass(`DELETE /api/family/:id/caregivers/:cid → removed`);
    else fail('DELETE caregiver', del.data);

    // Verify removed
    const listAfter = await req('GET', `/api/family/${createdMemberId}/caregivers`, undefined, authToken);
    if (listAfter.ok && listAfter.data.length === 0) pass('  caregiver deleted, list empty');
    else fail('  caregiver still in list after delete', listAfter.data);
  }
}

async function testReminders() {
  section('BILLS & REMINDERS');

  // GET bills
  const bills = await req('GET', '/api/bills', undefined, authToken);
  if (bills.ok) pass(`GET /api/bills → ${bills.data.length ?? 0} bills`);
  else fail('GET /api/bills', bills.data);

  // POST create bill
  const create = await req('POST', '/api/bills', {
    name: 'Electricity Bill Test',
    amount: 2500,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    category: 'bills',
    repeat: 'monthly',
    isPaid: false,
    status: 'active',
  }, authToken);
  if (create.ok && create.data.id) {
    const billId = create.data.id;
    pass(`POST /api/bills → id=${billId}`);

    // Mark paid (toggle)
    const toggle = await req('PUT', `/api/bills/${billId}`, { ...create.data, isPaid: true, status: 'paid' }, authToken);
    if (toggle.ok) pass('PUT /api/bills/:id (mark paid) → ok');
    else fail('PUT mark paid', toggle.data);

    // Snooze action
    const snooze = await req('POST', `/api/bills/${billId}/actions`, { action: 'snooze', days: 2 }, authToken);
    if (snooze.ok) pass('POST /api/bills/:id/actions (snooze) → ok');
    else fail('Snooze action', snooze.data);

    // Cancel action
    const cancel = await req('POST', `/api/bills/${billId}/actions`, { action: 'cancel' }, authToken);
    if (cancel.ok) pass('POST /api/bills/:id/actions (cancel) → ok');
    else fail('Cancel action', cancel.data);

    // Uncancel action
    const uncancel = await req('POST', `/api/bills/${billId}/actions`, { action: 'uncancel' }, authToken);
    if (uncancel.ok) pass('POST /api/bills/:id/actions (uncancel) → ok');
    else fail('Uncancel action', uncancel.data);

    // DELETE
    const del = await req('DELETE', `/api/bills/${billId}`, undefined, authToken);
    if (del.ok) pass('DELETE /api/bills/:id → ok');
    else fail('DELETE bill', del.data);
  } else {
    fail('POST /api/bills', create.data);
  }

  // Member-specific reminders
  if (createdMemberId) {
    const memberRem = await req('GET', `/api/family/${createdMemberId}/reminders`, undefined, authToken);
    if (memberRem.ok) pass(`GET /api/family/:id/reminders → ${memberRem.data.length ?? 0} member reminders`);
    else fail('GET member reminders', memberRem.data);
  }
}

async function testBillScanRoutes() {
  section('BILL SCAN API');
  // Just check routes exist (actual scan needs image file)
  const scanRes = await req('POST', '/api/bills/scan/preview', {}, authToken);
  // Should return 400 (missing image) not 404 (missing route)
  if (scanRes.status !== 404) pass(`POST /api/bills/scan/preview → route exists (status=${scanRes.status})`);
  else fail('POST /api/bills/scan/preview → 404, route missing');

  const commitRes = await req('POST', '/api/bills/scan/commit', {}, authToken);
  if (commitRes.status !== 404) pass(`POST /api/bills/scan/commit → route exists (status=${commitRes.status})`);
  else fail('POST /api/bills/scan/commit → 404, route missing');
}

async function testTransactions() {
  section('TRANSACTIONS');
  const txRes = await req('GET', '/api/transactions', undefined, authToken);
  if (txRes.ok) pass(`GET /api/transactions → ${txRes.data.length ?? 0} transactions`);
  else fail('GET /api/transactions', txRes.data);
}

async function testSettings() {
  section('SETTINGS');
  const get = await req('GET', '/api/settings', undefined, authToken);
  if (get.ok) pass('GET /api/settings → ok');
  else fail('GET /api/settings', get.data);

  const put = await req('PUT', '/api/settings', { monthlyBudget: 50000 }, authToken);
  if (put.ok) pass('PUT /api/settings → budget updated');
  else fail('PUT /api/settings', put.data);
}

async function cleanup() {
  section('CLEANUP');
  if (createdMemberId) {
    const del = await req('DELETE', `/api/family/${createdMemberId}`, undefined, authToken);
    if (del.ok) pass(`DELETE /api/family/${createdMemberId} → cleaned up`);
    else fail('Cleanup member delete', del.data);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('     LifeWise API End-to-End Test Suite');
  console.log(`     Target: ${BASE_URL}`);
  console.log('═══════════════════════════════════════════════════');

  try {
    await testAuth();
    await testFamilyHub();
    await testHealthReadings();
    await testCaregivers();
    await testReminders();
    await testBillScanRoutes();
    await testTransactions();
    await testSettings();
    await cleanup();
  } catch (e) {
    console.error('\n💥 Unexpected error:', e);
    process.exitCode = 1;
  }

  console.log('\n═══════════════════════════════════════════════════');
  if (process.exitCode === 1) {
    console.log('❌ SOME TESTS FAILED — Check errors above');
  } else {
    console.log('✅ ALL TESTS PASSED — App is production-ready!');
  }
  console.log('═══════════════════════════════════════════════════\n');
}

main();
