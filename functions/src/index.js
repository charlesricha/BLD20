const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

// Initialize Firebase Admin SDK
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
    } catch (error) {
        console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_JSON environment variable, falling back to default:', error);
        admin.initializeApp();
    }
} else {
    admin.initializeApp();
    console.log('Firebase Admin initialized with default credentials.');
}
const db = admin.firestore();

const app = express();

// Apply Global Middlewares
app.use(cors({ origin: true }));
app.use(express.json());

// Register API Routes - Enclosed to handle lazy evaluation cleanly
app.use('/payments', require('./payments'));
app.use('/vouchers', require('./vouchers'));
app.use('/sessions', require('./sessions'));
app.use('/packages', require('./packages'));
app.use('/mikrotik', require('./mikrotik'));

const { authenticateAdmin } = require('./vouchers');

// 1. GET /api/reports/daily - Aggregated Revenue and usage report (Admin-Only)
app.get('/reports/daily', authenticateAdmin, async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(thirtyDaysAgo);

        // Fetch successful payments in the last 30 days
        const paymentsSnapshot = await db.collection('payments')
            .where('status', '==', 'success')
            .where('confirmed_at', '>=', thirtyDaysAgoTimestamp)
            .get();

        const dailyStats = {};
        let totalRevenue = 0;
        let totalPaymentsCount = 0;

        paymentsSnapshot.forEach(doc => {
            const payment = doc.data();
            // Handle edge case if confirmed_at is missing on a document
            if (payment.confirmed_at) {
                const dateStr = payment.confirmed_at.toDate().toISOString().slice(0, 10); // YYYY-MM-DD
                const amount = payment.amount || 0;

                totalRevenue += amount;
                totalPaymentsCount++;

                if (!dailyStats[dateStr]) {
                    dailyStats[dateStr] = {
                        date: dateStr,
                        revenue: 0,
                        count: 0
                    };
                }
                dailyStats[dateStr].revenue += amount;
                dailyStats[dateStr].count += 1;
            }
        });

        const dailyArray = Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date));

        // Get count of active sessions
        const activeSessionsSnapshot = await db.collection('sessions')
            .where('status', '==', 'active')
            .get();
        const activeSessionsCount = activeSessionsSnapshot.size;

        // Get count of total unused vouchers
        const unusedVouchersSnapshot = await db.collection('vouchers')
            .where('status', '==', 'unused')
            .get();
        const unusedVouchersCount = unusedVouchersSnapshot.size;

        return res.json({
            success: true,
            data: {
                summary: {
                    total_revenue_30_days: totalRevenue,
                    total_payments_30_days: totalPaymentsCount,
                    active_sessions: activeSessionsCount,
                    unused_vouchers: unusedVouchersCount
                },
                daily_breakdown: dailyArray
            }
        });

    } catch (error) {
        console.error('Error generating report:', error);
        return res.status(500).json({ success: false, error: 'Internal server error generating dashboard report' });
    }
});

// Export Express App as a single Cloud Function
exports.api = functions.https.onRequest(app);

// Export app directly for Vercel / other server hosting
module.exports = app;