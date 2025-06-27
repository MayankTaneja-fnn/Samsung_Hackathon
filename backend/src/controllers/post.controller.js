import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { db, storage, admin } from "../utils/firebase.config.js";

const cleanUp = (filePath) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

export const handleSubmitIssue = async (req, res) => {
  try {
    const { description, lat, lng } = req.body;
    console.log("Received body:", req.body);
    const userId = req.userId;
    const mediaFiles = req.files?.media || [];
    const voiceFiles = req.files?.voice || [];
    console.log(req.body);
    const mediaUrls = [];

    const uploadAndGetUrl = async (file, prefix) => {
      const ext = path.extname(file.originalname);
      const dest = `issues/${userId}/${prefix}_${uuidv4()}${ext}`;

      await storage.upload(file.path, {
        destination: dest,
        metadata: {
          contentType: file.mimetype,
        },
      });

      const [url] = await storage.file(dest).getSignedUrl({
        action: "read",
        expires: "03-01-2030",
      });

      cleanUp(file.path);
      return url;
    };

    for (const file of mediaFiles) {
      const url = await uploadAndGetUrl(file, "media");
      mediaUrls.push(url);
    }

    for (const file of voiceFiles) {
      const url = await uploadAndGetUrl(file, "voice");
      mediaUrls.push(url);
    }

    const issueData = {
      userId,
      location: {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
      },
      issueType: "basic_help",
      status: "open",
      severity: "red",
      description,
      mediaUrls,
      responders: [],
      reportedAt: new Date(),
      resolvedAt: null,
      resolutionProof: {},
      notifyAuthorities: true,
      authorityType: "ambulance",
      aiVerified: false,
      flaggedByAI: false,
    };
    console.log("Issue Data:", issueData);

    const docRef = await db.collection("posts").add(issueData);

    // Notify users within 2km
    const issueLocation = { lat: parseFloat(lat), lng: parseFloat(lng) };
    try {
      // Fetch all users with location and fcmToken
      const usersSnap = await db.collection('users').get();
      const tokens = [];
      usersSnap.forEach(doc => {
        const user = doc.data();
        if (user.location && user.fcmToken && user.userId !== userId) {
          const dist = getDistanceFromLatLonInKm(
            issueLocation.lat,
            issueLocation.lng,
            user.location.lat,
            user.location.lng
          );
          if (dist <= 2) {
            tokens.push(user.fcmToken);
          }
        }
      });
      if (tokens.length > 0) {
        const message = {
          notification: {
            title: '🚨 Nearby Help Needed!',
            body: description || 'A new help request was posted near you.',
          },
          tokens,
        };
        await admin.messaging().sendMulticast(message);

        for (const token of tokens) {
      // Find user by fcmToken
          const userSnap = await db.collection('users').where('fcmToken', '==', token).get();
          if (!userSnap.empty) {
            const userDoc = userSnap.docs[0];
            await db.collection('notifications').add({
              userId: userDoc.id,
              issueId: docRef.id, // The issue just created
              title: '🚨 Nearby Help Needed!',
              body: description || 'A new help request was posted near you.',
              createdAt: new Date(),
              read: false,
            });
          }
      }
      }
    } catch (err) {
      console.error('Notification error:', err);
    }

    res.status(200).json({ message: "Issue submitted", id: docRef.id });
  } catch (err) {
    console.error("🔥 Error submitting issue:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

export const handleGetIssues = async (req, res) => {
  try {
    const issuesSnapshot = await db.collection("issues").get();
    const issues = issuesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.status(200).json(issues);
  } catch (err) {
    console.error("🔥 Error fetching issues:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

export const getAllPosts = async (req, res) => {
  try {
    const snap = await db.collection('posts').orderBy('reportedAt', 'desc').get();
    const posts = snap.docs.map(doc => {
      const data = doc.data();
      const resolvedCount = (data.responders || []).filter(r => r.status === 'resolved').length;
      // Convert Firestore Timestamp fields to millis if present
      return {
        id: doc.id,
        ...data,
        respondersResolvedCount: resolvedCount,
        reportedAt: data.reportedAt && data.reportedAt.toMillis ? data.reportedAt.toMillis() : data.reportedAt,
        resolvedAt: data.resolvedAt && data.resolvedAt.toMillis ? data.resolvedAt.toMillis() : data.resolvedAt,
        responders: Array.isArray(data.responders) ? data.responders.map(r => ({
          ...r,
          acceptedAt: r.acceptedAt && r.acceptedAt.toMillis ? r.acceptedAt.toMillis() : r.acceptedAt,
          resolvedAt: r.resolvedAt && r.resolvedAt.toMillis ? r.resolvedAt.toMillis() : r.resolvedAt,
        })) : [],
      };
    });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch posts' });
  }
};

export const acceptHelp = async (req, res) => {
  try {
    const userId = req.userId;
    const postRef = db.collection('posts').doc(req.params.id);
    const postDoc = await postRef.get();
    if (!postDoc.exists) return res.status(404).json({ message: 'Post not found' });

    const responders = postDoc.data().responders || [];
    if (responders.some(r => r.userId === userId)) {
      return res.status(400).json({ message: 'Already accepted' });
    }
    responders.push({ userId, acceptedAt: Date.now(), status: 'in_progress' });
    await postRef.update({ responders, status: 'in_progress' });

    // Notify issuer
    const issuerId = postDoc.data().userId;
    const issuerDoc = await db.collection('users').doc(issuerId).get();
    if (issuerDoc.exists && issuerDoc.data().fcmToken) {
      const fcmToken = issuerDoc.data().fcmToken;
      const message = {
        notification: {
          title: 'Someone accepted your help request!',
          body: 'A responder is on the way.',
        },
        token: fcmToken,
      };
      await admin.messaging().send(message);
      // Save notification
      await db.collection('notifications').add({
        userId: issuerId,
        issueId: req.params.id,
        title: 'Someone accepted your help request!',
        body: 'A responder is on the way.',
        createdAt: new Date(),
        read: false,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to accept help' });
  }
};

export const responderMarkResolved = async (req, res) => {
  try {
    const userId = req.userId;
    const postRef = db.collection('posts').doc(req.params.id);
    const postDoc = await postRef.get();
    if (!postDoc.exists) return res.status(404).json({ message: 'Post not found' });

    let responders = postDoc.data().responders || [];
    let updated = false;
    responders = responders.map(r => {
      if (r.userId === userId) {
        updated = true;
        return { ...r, status: 'resolved', resolvedAt: Date.now() };
      }
      return r;
    });
    if (!updated) return res.status(400).json({ message: 'You are not a responder for this issue' });
    // console.log("Updated Responders:", responders);
    await postRef.update({ responders });

    // Notify issuer
    const issuerId = postDoc.data().userId;
    const issuerDoc = await db.collection('users').doc(issuerId).get();
    // console.log("Issuer Document:", issuerDoc.data());
    if (issuerDoc.exists && issuerDoc.data().fcmToken) {
      const fcmToken = issuerDoc.data().fcmToken;
      const message = {
        notification: {
          title: 'A responder marked your issue as resolved!',
          body: 'Please confirm if the issue is resolved.',
        },
        token: fcmToken,
      };
      const res1=await admin.messaging().send(message);
      // console.log("res1",res1);
      // Save notification
      const res=await db.collection('notifications').add({
        userId: issuerId,
        issueId: req.params.id,
        title: 'A responder marked your issue as resolved!',
        body: 'Please confirm if the issue is resolved.',
        createdAt: new Date(),
        read: false,
      });
      // console.log("response",res);
    }
    // console.log("Responder marked as resolved:", userId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark as resolved' });
  }
};

export const markResolved = async (req, res) => {
  try {
    const postRef = db.collection('posts').doc(req.params.id);
    const postDoc = await postRef.get();
    if (!postDoc.exists) return res.status(404).json({ message: 'Post not found' });

    await postRef.update({ status: 'resolved', resolvedAt: Date.now() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark as resolved' });
  }
};

// Helper function for distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}