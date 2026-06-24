require('dotenv').config();
const dgram = require('dgram');
const radius = require('radius');
const path = require('path');
const admin = require('firebase-admin');

// ---------------------------------------------------------------------
// 1. Initialize Firebase Admin
// ---------------------------------------------------------------------
// Looks for serviceAccountKey.json in the current directory or uses defaults
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || path.join(__dirname, 'serviceAccountKey.json');
try {
    if (require('fs').existsSync(serviceAccountPath)) {
        admin.initializeApp({
            credential: admin.credential.cert(require(serviceAccountPath))
        });
        console.log('Firebase initialized with service account key.');
    } else {
        admin.initializeApp();
        console.log('Firebase initialized with application default credentials.');
    }
} catch (error) {
    console.error('Firebase initialization failed:', error);
    process.exit(1);
}

const db = admin.firestore();

// ---------------------------------------------------------------------
// 2. Load RADIUS Dictionaries
// ---------------------------------------------------------------------
// Load standard dictionary and custom WISPr dictionary for bandwidth caps
try {
    radius.add_dictionary(path.join(__dirname, 'dictionary.wispr'));
    console.log('WISPr RADIUS dictionary loaded.');
} catch (e) {
    console.error('Failed to load WISPr dictionary:', e.message);
}

// ---------------------------------------------------------------------
// 3. Hotspot Configurations Cache & Firestore Listener
// ---------------------------------------------------------------------
// We cache hotspots by IP so we don't query Firestore on every UDP packet.
const hotspotsCache = new Map(); // Key: IP address, Value: Hotspot data

db.collection('hotspots').onSnapshot(snapshot => {
    hotspotsCache.clear();
    snapshot.forEach(doc => {
        const hotspot = doc.data();
        if (hotspot.active && hotspot.mikrotik_ip) {
            hotspotsCache.set(hotspot.mikrotik_ip, {
                hotspot_id: doc.id,
                name: hotspot.name,
                radius_secret: hotspot.radius_secret || 'supersecretsharedkey',
                mikrotik_ip: hotspot.mikrotik_ip
            });
        }
    });
    console.log(`Hotspots cache updated. Active count: ${hotspotsCache.size}`);
}, error => {
    console.error('Firestore hotspots listener error:', error);
});

// ---------------------------------------------------------------------
// 4. RADIUS Authentication Server (UDP 1812)
// ---------------------------------------------------------------------
const authServer = dgram.createSocket('udp4');

authServer.on('message', async (msg, rinfo) => {
    const senderIp = rinfo.address;
    const hotspot = hotspotsCache.get(senderIp);
    
    if (!hotspot) {
        console.warn(`[Auth] Rejecting request from unauthorized IP: ${senderIp}`);
        return; // Ignore requests from unknown routers
    }

    const secret = hotspot.radius_secret;
    let packet;

    try {
        packet = radius.decode({ packet: msg, secret: secret });
    } catch (err) {
        console.error(`[Auth] Failed to decode packet from ${senderIp}:`, err.message);
        return;
    }

    if (packet.code !== 'Access-Request') {
        console.warn(`[Auth] Received non-auth code: ${packet.code} from ${senderIp}`);
        return;
    }

    const username = packet.attributes['User-Name'];
    const macAddress = packet.attributes['Calling-Station-Id'] || username;

    console.log(`[Auth] Access-Request for user: ${username} (MAC: ${macAddress}) from Router IP: ${senderIp}`);

    try {
        // Query active session for this user (MAC address in lowercase)
        const sessionDoc = await db.collection('sessions').doc(username.toLowerCase()).get();

        if (sessionDoc.exists) {
            const session = sessionDoc.data();
            const now = new Date();
            const expiresAt = session.expires_at.toDate();

            if (session.status === 'active' && expiresAt > now) {
                // Fetch package details for speed limits
                const packageDoc = await db.collection('packages').doc(session.package_id).get();
                
                let sessionTimeout = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1000));
                let speedUpBps = 0;
                let speedDownBps = 0;

                if (packageDoc.exists) {
                    const pkg = packageDoc.data();
                    // Speeds in KES profile are stored in Kbps. RADIUS WISPr expects bits/sec (bps).
                    speedUpBps = pkg.speed_up_kbps ? pkg.speed_up_kbps * 1000 : 0;
                    speedDownBps = pkg.speed_down_kbps ? pkg.speed_down_kbps * 1000 : 0;
                }

                const attributes = [
                    ['Session-Timeout', sessionTimeout],
                    ['Acct-Interim-Interval', 60] // Send interim updates every 60s
                ];

                if (speedUpBps > 0) {
                    attributes.push(['WISPr-Bandwidth-Max-Up', speedUpBps]);
                }
                if (speedDownBps > 0) {
                    attributes.push(['WISPr-Bandwidth-Max-Down', speedDownBps]);
                }

                const response = radius.encode_response({
                    packet: packet,
                    code: 'Access-Accept',
                    secret: secret,
                    attributes: attributes
                });

                authServer.send(response, 0, response.length, rinfo.port, senderIp);
                console.log(`[Auth] Access-Accept sent to ${senderIp} for user: ${username} (Timeout: ${sessionTimeout}s)`);
                return;
            }
        }

        // Session not active, not found, or expired
        const response = radius.encode_response({
            packet: packet,
            code: 'Access-Reject',
            secret: secret
        });
        authServer.send(response, 0, response.length, rinfo.port, senderIp);
        console.log(`[Auth] Access-Reject sent to ${senderIp} for user: ${username}`);

    } catch (error) {
        console.error(`[Auth] Firestore session lookup error:`, error);
        // Fail-safe: Reject on system error
        const response = radius.encode_response({
            packet: packet,
            code: 'Access-Reject',
            secret: secret
        });
        authServer.send(response, 0, response.length, rinfo.port, senderIp);
    }
});

