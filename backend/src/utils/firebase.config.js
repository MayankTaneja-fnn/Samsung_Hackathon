import admin from "firebase-admin";
// import serviceAccount from "../../firebase-admin-creds" assert { type: "json" };
import  serviceAccount from "../../firebase-admin-creds.js";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.GOOGLE_STORAGE_BUCKET, // ← replace with your actual bucket
  });
}

const db = admin.firestore();
const storage = admin.storage().bucket();

export { admin, db, storage };
