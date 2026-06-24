const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const axios = require('axios');

const db = admin.firestore();

// Helper to get M-Pesa Daraja Access Token
async function getMpesaAccessToken() {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const env = process.env.MPESA_ENV || 'sandbox';
    
    const baseUrl = env === 'production' 
        ? 'https://api.safaricom.co.ke' 
        : 'https://sandbox.safaricom.co.ke';
        
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    
    try {
        const response = await axios.get(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: {
                Authorization: `Basic ${auth}`
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Error fetching M-Pesa Access Token:', error.response ? error.response.data : error.message);
        throw new Error('M-Pesa authorization failed');
    }
}

// 1. POST /api/payments/initiate - Trigger STK Push
router.post('/initiate', async (req, res) => {
    const { phone_number, package_id, mac_address, ip_address } = req.body;
    
    if (!phone_number || !package_id || !mac_address) {
        return res.status(400).json({ success: false, error: 'Missing required parameters: phone_number, package_id, mac_address' });
    }

    try {
        // Rate Limiting: Max 3 requests per phone per 5 minutes
        const fiveMinutesAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));
        const paymentAttempts = await db.collection('payments')
            .where('phone_number', '==', phone_number)
            .where('created_at', '>=', fiveMinutesAgo)
            .get();

        if (paymentAttempts.size >= 3) {
            return res.status(429).json({ success: false, error: 'Too many requests. Please wait 5 minutes before trying again.' });
        }

        // Fetch package to get the price
        const packageDoc = await db.collection('packages').doc(package_id).get();
        if (!packageDoc.exists) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }
        const pkg = packageDoc.data();
        
        // M-Pesa STK details
        const env = process.env.MPESA_ENV || 'sandbox';
        const baseUrl = env === 'production' 
            ? 'https://api.safaricom.co.ke' 
            : 'https://sandbox.safaricom.co.ke';
            
        const shortcode = process.env.MPESA_SHORTCODE;
        const passkey = process.env.MPESA_PASSKEY;
        const callbackUrl = process.env.MPESA_CALLBACK_URL;
        
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
        const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
        
        // Fetch OAuth Token
        const accessToken = await getMpesaAccessToken();
        
        const amount = Math.round(pkg.price_kes); // Force integer
        
        // Initiate STK Push
        const stkResponse = await axios.post(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: phone_number,
            PartyB: shortcode,
            PhoneNumber: phone_number,
            CallBackURL: callbackUrl,
            AccountReference: `Velocity_${mac_address.replace(/:/g, '')}`,
            TransactionDesc: `WiFi Package ${pkg.name}`
        }, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        
        if (stkResponse.data.ResponseCode === '0') {
            const checkoutRequestId = stkResponse.data.CheckoutRequestID;
            
            // Create payment record in Firestore with status 'pending'
            const paymentId = checkoutRequestId; // Using CheckoutRequestID as the doc ID for easy lookup in callback
            await db.collection('payments').doc(paymentId).set({
                payment_id: paymentId,
                phone_number,
                amount,
                mpesa_ref: '',
                package_id,
                mac_address,
                ip_address: ip_address || '',
                status: 'pending',
                created_at: admin.firestore.FieldValue.serverTimestamp(),
                confirmed_at: null
            });
            
            return res.json({ 
                success: true, 
                data: { 
                    payment_id: paymentId, 
                    message: stkResponse.data.CustomerMessage 
                } 
            });
        } else {
            return res.status(500).json({ success: false, error: stkResponse.data.ResponseDescription || 'M-Pesa STK initiation failed' });
        }

    } catch (error) {
        console.error('Error initiating M-Pesa STK push:', error.response ? error.response.data : error.message);
        return res.status(500).json({ success: false, error: error.message || 'Server error initiating payment' });
    }
});