// ---------------------------------------------------------------------
// 5. RADIUS Accounting Server (UDP 1813)
// ---------------------------------------------------------------------
const acctServer = dgram.createSocket('udp4');

acctServer.on('message', async (msg, rinfo) => {
    const senderIp = rinfo.address;
    const hotspot = hotspotsCache.get(senderIp);

    if (!hotspot) {
        console.warn(`[Acct] Rejecting request from unauthorized IP: ${senderIp}`);
        return;
    }

    const secret = hotspot.radius_secret;
    let packet;

    try {
        packet = radius.decode({ packet: msg, secret: secret });
    } catch (err) {
        console.error(`[Acct] Failed to decode packet from ${senderIp}:`, err.message);
        return;
    }

    if (packet.code !== 'Accounting-Request') {
        console.warn(`[Acct] Received non-acct code: ${packet.code} from ${senderIp}`);
        return;
    }

    const username = packet.attributes['User-Name'];
    const statusType = packet.attributes['Acct-Status-Type'];
    const inputOctets = packet.attributes['Acct-Input-Octets'] || 0; // Bytes sent by client
    const outputOctets = packet.attributes['Acct-Output-Octets'] || 0; // Bytes received by client
    const framedIp = packet.attributes['Framed-IP-Address'] || '';

    console.log(`[Acct] Accounting ${statusType} for user: ${username} (IP: ${framedIp}, In: ${inputOctets}, Out: ${outputOctets})`);

    try {
        const sessionRef = db.collection('sessions').doc(username.toLowerCase());
        const updateData = {
            bytes_in: inputOctets,
            bytes_out: outputOctets,
            last_accounting_at: admin.firestore.FieldValue.serverTimestamp()
        };

        if (framedIp) {
            updateData.ip_address = framedIp;
        }

        if (statusType === 'Stop') {
            // Set status to expired when the session actually terminates on the router
            updateData.status = 'expired';
            console.log(`[Acct] Session stopped for user: ${username}`);
        }

        await sessionRef.update(updateData);

        // Send confirmation back to Router
        const response = radius.encode_response({
            packet: packet,
            code: 'Accounting-Response',
            secret: secret
        });
        acctServer.send(response, 0, response.length, rinfo.port, senderIp);

    } catch (error) {
        console.error(`[Acct] Firestore accounting update error:`, error);
        // Still reply to accounting so router stops retrying
        const response = radius.encode_response({
            packet: packet,
            code: 'Accounting-Response',
            secret: secret
        });
        acctServer.send(response, 0, response.length, rinfo.port, senderIp);
    }
});

// ---------------------------------------------------------------------
// 6. RADIUS CoA (Change of Authorization) Listener (UDP 3799 client)
// ---------------------------------------------------------------------
// Listens to Firestore `disconnect_requests` collection and fires UDP 3799 CoA Disconnect-Requests
const coaSocket = dgram.createSocket('udp4');

db.collection('disconnect_requests')
    .where('status', '==', 'pending')
    .onSnapshot(snapshot => {
        snapshot.forEach(async doc => {
            const req = doc.data();
            const docRef = doc.ref;

            console.log(`[CoA] Processing disconnect request ${doc.id} for user: ${req.username} on Router: ${req.mikrotik_ip}`);

            try {
                // Mark request as in-progress
                await docRef.update({ status: 'sending' });

                // Construct RADIUS Disconnect-Request (Code 40)
                const coaPacket = radius.encode({
                    code: 'Disconnect-Request',
                    secret: req.radius_secret,
                    identifier: Math.floor(Math.random() * 256),
                    attributes: [
                        ['User-Name', req.username],
                        ['Calling-Station-Id', req.mac_address]
                    ]
                });

                // Send CoA packet to router's IP on UDP 3799
                coaSocket.send(coaPacket, 0, coaPacket.length, 3799, req.mikrotik_ip, async (err) => {
                    if (err) {
                        console.error(`[CoA] Failed to send UDP packet to ${req.mikrotik_ip}:`, err.message);
                        await docRef.update({ 
                            status: 'failed', 
                            error: err.message,
                            updated_at: admin.firestore.FieldValue.serverTimestamp()
                        });
                    } else {
                        console.log(`[CoA] Disconnect-Request sent to ${req.mikrotik_ip} for MAC: ${req.mac_address}`);
                        // Update status to sent. We assume success unless we parse response, 
                        // or we can mark it as success.
                        await docRef.update({ 
                            status: 'sent',
                            updated_at: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                });

            } catch (err) {
                console.error(`[CoA] Error processing disconnect doc ${doc.id}:`, err);
                await docRef.update({ 
                    status: 'failed', 
                    error: err.message,
                    updated_at: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        });
    }, error => {
        console.error('Firestore disconnect requests listener error:', error);
    });

// Bind UDP Ports
const AUTH_PORT = process.env.RADIUS_AUTH_PORT || 1812;
const ACCT_PORT = process.env.RADIUS_ACCT_PORT || 1813;

authServer.bind(AUTH_PORT, () => {
    console.log(`RADIUS Authentication server listening on UDP port ${AUTH_PORT}`);
});

acctServer.bind(ACCT_PORT, () => {
    console.log(`RADIUS Accounting server listening on UDP port ${ACCT_PORT}`);
});
