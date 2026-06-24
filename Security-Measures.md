# Security Measures
**MikroTik Hotspot Billing System — Security Architecture**

Every layer secured: network, API, payments, database, infrastructure.

---

## 1. Network Security

### RADIUS Shared Secret
- Each hotspot has a unique RADIUS shared secret (minimum 32 random characters)
- Secret stored in Firestore under the hotspot record — never in source code
- Rotate every 90 days or immediately after any suspected compromise

### RADIUS Communication
- Restrict RADIUS packets to the hotspot's known source IP (server-side firewall rule)
- Reject authentication requests from unknown source IPs
- Rate-limit: max 10 failed auth attempts per MAC address per minute

### MikroTik Firewall Rules (applied by setup script)
```
Rule 1: Allow established/related connections  (top priority)
Rule 2: Allow DNS UDP 53
Rule 3: Allow DHCP
Rule 4: Walled garden — portal domain + *.mpesa.safaricom.co.ke
Rule 5: DROP all other unauthenticated traffic
```

### HTTPS Everywhere
- Captive portal served over HTTPS (Firebase Hosting — free SSL via Let's Encrypt)
- All API endpoints HTTPS only; HTTP redirected at the hosting layer
- HSTS header enabled on portal and API domains

---

## 2. API Security

### Authentication
- All admin endpoints protected by Firebase Auth JWT tokens
- Tokens verified server-side on every request — never trust client claims
- Token expiry: 1 hour; refresh tokens stored in memory, not localStorage
- No API keys exposed in frontend code

### Rate Limiting

| Endpoint | Limit |
|---|---|
| /api/payments/initiate | 3 requests per phone number per 5 minutes |
| /api/vouchers/validate | 10 attempts per IP per minute |
| /api/auth/login | 5 attempts per IP per 15 minutes |
| RADIUS authentication | 10 failures per MAC per minute |

### Input Validation
- All inputs sanitised server-side — never trust client data
- Phone numbers validated to E.164 format before any M-Pesa API call
- MAC addresses validated against regex before Firestore writes
- Strict schema validation — reject requests with unexpected fields
- No string concatenation in database queries

### CORS Policy
- Restrict CORS to exact portal and admin dashboard domains
- No wildcard (`*`) origins in production
- Preflight requests validated

---

## 3. Payment Security

### M-Pesa STK Push
- Consumer secret and API keys stored in Firebase Functions config — never in frontend
- All STK Push calls made server-side in Cloud Functions
- Callback URL validated: verify source is Safaricom IP ranges
- Idempotency: each payment has a unique reference; duplicate callbacks are ignored
- Session only activated after: `ResultCode == 0` AND amount matches package price exactly

### Fraud Prevention
- Never activate a session based on STK Push initiation alone — only on confirmed callback
- Every payment attempt logged: timestamp, phone, amount, MAC, status
- Payment amount validated server-side — client-submitted amount is always ignored

### Voucher Security
- Vouchers are 12-character cryptographically random uppercase alphanumeric codes
- Single-use: redemption uses a Firestore atomic transaction to prevent race conditions
- Codes are not sequential or guessable
- Admin can invalidate any voucher at any time

---

## 4. Database Security (Firestore)

### Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Sessions, payments, vouchers: Cloud Functions only — no direct client access
    match /sessions/{id}  { allow read, write: if false; }
    match /payments/{id}  { allow read, write: if false; }
    match /vouchers/{id}  { allow read, write: if false; }

    // Packages: admin read/write only
    match /packages/{id} {
      allow read, write: if request.auth != null
                         && request.auth.token.role == 'admin';
    }

    // Users: own record only
    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### Service Account
- Cloud Functions use a dedicated Firebase service account with minimum required permissions
- Service account key never committed to version control
- All secrets stored in Firebase Functions config or Google Secret Manager

### Backups
- Enable Firestore daily backups (Firebase Blaze plan)
- Export to Google Cloud Storage weekly
- Test restoration quarterly

---

## 5. Captive Portal Security

- Sessions tied to MAC address AND IP address — mismatch forces re-authentication
- Content-Security-Policy header prevents XSS and data injection:
```
Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  connect-src 'self' https://api.yourdomain.com;
```
- iOS captive portal handled correctly: HTTP 302 redirect from MikroTik, not a JS redirect
- No cookies with sensitive data; session tokens are short-lived
- Portal domain uses strict HTTPS to prevent DNS rebinding attacks

---

## 6. Infrastructure Security

### VPS Hardening (RADIUS Server)
- Disable root SSH login; use SSH key pairs only
- UFW firewall: allow UDP 1812/1813, TCP 443, TCP 22 (trusted IPs only)
- Fail2ban enabled for SSH brute force protection
- Automatic security updates enabled
- Disable all unused services

### Secrets Management
- Never hardcode secrets in source code
- Use Firebase Functions config or Google Secret Manager
- Rotate all secrets every 90 days
- Maintain an offline secrets inventory

### Monitoring
- Firebase Cloud Logging for error tracking
- Alert on: payment callback failures, RADIUS auth spike, unusual session counts
- Monthly review of Firestore access logs

---

## 7. Compliance & Privacy

- Store only minimum required data: phone (for M-Pesa), MAC (for session)
- Never store full card numbers (not applicable to M-Pesa/Airtel flow)
- Data retention policy: purge sessions older than 90 days
- Admin can delete a user's data on request
- M-Pesa integration must comply with Safaricom's developer terms of service

---

## 8. Pre-Launch Security Checklist

| Item | Checked |
|---|---|
| All admin endpoints require authentication | ⬜ |
| Rate limiting active on all public endpoints | ⬜ |
| Firestore security rules tested and locked down | ⬜ |
| HTTPS enforced everywhere (portal + API + admin) | ⬜ |
| No secrets in frontend code or Git history | ⬜ |
| M-Pesa callback validates source IP and payment amount | ⬜ |
| Vouchers are single-use (atomic Firestore transaction) | ⬜ |
| RADIUS secret is unique per hotspot | ⬜ |
| VPS SSH hardened (key-only, no root login) | ⬜ |
| Firewall rules tested (unauthenticated device is blocked) | ⬜ |
| Error messages do not leak system internals | ⬜ |
| Payment and auth events are logged | ⬜ |
| Data retention policy defined (sessions purged after 90 days) | ⬜ |
