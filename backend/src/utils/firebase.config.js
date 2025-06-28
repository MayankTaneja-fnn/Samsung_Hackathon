import admin from "firebase-admin";
import serviceAccount from "../../samsung-hackathon-6d0a7-firebase-adminsdk-fbsvc-3539e8db6c.json" assert { type: "json" };

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.GOOGLE_STORAGE_BUCKET, // ← replace with your actual bucket
  });
}

const db = admin.firestore();
const storage = admin.storage().bucket();

export { admin, db, storage };
