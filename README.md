# MikroTik WiFi Hotspot Billing System

A self-hosted, cloud-backed WiFi hotspot billing system designed to run on resource-constrained MikroTik RouterOS hardware (such as the hAP Lite with 32MB RAM) using a custom cloud-based RADIUS AAA flow and M-Pesa STK Push payment integrations.

---

## 1. System Architecture Diagram

```
                 +--------------------------------------+
                 |            Client Device             |
                 +--------------------------------------+
                                     |
                                     v [HTTP Redirect / PAP Auth Request]
                 +--------------------------------------+
                 |      MikroTik hAP Lite Router        |
                 +--------------------------------------+
                   | (RADIUS client)          | (DNS/DHCP)
                   |                          v
                   | (UDP 1812/1813)        [Walled Garden Whitelist]
                   v                          |
+--------------------------------------+      v (M-Pesa STK Callback / Portal Hosting)
|     Custom VPS Node.js RADIUS        | <----+----------------------------------+
+--------------------------------------+      |                                  |
                   | (Real-time Sync)         v                                  v
                   |                     +----------+                       +----------+
                   +-------------------> | Firebase | <-------------------- |  Admin   |
                                         | Database | (JWT Auth admin app)  | Console  |
                                         +----------+                       +----------+
```

---

## 2. Environment Variables Reference

Copy `.env.example` to `.env` and configure:

| Key | Description | Environment | Example / Default |
|---|---|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Client Web API Key | Client Dashboard | `AIzaSy...` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project Identifier | Client Dashboard | `wifi-billing-system` |
| `MPESA_ENV` | Lipa Na M-Pesa API Mode | Cloud Functions | `sandbox` or `production` |
| `MPESA_SHORTCODE` | Business Paybill or Till Shortcode | Cloud Functions | `174379` (Sandbox standard) |
| `MPESA_CALLBACK_URL` | Webhook URL for Safaricom confirmation | Cloud Functions | `https://[functions-host]/api/payments/callback` |
| `PORTAL_URL` | Domain where captive portal is hosted | Cloud Functions | `https://[project].web.app` |
| `RADIUS_SERVER_IP` | Public IP of the RADIUS VPS | Cloud Functions / Router | `12.34.56.78` |

---

## 3. Firebase Project Setup

1. **Create Firebase Project**:
   - Go to [Firebase Console](https://console.firebase.google.com/) and create a new project.
   - Upgrade the project to the **Blaze (Pay-as-you-go) plan** (required for outbound API requests to Safaricom).

2. **Enable Databases & Services**:
   - **Cloud Firestore**: Enable Firestore in your preferred location. Set database rules using `firestore.rules`.
   - **Authentication**: Enable Firebase Auth, activating the **Email/Password** provider.
   - **Firebase Hosting**: Activate hosting to publish both the portal and admin targets.

3. **Generate Admin Custom Role Claim**:
   - In the Firebase Console, register an admin email: `admin@velocitywifi.net`.
   - Assign the Custom Claim `role: "admin"` to the user profile via a Node.js helper or Firebase Functions Console to enable admin access.

4. **Service Account Key**:
   - Navigate to `Project Settings` -> `Service Accounts`.
   - Click **Generate New Private Key** and save it as `serviceAccountKey.json` inside your local `radius/` folder.

---

## 4. Deployment Steps

### 4.1 Cloud Functions Backend
1. Open the terminal and navigate to the root directory.
2. Install Cloud Functions dependencies:
   ```bash
   cd functions
   npm install
   ```
3. Deploy functions to the cloud:
   ```bash
   npm run deploy
   ```

### 4.2 Captive Portal & Admin Dashboard
1. Install Admin dashboard dependencies:
   ```bash
   cd admin
   npm install
   ```
2. Build the production React app bundle:
   ```bash
   npm run build
   ```
3. Deploy the portal and console websites to Firebase Hosting:
   - Make sure you assign the target sites:
     ```bash
     firebase target:apply hosting portal your-portal-site-name
     firebase target:apply hosting admin your-admin-site-name
     firebase deploy --only hosting
     ```

### 4.3 Custom RADIUS VPS Server
1. Provision a VPS (Ubuntu/Debian, 512MB RAM minimum).
2. Install Node.js (v18) and NPM on the VPS.
3. Clone or copy the `radius/` folder contents, including `dictionary.wispr` and your generated `serviceAccountKey.json` to the VPS.
4. Run installation and start process:
   ```bash
   npm install
   npm start
   ```
5. Ensure firewall ports `UDP 1812` (Authentication), `UDP 1813` (Accounting) and `UDP 3799` (incoming CoA for router) are opened.

---

## 5. Safaricom M-Pesa Daraja Integration

1. Register an account on the [Safaricom Developer Portal](https://developer.safaricom.co.ke/).
2. Create a new App in the portal to generate your `Consumer Key` and `Consumer Secret`.
3. In Sandbox mode, use the standard lipa-na-mpesa passkey and shortcode `174379`.
4. In Production, apply for a Daraja Lipa Na M-Pesa Online Paybill/Till number and generate production passkeys.

---

## 6. One-Paste MikroTik Setup Flow

Once the system is active, follow these steps to deploy a router hotspot:

1. **Register the Hotspot**:
   - Open your Admin dashboard, navigate to **Hotspot Settings** and click **Add Hotspot**.
   - Input the Shop name, router's public IP address, and set a 32-character RADIUS secret key. Save the record.

2. **Copy the Configuration Script**:
   - Click the **📜 Script** button next to your registered hotspot.
   - The script generator will create a custom RouterOS terminal command sequence. Click **Copy Script**.

3. **Paste in Router terminal**:
   - Open **WinBox**, connect to your MikroTik hAP Lite router.
   - Click **New Terminal** on the sidebar.
   - Right-click and select **Paste** (or press `Ctrl+V` on newer OS versions).
   - The router will configure its interfaces, DNS servers, walled garden whitelist domains, RADIUS sockets, and overwrite local files to redirect unauthenticated clients automatically.

4. **Test the Portal**:
   - Connect a smartphone or laptop to the configured router interface port/SSID.
   - You will be automatically redirected to the portal. Enter a phone number for M-Pesa STK push or redeem a voucher code, and gain instant connection!
