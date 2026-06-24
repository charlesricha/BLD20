# Project Requirements
**MikroTik WiFi Hotspot Billing System — Self-Hosted, Cloud-Backed**
Version 1.0

---

## 1. Overview

A lightweight self-hosted WiFi billing system designed to run on MikroTik RouterOS hardware (including hAP Lite). The system replaces commercial billing platforms with a lean, cloud-backed stack. Operators receive a single script URL to paste into MikroTik terminal and the billing system immediately activates.

---

## 2. System Architecture

### 2.1 Components

| Component | Technology | Role |
|---|---|---|
| MikroTik Router | RouterOS hAP Lite+ | Hotspot enforcement, firewall, RADIUS client |
| Cloud Backend | Firebase Cloud Functions | Billing logic, RADIUS, REST API |
| Database | Firebase Firestore | Sessions, vouchers, packages, payments |
| Auth | Firebase Auth | Admin authentication |
| RADIUS Server | Custom Node.js (VPS) | AAA for MikroTik |
| Payment | M-Pesa Daraja API | STK Push payments |
| Captive Portal | Vanilla HTML/CSS/JS | User-facing payment page |
| Admin Panel | React + Firebase | Operator dashboard |

### 2.2 Design Principle

The router acts as enforcer only. All billing logic, RADIUS, database, and web portal run on the cloud. This keeps the hAP Lite's 32MB RAM free for routing duties.

### 2.3 Topology

```
[Client Device]
      |
[MikroTik Hotspot / Captive Portal]
      |
[RADIUS / API Auth Server]  <---->  [Firebase Firestore]
      |
[Payment Gateway (M-Pesa / Airtel)]
```

---

## 3. APIs Required

### 3.1 RADIUS Server (UDP)

| Service | Port | Description |
|---|---|---|
| RADIUS Auth | UDP 1812 | MikroTik sends credentials; server validates against Firestore |
| RADIUS Accounting | UDP 1813 | Session start/stop/interim; logs bytes used |
| RADIUS CoA | UDP 3799 | Disconnect-Request to terminate expired sessions |

### 3.2 Internal REST API (Cloud Functions)

| Endpoint | Method | Description |
|---|---|---|
| /api/payments/initiate | POST | Trigger M-Pesa STK Push |
| /api/payments/callback | POST | Receive M-Pesa/Airtel confirmation |
| /api/payments/status/:id | GET | Poll payment status (captive portal polling) |
| /api/vouchers/validate | POST | Validate and redeem a voucher code |
| /api/packages | GET | List active packages (public) |
| /api/packages | POST | Create package (admin) |
| /api/packages/:id | PUT/DELETE | Edit or delete package (admin) |
| /api/vouchers/generate | POST | Generate voucher batch (admin) |
| /api/sessions/active | GET | List active sessions (admin) |
| /api/sessions/:id | DELETE | Disconnect a session (admin) |
| /api/reports/daily | GET | Revenue and usage report (admin) |
| /api/mikrotik/config/:id | GET | Get RouterOS setup script (admin) |

### 3.3 M-Pesa Daraja API (Safaricom)

| Endpoint | Method | Description |
|---|---|---|
| oauth/v1/generate | GET | Get bearer token (expires every hour) |
| mpesa/stkpush/v1/processrequest | POST | Initiate STK Push to user's phone |
| mpesa/stkpushquery/v1/query | POST | Query transaction status |
| [Your callback URL] | POST | Receive payment result from Safaricom |

### 3.4 Airtel Money API (optional)

| Endpoint | Method | Description |
|---|---|---|
| /auth/oauth2/token | POST | Get bearer token |
| /merchant/v1/payments/ | POST | Initiate payment request |
| [Your callback URL] | POST | Receive payment result |

---

## 4. Database Schema (Firestore)

### Collections

**packages**
```
{ id, name, price_kes, duration_hours, data_limit_mb, speed_up_kbps, speed_down_kbps, active }
```

**vouchers**
```
{ code, package_id, created_at, used_at, used_by_mac, expires_at, status }
```

**sessions**
```
{ session_id, mac_address, ip_address, username, package_id, started_at, expires_at, bytes_in, bytes_out, status }
```

**payments**
```
{ payment_id, phone_number, amount, mpesa_ref, package_id, mac_address, status, created_at, confirmed_at }
```

**hotspots**
```
{ hotspot_id, name, location, mikrotik_ip, radius_secret, active }
```

---

## 5. Firewall Strategy (MikroTik)

MikroTik firewall configured by the one-paste setup script:

1. Allow established/related connections (top priority, first rule)
2. Allow DNS (UDP 53) for all devices — needed to resolve the portal domain
3. Allow DHCP — devices must get an IP address
4. Walled garden — whitelist captive portal domain, *.mpesa.safaricom.co.ke
5. DROP all other unauthenticated traffic (no reject, just drop)
6. On payment/voucher success — RADIUS sends Access-Accept → MikroTik allows MAC dynamically
7. On session expiry — CoA Disconnect-Request → MikroTik removes the dynamic entry

---

## 6. Hardware Constraints (hAP Lite)

| Specification | Value |
|---|---|
| RAM | 32 MB |
| Flash Storage | 16 MB |
| CPU | 650 MHz MIPS |
| RouterOS | 6.x / 7.x |
| WiFi | 2.4 GHz 802.11b/g/n |
| Ports | 5x 10/100 Ethernet |

> All billing logic runs on the cloud. The router only runs RouterOS and acts as the network enforcer. Zero custom software on the router itself.

---

## 7. Captive Portal Requirements

- Served via HTTPS (Firebase Hosting — free SSL)
- Total page weight under 50KB (no images except inline SVG)
- Works on: iOS Safari (captive portal WebView), Android Chrome/WebView, Windows, macOS
- Detects iOS captive portal user agent and serves simplified flow
- Supports M-Pesa STK Push and voucher code entry
- Polls payment status every 5 seconds (max 90 seconds) after STK Push
- Shows countdown timer when connected
- No app installation required — pure browser

---

## 8. One-Paste Setup Flow

The operator's workflow:

1. Create a hotspot record in the admin dashboard
2. Copy the generated RouterOS script
3. Paste into MikroTik terminal (New Terminal in Winbox)
4. Done — billing system is live

---

## 9. Tech Stack

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
| CI/CD | GitHub Actions |
