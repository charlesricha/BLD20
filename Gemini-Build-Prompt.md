# Gemini Build Prompt
**MikroTik Hotspot Billing System — Complete Codebase**

> Copy everything from the horizontal rule below and paste it into Gemini, ChatGPT, or Cursor.
> Ask it to generate one file at a time starting with the captive portal, review each before moving on.

---

## SYSTEM CONTEXT

You are building a complete, production-ready MikroTik WiFi hotspot billing system for a Kenyan ISP/hotspot operator. The system must be lean enough that all router-side logic runs on a MikroTik hAP Lite (32MB RAM, 16MB storage). All heavy processing runs in the cloud on Firebase.

The operator's entire setup experience is: copy one script URL → paste into MikroTik terminal → billing system is live.

---

## WHAT TO BUILD

### 1. Captive Portal (Public-facing)

Mobile-first HTML/CSS/JS single page served to WiFi users when they connect.

Requirements:
- Must work on iOS Safari (captive portal WebView), Android Chrome, Windows, macOS
- Total page weight under 50KB — vanilla HTML/CSS/JS only, no frameworks
- Flow: Landing → Select Package → Pay (M-Pesa STK Push) OR Enter Voucher → Connected screen
- Detect iOS captive portal user agent (`CaptiveNetworkSupport`) and serve simplified version
- Phone input: accept `07XX` or `254XX` format, normalise to `2547XX` before any API call
- After STK Push is sent, poll `/api/payments/status/:id` every 5 seconds for up to 90 seconds
- Show countdown timer when connected (time remaining on the package)
- Graceful error states: payment failed, voucher invalid, network timeout
- Design: clean and minimal, works in light mode. Use Inter font via Google Fonts (preconnect, non-blocking)
- Use HTTP 302 from MikroTik to redirect to portal — do not rely on JS redirects for initial load

### 2. Admin Dashboard (Protected)

Single-page React app for the hotspot operator.

Features:
- Login with Firebase Auth (email/password)
- Overview: today's revenue (KES), active sessions count, vouchers sold today
- Packages management: create/edit/delete packages (name, price KES, duration hours, data limit MB, upload/download speed Kbps)
- Vouchers: generate batch for a selected package, display voucher codes in a printable grid
- Active sessions: table with MAC, IP, package name, time remaining, data used, Disconnect button
- Payments log: list of all payments with status (pending/success/failed)
- Revenue chart by day — last 30 days using Chart.js
- Hotspot settings page: view and copy the RouterOS one-paste setup script for this hotspot

### 3. Backend — Firebase Cloud Functions (Node.js 18)

All business logic as HTTP Cloud Functions. Every response uses this shape:
```json
{ "success": true, "data": {} }
{ "success": false, "error": "message" }
```

Endpoints:

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| /api/payments/initiate | POST | Public | Trigger M-Pesa STK Push |
| /api/payments/callback | POST | Public | Receive M-Pesa confirmation webhook |
| /api/payments/status/:id | GET | Public | Poll payment status |
| /api/vouchers/validate | POST | Public | Validate and redeem a voucher |
| /api/packages | GET | Public | List active packages |
| /api/packages | POST | Admin | Create a package |
| /api/packages/:id | PUT | Admin | Update a package |
| /api/packages/:id | DELETE | Admin | Delete a package |
| /api/vouchers/generate | POST | Admin | Generate a batch of vouchers |
| /api/sessions/active | GET | Admin | List active sessions |
| /api/sessions/:id | DELETE | Admin | Disconnect a session (sends CoA) |
| /api/reports/daily | GET | Admin | Revenue and usage report |
| /api/mikrotik/config/:hotspot_id | GET | Admin | Get RouterOS setup script |

### 4. RADIUS Server (Node.js — deploy on VPS)

A lightweight custom RADIUS server using the `radius` npm package.

- Listen on UDP 1812 (authentication) and UDP 1813 (accounting)
- On `Access-Request`: query Firestore for an active session matching username/MAC address
- Return `Access-Accept` with attributes: `Session-Timeout`, `WISPr-Bandwidth-Max-Up`, `WISPr-Bandwidth-Max-Down`
- Return `Access-Reject` for invalid or expired sessions
- On `Accounting-Request` (Start/Interim/Stop): update `bytes_in`, `bytes_out` in Firestore
- Handle `Disconnect-Request` (CoA on UDP 3799) to terminate sessions on demand
- Single `server.js` file — must run on a 512MB RAM VPS

### 5. RouterOS Setup Script Generator

An endpoint that returns a plain-text RouterOS script the operator pastes into MikroTik terminal.

