import admin from "firebase-admin";

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Deployed on Render (env var in base64 JSON string)
  serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8')
  );
} else {
  // Local development (reads from firebase-admin-creds.js)
  const creds = await import("../../firebase-admin-creds.js");
  serviceAccount = creds.default;
}

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.GOOGLE_STORAGE_BUCKET, // make sure this env var exists
  });
}

// Export Firestore and Storage
const db = admin.firestore();
const storage = admin.storage().bucket();

export { admin, db, storage };
