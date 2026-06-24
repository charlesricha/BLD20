const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

// Helper: Generate a cryptographically random 12-character uppercase alphanumeric code
function generateVoucherCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    // Generate 12 characters
    const bytes = crypto.randomBytes(12);
    for (let i = 0; i < 12; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

// 1. POST /api/vouchers/validate - Validate and redeem a voucher code (Public)
router.post('/validate', async (req, res) => {
    let { code, mac_address, ip_address } = req.body;
    
    if (!code || !mac_address) {
        return res.status(400).json({ success: false, error: 'Missing required parameters: code, mac_address' });
    }
    
    ip_address = ip_address || req.ip || '';
    
    // Clean code: remove dashes or spaces and convert to uppercase
    const cleanCode = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleanCode.length !== 12) {
        return res.status(400).json({ success: false, error: 'Invalid voucher code format. Must be 12 alphanumeric characters.' });
    }

    try {
        // Rate Limiting: Max 10 attempts per IP per minute
        const oneMinuteAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 60 * 1000));
        const recentFailures = await db.collection('failed_voucher_attempts')
            .where('ip_address', '==', ip_address)
            .where('timestamp', '>=', oneMinuteAgo)
            .get();

        if (recentFailures.size >= 10) {
            return res.status(429).json({ success: false, error: 'Too many verification attempts. Please wait 1 minute.' });
        }

        const voucherRef = db.collection('vouchers').doc(cleanCode);
        
        let session = null;
        let errorMsg = null;

        // Execute atomic transaction for safe voucher redemption
        await db.runTransaction(async (transaction) => {
            const voucherDoc = await transaction.get(voucherRef);
            
            if (!voucherDoc.exists) {
                errorMsg = 'Voucher code does not exist.';
                return;
            }

            const voucher = voucherDoc.data();
            
            if (voucher.status !== 'unused') {
                errorMsg = `Voucher has already been used on ${voucher.used_at ? voucher.used_at.toDate().toLocaleString() : 'another device'}.`;
                return;
            }

            // Look up the package details to get the duration
            const packageDoc = await db.collection('packages').doc(voucher.package_id).get();
            if (!packageDoc.exists) {
                errorMsg = 'Associated WiFi package no longer exists.';
                return;
            }
            const pkg = packageDoc.data();

            const now = new Date();
            const expiresAt = new Date(now.getTime() + pkg.duration_hours * 60 * 60 * 1000);

            // 1. Update Voucher Document
            transaction.update(voucherRef, {
                status: 'used',
                used_at: admin.firestore.Timestamp.fromDate(now),
                used_by_mac: mac_address.toLowerCase(),
                expires_at: admin.firestore.Timestamp.fromDate(expiresAt)
            });

            // 2. Create/Update Session Document for the user's MAC
            const sessionRef = db.collection('sessions').doc(mac_address.toLowerCase());
            
            session = {
                session_id: mac_address.toLowerCase(),
                mac_address: mac_address.toLowerCase(),
                ip_address: ip_address,
                username: mac_address.toLowerCase(), // RADIUS server logs in using MAC
                package_id: voucher.package_id,
                started_at: admin.firestore.Timestamp.fromDate(now),
                expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
                bytes_in: 0,
                bytes_out: 0,
                status: 'active'
            };
            
            transaction.set(sessionRef, session);
        });

        if (errorMsg) {
            // Log failed attempt to Firestore for rate limiting
            await db.collection('failed_voucher_attempts').add({
                ip_address,
                code: cleanCode,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(400).json({ success: false, error: errorMsg });
        }

        // Convert timestamps to string ISO representation for API response
        const formattedSession = {
            ...session,
            started_at: session.started_at.toDate().toISOString(),
            expires_at: session.expires_at.toDate().toISOString()
        };

        return res.json({ 
            success: true, 
            data: { 
                session: formattedSession,
                message: 'Voucher redeemed successfully' 
            } 
        });

    } catch (error) {
        console.error('Error validating voucher:', error);
        return res.status(500).json({ success: false, error: 'Internal server error redeeming voucher' });
    }
});

// Helper validation middleware for Admin endpoints (must pass Firebase ID Token)
async function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Admin auth token required.' });
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        // Verify custom claim role is admin
        if (decodedToken.role === 'admin' || decodedToken.email === 'admin@bubblenet.com') {
            req.adminUser = decodedToken;
            next();
        } else {
            return res.status(403).json({ success: false, error: 'Access forbidden. Admin role required.' });
        }
    } catch (error) {
        console.error('Auth verification error:', error);
        return res.status(401).json({ success: false, error: 'Invalid or expired auth token.' });
    }
}

// 2. POST /api/vouchers/generate - Generate voucher batch (Admin-Only)
router.post('/generate', authenticateAdmin, async (req, res) => {
    const { package_id, count } = req.body;

    if (!package_id || !count || count <= 0) {
        return res.status(400).json({ success: false, error: 'Missing package_id or invalid count' });
    }

    const batchLimit = 500;
    if (count > batchLimit) {
        return res.status(400).json({ success: false, error: `Cannot generate more than ${batchLimit} vouchers per request.` });
    }

    try {
        // Verify package exists
        const packageDoc = await db.collection('packages').doc(package_id).get();
        if (!packageDoc.exists) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        const generatedCodes = [];
        const batch = db.batch();
        const now = admin.firestore.Timestamp.fromDate(new Date());

        for (let i = 0; i < count; i++) {
            const code = generateVoucherCode();
            const voucherRef = db.collection('vouchers').doc(code);
            
            batch.set(voucherRef, {
                code: code,
                package_id: package_id,
                created_at: now,
                used_at: null,
                used_by_mac: '',
                expires_at: null,
                status: 'unused'
            });
            
            generatedCodes.push(code);
        }

        await batch.commit();

        return res.json({ 
            success: true, 
            data: { 
                count: generatedCodes.length,
                vouchers: generatedCodes 
            } 
        });

    } catch (error) {
        console.error('Error generating vouchers:', error);
        return res.status(500).json({ success: false, error: 'Internal server error generating vouchers' });
    }
});

// Export admin authenticator for reuse in other modules
router.authenticateAdmin = authenticateAdmin;

module.exports = router;