The script must:
- Configure hotspot server on the correct interface (bridge or ether2)
- Set RADIUS client pointing to the cloud server IP with the hotspot's shared secret
- Set login page URL to the captive portal HTTPS URL
- Configure walled garden: whitelist portal domain and `*.mpesa.safaricom.co.ke`
- Set DNS to `8.8.8.8` and `8.8.4.4`
- Add firewall rules: allow DNS, DHCP, walled garden; DROP all other unauthenticated traffic
- Set session timeout check interval to 60 seconds
- Be idempotent — running the script twice must not break anything (use `/ip hotspot set` if already exists)
- Include a comment on every block explaining what it does

---

## TECH STACK

| Layer | Technology |
|---|---|
| Router | MikroTik RouterOS |
| Backend | Node.js 18, Firebase Cloud Functions |
| Database | Firebase Firestore |
| Auth | Firebase Auth |
| RADIUS | Custom Node.js RADIUS server (VPS) |
| Captive Portal | Vanilla HTML/CSS/JS (no frameworks) |
| Admin Dashboard | React 18, Chart.js, Firebase Auth SDK |
| Payments | Safaricom Daraja API (M-Pesa STK Push) |
| Hosting | Firebase Hosting |

---

## FIRESTORE SCHEMA

Use these exact collection and field names:

```
packages:  { id, name, price_kes, duration_hours, data_limit_mb, speed_up_kbps, speed_down_kbps, active }
vouchers:  { code, package_id, created_at, used_at, used_by_mac, expires_at, status }
sessions:  { session_id, mac_address, ip_address, username, package_id, started_at, expires_at, bytes_in, bytes_out, status }
payments:  { payment_id, phone_number, amount, mpesa_ref, package_id, mac_address, status, created_at, confirmed_at }
hotspots:  { hotspot_id, name, location, mikrotik_ip, radius_secret, active }
```

---

## M-PESA PAYMENT FLOW

1. User selects package and enters phone number on the captive portal
2. Portal calls `POST /api/payments/initiate`
3. Cloud Function calls Safaricom Daraja STK Push API
4. User receives STK prompt on phone and enters PIN
5. Safaricom calls `POST /api/payments/callback`
6. Cloud Function validates: `ResultCode == 0` AND amount matches package price
7. Cloud Function creates a session in Firestore and marks payment confirmed
8. Portal polling `/api/payments/status/:id` detects success
9. Portal shows success screen — RADIUS now allows this MAC address through

---

## KEY CONSTRAINTS

- Captive portal total page weight must be under 50KB
- All monetary amounts stored as integers (KES, no decimals — e.g. `50` not `50.00`)
- Never store M-Pesa consumer secret, PIN, or access tokens in Firestore
- Voucher codes: 12 uppercase alphanumeric characters, cryptographically random (`crypto.randomBytes`)
- All API responses: `{ success: bool, data?: any, error?: string }`
- Mobile money callback URLs must be HTTPS with a valid SSL certificate
- Rate limit `/api/payments/initiate` to 3 requests per phone per 5 minutes
- Validate M-Pesa callback amount server-side — never trust client-submitted amount

---

## DELIVERABLE FILE STRUCTURE

```
/
├── captive-portal/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── admin/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Packages.jsx
│   │   │   ├── Vouchers.jsx
│   │   │   ├── Sessions.jsx
│   │   │   ├── Payments.jsx
│   │   │   ├── Reports.jsx
│   │   │   └── Settings.jsx
│   │   └── firebase.js
│   └── package.json
├── functions/
│   ├── src/
│   │   ├── payments.js
│   │   ├── vouchers.js
│   │   ├── sessions.js
│   │   ├── packages.js
│   │   └── mikrotik.js
│   └── package.json
├── radius/
│   ├── server.js
│   └── package.json
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .env.example
└── README.md
```

---

## BUILD ORDER

Generate in this order, pausing after each file for review before continuing:

1. `captive-portal/index.html`, `style.css`, `app.js`
2. `functions/src/payments.js`
3. `functions/src/vouchers.js`
4. `functions/src/sessions.js`
5. `functions/src/packages.js`
6. `functions/src/mikrotik.js`
7. `radius/server.js`
8. `admin/src/` — all React pages
9. `firestore.rules`, `firebase.json`, `firestore.indexes.json`
10. `.env.example` and `README.md`

---

## README MUST INCLUDE

- Firebase project setup steps (enable Firestore, Auth, Functions, Hosting)
- How to deploy Cloud Functions (`firebase deploy --only functions`)
- How to deploy the captive portal to Firebase Hosting
- How to run the RADIUS server on a VPS
- How to apply for M-Pesa Daraja API credentials
- The one-paste MikroTik setup instructions (step by step, with screenshots described)
- Environment variables reference (matching `.env.example`)
