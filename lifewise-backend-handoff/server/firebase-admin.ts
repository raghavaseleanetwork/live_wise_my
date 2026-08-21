import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';

let app: admin.app.App | null = null;

// Render's Secret Files feature can't store a file at a nested path like
// server/firebase-service-account.json (filenames there may not contain "/"),
// so on Render it's uploaded as a flat file and mounted at /etc/secrets/<name>.
// Check both locations: the local repo path for dev, and Render's secret
// mount (or an explicit override via FIREBASE_SERVICE_ACCOUNT_PATH) for prod.
function resolveServiceAccountPath(): string | null {
  const candidates = [
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    path.resolve(process.cwd(), 'server', 'firebase-service-account.json'),
    '/etc/secrets/firebase-service-account.json',
  ].filter(Boolean) as string[];

  return candidates.find((p) => fs.existsSync(p)) || null;
}

export function getFirebaseMessaging(): admin.messaging.Messaging | null {
  if (app) {
    return admin.messaging();
  }

  const saPath = resolveServiceAccountPath();

  if (!saPath) {
    console.warn('[FCM] Service account file not found (checked server/firebase-service-account.json and /etc/secrets/firebase-service-account.json). Push notifications disabled.');
    return null;
  }

  const raw = fs.readFileSync(saPath, 'utf8');
  const serviceAccount = JSON.parse(raw);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });

  return admin.messaging();
  
}