// 2. POST /api/payments/callback - Receive M-Pesa confirmation
router.post('/callback', async (req, res) => {
    // Note: In production, you would validate that this callback is from Safaricom IP ranges
    console.log('M-Pesa Callback Received:', JSON.stringify(req.body));
    
    try {
        const callbackData = req.body.Body.stkCallback;
        if (!callbackData) {
            return res.status(400).json({ success: false, error: 'Invalid callback format' });
        }

        const checkoutRequestId = callbackData.CheckoutRequestID;
        const resultCode = callbackData.ResultCode;
        const resultDesc = callbackData.ResultDesc;

        const paymentRef = db.collection('payments').doc(checkoutRequestId);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            console.error(`Payment not found for checkoutRequestId: ${checkoutRequestId}`);
            return res.status(404).json({ success: false, error: 'Payment record not found' });
        }

        const payment = paymentDoc.data();
        if (payment.status !== 'pending') {
            console.warn(`Payment ${checkoutRequestId} already processed with status: ${payment.status}`);
            return res.json({ success: true, message: 'Callback already processed' });
        }

        if (resultCode === 0) {
            // Success payment
            const metadataItems = callbackData.CallbackMetadata.Item;
            const mpesaRef = (metadataItems.find(item => item.Name === 'MpesaReceiptNumber') || {}).Value;
            const callbackAmount = (metadataItems.find(item => item.Name === 'Amount') || {}).Value;
            
            // Server-side validation: Retrieve the package to verify the price matches callback amount
            const packageDoc = await db.collection('packages').doc(payment.package_id).get();
            if (!packageDoc.exists) {
                console.error(`Package ${payment.package_id} not found for payment ${checkoutRequestId}`);
                await paymentRef.update({
                    status: 'package_not_found',
                    mpesa_ref: mpesaRef || ''
                });
                return res.status(400).json({ success: false, error: 'Associated package not found' });
            }
            
            const pkg = packageDoc.data();
            
            // Validate payment amount (force to integer representation/compare)
            if (Math.round(callbackAmount) !== Math.round(pkg.price_kes)) {
                console.error(`Amount mismatch for payment ${checkoutRequestId}: expected ${pkg.price_kes}, got ${callbackAmount}`);
                await paymentRef.update({
                    status: 'amount_mismatch',
                    mpesa_ref: mpesaRef || '',
                    confirmed_at: admin.firestore.FieldValue.serverTimestamp()
                });
                return res.status(400).json({ success: false, error: 'Amount mismatch' });
            }

            // Perform atomic transaction: mark payment as success, create session
            await db.runTransaction(async (transaction) => {
                // Update payment
                transaction.update(paymentRef, {
                    status: 'success',
                    mpesa_ref: mpesaRef,
                    confirmed_at: admin.firestore.FieldValue.serverTimestamp()
                });
                
                // Create WiFi session
                const sessionRef = db.collection('sessions').doc(payment.mac_address.toLowerCase());
                
                const now = new Date();
                const expiresAt = new Date(now.getTime() + pkg.duration_hours * 60 * 60 * 1000);
                
                transaction.set(sessionRef, {
                    session_id: payment.mac_address.toLowerCase(),
                    mac_address: payment.mac_address.toLowerCase(),
                    ip_address: payment.ip_address || '',
                    username: payment.mac_address.toLowerCase(),
                    package_id: payment.package_id,
                    started_at: admin.firestore.Timestamp.fromDate(now),
                    expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
                    bytes_in: 0,
                    bytes_out: 0,
                    status: 'active'
                });
            });

            console.log(`Payment and session successfully activated for MAC: ${payment.mac_address}`);
            return res.json({ success: true, message: 'Payment confirmed and session activated' });
        } else {
            // Failed payment from M-Pesa (e.g. cancelled by user)
            await paymentRef.update({
                status: 'failed',
                confirmed_at: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Payment failed for checkoutRequestId: ${checkoutRequestId}. M-Pesa Result: ${resultDesc}`);
            return res.json({ success: true, message: 'Failed payment status recorded' });
        }

    } catch (error) {
        console.error('Error handling M-Pesa callback:', error);
        return res.status(500).json({ success: false, error: 'Internal server error processing callback' });
    }
});

// 3. GET /api/payments/status/:id - Poll payment status
router.get('/status/:id', async (req, res) => {
    const paymentId = req.params.id;

    try {
        const paymentDoc = await db.collection('payments').doc(paymentId).get();
        if (!paymentDoc.exists) {
            return res.status(404).json({ success: false, error: 'Payment reference not found' });
        }

        const payment = paymentDoc.data();
        
        let responseData = {
            status: payment.status
        };

        // If success, include session details for captive portal client to store/use
        if (payment.status === 'success') {
            const sessionDoc = await db.collection('sessions').doc(payment.mac_address.toLowerCase()).get();
            if (sessionDoc.exists) {
                const session = sessionDoc.data();
                responseData.session = {
                    session_id: session.session_id,
                    mac_address: session.mac_address,
                    ip_address: session.ip_address,
                    username: session.username,
                    package_id: session.package_id,
                    started_at: session.started_at.toDate().toISOString(),
                    expires_at: session.expires_at.toDate().toISOString(),
                    status: session.status
                };
            }
        }

        return res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching payment status:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch status' });
    }
});

module.exports = router;
