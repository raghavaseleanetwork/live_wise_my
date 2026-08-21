import { io } from 'socket.io-client';

const BASE_URL = 'http://127.0.0.1:5001';
const DEMO_EMAIL = 'demo@lifewise.test';
const DEMO_PASSWORD = 'Radhe@1415';

async function runTest() {
  console.log('🚀 Starting Ticket Flow E2E Test...');

  // 1. Login
  console.log('--- Step 1: Login ---');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  
  if (!loginRes.ok) {
    console.error('❌ Login failed');
    process.exit(1);
  }
  
  const { token, user } = await loginRes.json();
  const userId = user.id;
  console.log(`✅ Logged in as ${user.email} (ID: ${userId})`);

  // 2. Create Ticket
  console.log('\n--- Step 2: Create Ticket ---');
  const createRes = await fetch(`${BASE_URL}/api/support/tickets`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      subject: 'E2E Test Ticket ' + Date.now(),
      description: 'This is a test ticket for automated lifecycle verification.',
      category: 'technical',
      priority: 'high'
    }),
  });

  if (!createRes.ok) {
    console.error('❌ Ticket creation failed');
    process.exit(1);
  }

  const ticket = await createRes.json();
  const ticketId = ticket._id;
  console.log(`✅ Ticket created: ${ticket.subject} (ID: ${ticketId})`);
  console.log(`   Initial Status: ${ticket.status} (Expected: active)`);

  if (ticket.status !== 'active') {
    console.error('❌ ERROR: Initial status should be "active"');
  }

  // 3. Verify in "Active" tab
  console.log('\n--- Step 3: Verify Filtering (Active) ---');
  const activeRes = await fetch(`${BASE_URL}/api/support/tickets?status=active`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const activeTickets = await activeRes.json();
  const foundInActive = activeTickets.some((t: any) => t._id === ticketId);
  console.log(`✅ Ticket found in "active" tab: ${foundInActive}`);

  // 4. Admin Response (via Socket)
  console.log('\n--- Step 4: Admin Response (via Socket) ---');
  const socket = io(BASE_URL, {
    auth: { token },
    transports: ['websocket'],
  });

  return new Promise((resolve) => {
    socket.on('connect', async () => {
      console.log('   Socket connected');
      socket.emit('join-ticket', ticketId);

      // Simulate Admin message
      console.log('   Sending admin response...');
      socket.emit('send-message', {
        ticketId,
        userId: 'admin_id_simulated',
        content: 'I am an admin responding to your issue.',
        senderType: 'admin'
      });

      // Wait for status update event
      socket.on('ticket-status-update', async (data) => {
        if (data.ticketId === ticketId && data.status === 'in_progress') {
          console.log(`✅ Received socket event: ticket status updated to ${data.status}`);
          
          // Verify status via API
          const checkRes = await fetch(`${BASE_URL}/api/support/tickets/${ticketId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const updatedTicket = await checkRes.json();
          console.log(`✅ API verification: ticket status is now ${updatedTicket.status}`);

          // 5. Verify in "In Progress" tab
          console.log('\n--- Step 5: Verify Filtering (In Progress) ---');
          const progressRes = await fetch(`${BASE_URL}/api/support/tickets?status=in_progress`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const progressTickets = await progressRes.json();
          const foundInProgress = progressTickets.some((t: any) => t._id === ticketId);
          console.log(`✅ Ticket found in "in_progress" tab: ${foundInProgress}`);
          
          const foundInActiveAgain = (await (await fetch(`${BASE_URL}/api/support/tickets?status=active`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })).json()).some((t: any) => t._id === ticketId);
          console.log(`✅ Ticket NO LONGER in "active" tab: ${!foundInActiveAgain}`);

          // 6. Close Ticket
          console.log('\n--- Step 6: Close Ticket (via PATCH) ---');
          const closeRes = await fetch(`${BASE_URL}/api/support/tickets/${ticketId}/status`, {
            method: 'PATCH',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: 'closed' }),
          });
          
          if (closeRes.ok) {
            console.log('✅ Ticket closed successfully');
            
            // 7. Verify in "Closed" tab
            console.log('\n--- Step 7: Final Filtering Verification (Closed) ---');
            const closedRes = await fetch(`${BASE_URL}/api/support/tickets?status=closed`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const closedTickets = await closedRes.json();
            const foundInClosed = closedTickets.some((t: any) => t._id === ticketId);
            console.log(`✅ Ticket found in "closed" tab: ${foundInClosed}`);

            console.log('\n🎉 ALL TESTS PASSED!');
            socket.disconnect();
            resolve(true);
          } else {
            console.error('❌ Failed to close ticket');
            socket.disconnect();
            resolve(false);
          }
        }
      });
    });
  });
}

runTest().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
