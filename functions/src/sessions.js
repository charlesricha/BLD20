const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { authenticateAdmin } = require('./vouchers'); // Import admin auth middleware

const db = admin.firestore();

// 1. GET /api/sessions/active - List active sessions (Admin-Only)
router.get('/active', authenticateAdmin, async (req, res) => {
    try {
        const now = admin.firestore.Timestamp.fromDate(new Date());
        
        // Fetch sessions with status == 'active'
        const snapshot = await db.collection('sessions')
            .where('status', '==', 'active')
            .get();

        const activeSessions = [];
        const expiredBatch = db.batch();
        let hasExpiredSessions = false;

        snapshot.forEach(doc => {
            const session = doc.data();
            const expiresAt = session.expires_at.toDate();
            
            // Self-healing: check if session has expired in real time
            if (expiresAt < new Date()) {
                // Update status in batch
                expiredBatch.update(doc.ref, { status: 'expired' });
                hasExpiredSessions = true;
            } else {
                activeSessions.push({
                    session_id: session.session_id,
                    mac_address: session.mac_address,
                    ip_address: session.ip_address,
                    username: session.username,
                    package_id: session.package_id,
                    started_at: session.started_at.toDate().toISOString(),
                    expires_at: session.expires_at.toDate().toISOString(),
                    bytes_in: session.bytes_in || 0,
                    bytes_out: session.bytes_out || 0,
                    status: session.status
                });
            }
        });

        // Commit self-healing changes asynchronously if any expired
        if (hasExpiredSessions) {
            await expiredBatch.commit();
        }

        return res.json({ success: true, data: activeSessions });

    } catch (error) {
        console.error('Error fetching active sessions:', error);
        return res.status(500).json({ success: false, error: 'Internal server error fetching sessions' });
    }
});

// 2. DELETE /api/sessions/:id - Disconnect a session (Admin-Only)
// :id is the session_id, which is the MAC address in lowercase
router.delete('/:id', authenticateAdmin, async (req, res) => {
    const sessionId = req.params.id.toLowerCase();

    try {
        const sessionRef = db.collection('sessions').doc(sessionId);
        const sessionDoc = await sessionRef.get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        const session = sessionDoc.data();
        
        if (session.status !== 'active') {
            return res.status(400).json({ success: false, error: `Session is not active (status: ${session.status})` });
        }

        // We need to look up the hotspot settings for this session to get the mikrotik_ip and secret
        // In our system, let's assume we can fetch the active hotspot or search hotspot records.
        // If a hotspot_id is saved on the session, we fetch it directly.
        // If not, we search for the hotspot where the client IP or router IP matches.
        // Let's first check if hotspot_id exists in session, otherwise fetch a default active one or search.
        let hotspot = null;
        if (session.hotspot_id) {
            const hotspotDoc = await db.collection('hotspots').doc(session.hotspot_id).get();
            if (hotspotDoc.exists) {
                hotspot = hotspotDoc.data();
            }
        }

        // Fallback: If no hotspot_id is linked to the session, find the first active hotspot
        if (!hotspot) {
            const hotspotSnapshot = await db.collection('hotspots')
                .where('active', '==', true)
                .limit(1)
                .get();
            if (!hotspotSnapshot.empty) {
                hotspot = hotspotSnapshot.docs[0].data();
            }
        }

        if (!hotspot) {
            return res.status(400).json({ 
                success: false, 
                error: 'Cannot disconnect router session: No active hotspot configuration found' 
            });
        }

        // Perform transaction to set session status as expired and queue disconnect request
        const disconnectRequestRef = db.collection('disconnect_requests').doc();

        await db.runTransaction(async (transaction) => {
            // Update session status to disconnected
            transaction.update(sessionRef, {
                status: 'disconnected',
                disconnected_at: admin.firestore.FieldValue.serverTimestamp()
            });

            // Queue a RADIUS CoA (Disconnect-Request) for the custom RADIUS server process to execute
            transaction.set(disconnectRequestRef, {
                request_id: disconnectRequestRef.id,
                session_id: sessionId,
                mac_address: session.mac_address,
                username: session.username,
                mikrotik_ip: hotspot.mikrotik_ip,
                radius_secret: hotspot.radius_secret,
                status: 'pending',
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        console.log(`Disconnected session queued for CoA. MAC: ${session.mac_address}, Router: ${hotspot.mikrotik_ip}`);
        
        return res.json({ 
            success: true, 
            data: { 
                message: 'Session disconnected and CoA request queued successfully.' 
            } 
        });

    } catch (error) {
        console.error('Error disconnecting session:', error);
        return res.status(500).json({ success: false, error: 'Internal server error disconnecting session' });
    }
});

module.exports = router;
