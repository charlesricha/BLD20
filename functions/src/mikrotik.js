const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { authenticateAdmin } = require('./vouchers'); // Import admin auth middleware

const db = admin.firestore();

// GET /api/mikrotik/config/:hotspot_id - Get RouterOS setup script (Admin-Only)
router.get('/config/:hotspot_id', authenticateAdmin, async (req, res) => {
    const hotspotId = req.params.hotspot_id;

    try {
        const hotspotDoc = await db.collection('hotspots').doc(hotspotId).get();
        if (!hotspotDoc.exists) {
            return res.status(404).json({ success: false, error: 'Hotspot configuration not found' });
        }

        const hotspot = hotspotDoc.data();
        
        // Configuration parameters from Env Variables and Hotspot Record
        const radiusServerIp = process.env.RADIUS_SERVER_IP || '12.34.56.78';
        const portalUrl = process.env.PORTAL_URL || 'https://velocitywifi.web.app';
        
        // Extract domain from portal URL for walled garden whitelisting
        let portalDomain = 'velocitywifi.web.app';
        try {
            const urlObj = new URL(portalUrl);
            portalDomain = urlObj.hostname;
        } catch (e) {
            console.error('Error parsing portal URL for domain extraction:', e);
        }

        const radiusSecret = hotspot.radius_secret || 'supersecretsharedkey';
        const hotspotName = hotspot.name || 'velocity_hotspot';
        const hotspotInterface = hotspot.interface || 'bridge'; // e.g. bridge or ether2

        // Create RouterOS commands
        const script = `# =====================================================================
# BubbleNet MikroTik Hotspot One-Paste Setup Script
# Hotspot ID: ${hotspotId}
# Generated: ${new Date().toLocaleString()}
# =====================================================================

:log info "Starting BubbleNet configuration script..."

# ---------------------------------------------------------------------
# 1. DNS Settings
# ---------------------------------------------------------------------
# Configure DNS servers to Google DNS (8.8.8.8 and 8.8.4.4)
# This is crucial so clients can resolve the portal domain and Safaricom API.
/ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes

# ---------------------------------------------------------------------
# 2. RADIUS Client Settings
# ---------------------------------------------------------------------
# Set up the RADIUS connection pointing to the cloud VPS server.
# This authorizes the client requests and reports session bytes/accounting.
/radius
:local radiusFind [find comment="BubbleNet RADIUS"]
:if ($radiusFind != "") do={ remove $radiusFind }
add comment="BubbleNet RADIUS" service=hotspot address=${radiusServerIp} secret="${radiusSecret}" authentication-port=1812 accounting-port=1813 timeout=3s

# Configure router to accept incoming CoA requests (disconnect sessions) from cloud
/radius incoming set accept=yes port=3799

# ---------------------------------------------------------------------
# 3. Hotspot Profiles
# ---------------------------------------------------------------------
# Configure the Hotspot user and server profiles.
# Enabling PAP login allows credentials to be passed securely to RADIUS.
/ip hotspot user profile
set [find name=default] shared-users=1

:local profileFind [/ip hotspot profile find name="bubble_profile"]
:if ($profileFind != "") do={
    /ip hotspot profile set $profileFind login-by=http-pap use-radius=yes radius-mac-format=xx:xx:xx:xx:xx:xx
} else={
    /ip hotspot profile add comment="BubbleNet Profile" name="bubble_profile" login-by=http-pap use-radius=yes radius-mac-format=xx:xx:xx:xx:xx:xx
}

# ---------------------------------------------------------------------
# 4. Hotspot Walled Garden Configuration
# ---------------------------------------------------------------------
# Whitelist specific domains so unauthenticated clients can access the payment flows.
/ip hotspot walled-garden
remove [find comment="BubbleNet Walled Garden"]
add comment="BubbleNet Walled Garden" dst-host="${portalDomain}"
add comment="BubbleNet Walled Garden" dst-host="*.mpesa.safaricom.co.ke"
add comment="BubbleNet Walled Garden" dst-host="*.safaricom.co.ke"
add comment="BubbleNet Walled Garden" dst-host="fonts.googleapis.com"
add comment="BubbleNet Walled Garden" dst-host="fonts.gstatic.com"

# ---------------------------------------------------------------------
# 5. Hotspot Server Setup
# ---------------------------------------------------------------------
# Check if there is already a hotspot server on the selected interface.
# If so, link it to the bubble_profile. Otherwise, create a new one.
:local serverFind [/ip hotspot find interface=${hotspotInterface}]
:if ($serverFind != "") do={
    :log info "BubbleNet: Found existing hotspot server on interface ${hotspotInterface}. Updating to use bubble_profile."
    /ip hotspot set $serverFind profile=bubble_profile
} else={
    :local firstServer [/ip hotspot find]
    :if ($firstServer != "") do={
        :log info "BubbleNet: Hotspot server found on another interface. Setting profile to bubble_profile."
        /ip hotspot set $firstServer profile=bubble_profile
    } else={
        :log warning "BubbleNet: No existing hotspot server found. Creating server on interface ${hotspotInterface}. Make sure to run '/ip hotspot setup' first if routing/DHCP is not set up."
        /ip hotspot add comment="BubbleNet Server" name="${hotspotName}" interface=${hotspotInterface} profile=bubble_profile disabled=no
    }
}

# ---------------------------------------------------------------------
# 6. Override local login.html with cloud portal redirection
# ---------------------------------------------------------------------
# Overwrite the default login.html to automatically redirect connecting clients
# to the secure, hosted captive portal with MAC, IP, and redirection URLs.
:local loginPath ""
:if ([/file find name="hotspot/login.html"] != "") do={
    :set loginPath "hotspot/login.html"
} else={
    :if ([/file find name="flash/hotspot/login.html"] != "") do={
        :set loginPath "flash/hotspot/login.html"
    }
}

:if ($loginPath != "") do={
    /file set [find name=$loginPath] contents="<html><head><meta http-equiv=\"refresh\" content=\"0; url=${portalUrl}?mac=\$(mac)&ip=\$(ip)&link-login=\$(link-login)&link-login-only=\$(link-login-only)&link-orig=\$(link-orig)&hotspot_id=${hotspotId}\" /></head></html>"
    :log info "BubbleNet: Captive portal redirect written to $loginPath"
} else={
    :log error "BubbleNet Error: login.html not found! Please run the RouterOS '/ip hotspot setup' wizard first on interface ${hotspotInterface}."
}

# ---------------------------------------------------------------------
# 7. Security Firewall Strategy
# ---------------------------------------------------------------------
# Restricts unauthenticated network access while permitting essential operations.
/ip firewall filter remove [/ip firewall filter find comment="BubbleNet Firewall"]
:local firewallCount [:len [/ip firewall filter find]]
:if ($firewallCount > 0) do={
    /ip firewall filter add action=accept chain=forward comment="BubbleNet Firewall" connection-state=established,related place-before=0
    /ip firewall filter add action=accept chain=forward comment="BubbleNet Firewall" dst-port=53 protocol=udp place-before=1
    /ip firewall filter add action=accept chain=forward comment="BubbleNet Firewall" dst-port=67,68 protocol=udp place-before=2
} else={
    /ip firewall filter add action=accept chain=forward comment="BubbleNet Firewall" connection-state=established,related
    /ip firewall filter add action=accept chain=forward comment="BubbleNet Firewall" dst-port=53 protocol=udp
    /ip firewall filter add action=accept chain=forward comment="BubbleNet Firewall" dst-port=67,68 protocol=udp
}

:log info "BubbleNet Setup Completed successfully!"
# =====================================================================
`;

        // Return plain text configuration file
        res.setHeader('Content-Type', 'text/plain');
        return res.send(script);

    } catch (error) {
        console.error('Error generating RouterOS script:', error);
        return res.status(500).json({ success: false, error: 'Internal server error generating RouterOS script' });
    }
});

module.exports = router;
