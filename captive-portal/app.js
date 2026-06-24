/**
 * VelocityWiFi Captive Portal Client Logic
 */

// Global Configuration / State
const CONFIG = {
    // Under Firebase Hosting rewrite, /api forwards to the Cloud Functions backend
    apiBase: window.location.origin + '/api', 
    pollingInterval: 5000, // 5 seconds
    maxPollingTime: 90000, // 90 seconds
};

const state = {
    mac: null,
    ip: null,
    linkLogin: null,
    linkOrig: null,
    selectedPackage: null,
    currentPaymentId: null,
    activeSession: null,
    timerInterval: null,
};

// DOM Elements
const views = {
    landing: document.getElementById('view-landing'),
    packages: document.getElementById('view-packages'),
    payment: document.getElementById('view-payment'),
    status: document.getElementById('view-status'),
    voucher: document.getElementById('view-voucher'),
    connected: document.getElementById('view-connected'),
};

const iosWarning = document.getElementById('ios-warning');
const packagesContainer = document.getElementById('packages-container');
const summaryPackageName = document.getElementById('summary-package-name');
const summaryPackagePrice = document.getElementById('summary-package-price');
const paymentForm = document.getElementById('payment-form');
const phoneNumberInput = document.getElementById('phone-number');
const voucherForm = document.getElementById('voucher-form');
const voucherCodeInput = document.getElementById('voucher-code');
const statusTitle = document.getElementById('status-title');
const statusDesc = document.getElementById('status-desc');
const statusProgressBar = document.getElementById('status-progress');
const statusTimer = document.getElementById('status-timer');
const connectedTimeRemaining = document.getElementById('connected-time-remaining');
const connectedMac = document.getElementById('connected-mac');
const connectedIp = document.getElementById('connected-ip');
const btnCancelPolling = document.getElementById('btn-cancel-polling');

// Toast Notification Elements
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastClose = document.getElementById('toast-close');

// Initialize Captive Portal
document.addEventListener('DOMContentLoaded', () => {
    parseQueryParams();
    detectPlatform();
    setupEventListeners();
    checkExistingSession();
});

// Parse Query Parameters from MikroTik redirect
function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    
    // MikroTik commonly sends: mac, ip, link-login, link-orig, error
    state.mac = params.get('mac') || params.get('mac-address') || '';
    state.ip = params.get('ip') || '';
    state.linkLogin = params.get('link-login') || params.get('link-login-only') || '';
    state.linkOrig = params.get('link-orig') || '';
    
    // Log info for debugging in console
    console.log('Router Parameters:', {
        mac: state.mac,
        ip: state.ip,
        linkLogin: state.linkLogin,
        linkOrig: state.linkOrig
    });

    if (params.get('error')) {
        showToast(params.get('error'), 'error');
    }
}

// Platform detection (specifically iOS Captive Network Assistant)
function detectPlatform() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    
    // The iOS CNA WebView uses a specific user agent pattern or triggers on Apple domains
    // If we are on iOS, show a helpful alert explaining how to prevent session dropping
    if (isIOS) {
        iosWarning.classList.remove('hidden');
    }
}

// Setup Event Handlers
function setupEventListeners() {
    // Navigation triggers
    document.getElementById('btn-show-packages').addEventListener('click', showPackagesView);
    document.getElementById('btn-show-voucher').addEventListener('click', () => switchView('voucher'));
    
    document.getElementById('btn-packages-back').addEventListener('click', () => switchView('landing'));
    document.getElementById('btn-payment-back').addEventListener('click', showPackagesView);
    document.getElementById('btn-voucher-back').addEventListener('click', () => switchView('landing'));

    // Forms submission
    paymentForm.addEventListener('submit', handlePaymentSubmit);
    voucherForm.addEventListener('submit', handleVoucherSubmit);

    // Cancel Polling
    btnCancelPolling.addEventListener('click', () => {
        stopPolling();
        switchView('packages');
    });

    // Toast Close
    toastClose.addEventListener('click', hideToast);

    // Browse Button
    document.getElementById('btn-browse').addEventListener('click', () => {
        if (state.linkOrig) {
            window.location.href = state.linkOrig;
        } else {
            window.location.href = 'https://www.google.com';
        }
    });

    // Format voucher input to UPPERCASE and add hyphens automatically
    voucherCodeInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (value.length > 12) value = value.substring(0, 12);
        
        // Add dashes (XXXX-XXXX-XXXX)
        let formatted = '';
        for (let i = 0; i < value.length; i++) {
            if (i > 0 && i % 4 === 0) formatted += '-';
            formatted += value[i];
        }
        e.target.value = formatted;
    });
}

// Check if a session already exists in LocalStorage
function checkExistingSession() {
    try {
        const storedSession = localStorage.getItem('active_session');
        if (storedSession) {
            const session = JSON.parse(storedSession);
            const expiresAt = new Date(session.expires_at).getTime();
            const now = Date.now();
            
            // If session is still valid, resume the connected screen
            if (expiresAt > now && (!state.mac || state.mac.toLowerCase() === session.mac_address.toLowerCase())) {
                state.activeSession = session;
                showConnectedView();
            } else {
                localStorage.removeItem('active_session');
            }
        }
    } catch (e) {
        console.error('Error reading session from local storage', e);
    }
}

// Router-based view switching with simple transition effect
function switchView(viewId) {
    Object.keys(views).forEach(key => {
        if (key === viewId) {
            views[key].classList.add('active');
        } else {
            views[key].classList.remove('active');
        }
    });
    // Scroll to top of viewport
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Fetch and display packages
async function showPackagesView() {
    switchView('packages');
    
    // Clear current package container and show skeleton loaders
    packagesContainer.innerHTML = `
        <div class="shimmer-card"></div>
        <div class="shimmer-card"></div>
        <div class="shimmer-card"></div>
    `;

    try {
        const response = await fetch(`${CONFIG.apiBase}/packages`);
        const result = await response.json();
        
        if (result.success) {
            renderPackages(result.data);
        } else {
            throw new Error(result.error || 'Failed to fetch packages');
        }
    } catch (error) {
        console.error('Packages Fetch Error:', error);
        showToast('Error loading packages. Please try again.', 'error');
        packagesContainer.innerHTML = `
            <div class="error-state">
                <p>Failed to load packages.</p>
                <button class="btn btn-secondary" onclick="showPackagesView()">Retry</button>
            </div>
        `;
    }
}

// Render package cards in UI
function renderPackages(packages) {
    packagesContainer.innerHTML = '';
    
    const activePackages = packages.filter(pkg => pkg.active !== false);

    if (activePackages.length === 0) {
        packagesContainer.innerHTML = '<p class="text-center">No active packages available.</p>';
        return;
    }

    activePackages.forEach(pkg => {
        const card = document.createElement('div');
        card.className = 'package-card';
        
        const dataLimit = pkg.data_limit_mb ? `${pkg.data_limit_mb} MB` : 'Unlimited Data';
        const durationText = getDurationText(pkg.duration_hours);
        
        card.innerHTML = `
            <div class="package-info">
                <div class="package-name">${pkg.name}</div>
                <div class="package-meta">
                    <span class="package-limit">${dataLimit}</span>
                    <span>&bull;</span>
                    <span>${pkg.speed_down_kbps / 1024} Mbps Down</span>
                </div>
            </div>
            <div class="package-pricing">
                <div class="package-price">KES ${pkg.price_kes}</div>
                <div class="package-duration">${durationText}</div>
            </div>
        `;
        
        card.addEventListener('click', () => initiatePaymentSelection(pkg));
        packagesContainer.appendChild(card);
    });
}

function getDurationText(hours) {
    if (hours < 1) {
        return `${Math.round(hours * 60)} Mins`;
    } else if (hours === 1) {
        return '1 Hour';
    } else if (hours < 24) {
        return `${hours} Hours`;
    } else {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days} Day${days > 1 ? 's' : ''} ${remainingHours > 0 ? `${remainingHours} hrs` : ''}`.trim();
    }
}

// Start M-Pesa detail gathering
function initiatePaymentSelection(pkg) {
    state.selectedPackage = pkg;
    summaryPackageName.innerText = pkg.name;
    summaryPackagePrice.innerText = `KES ${pkg.price_kes}`;
    switchView('payment');
}

// Normalise phone number to 2547XX... or 2541XX... format
function normalisePhoneNumber(phone) {
    // Remove all non-numeric characters
    let cleaned = phone.replace(/[^0-9]/g, '');
    
    // Handle 07XX... and 01XX...
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    }
    
    // Handle +254 or 254
    if (cleaned.length === 9) { // e.g. 712345678
        cleaned = '254' + cleaned;
    }
    
    // Final check for Kenyan structure (12 digits, starting with 254)
    if (/^254(7|1)[0-9]{8}$/.test(cleaned)) {
        return cleaned;
    }
    
    return null;
}

// Handle payment form submission
async function handlePaymentSubmit(e) {
    e.preventDefault();
    
    const rawPhone = phoneNumberInput.value.trim();
    const normalisedPhone = normalisePhoneNumber(rawPhone);
    
    if (!normalisedPhone) {
        showToast('Please enter a valid M-Pesa number (e.g. 07XXXXXXXX or 01XXXXXXXX)', 'error');
        return;
    }

    if (!state.mac) {
        // For testing, mock a MAC if not redirecting from RouterOS
        state.mac = 'AA:BB:CC:DD:EE:FF';
        console.warn('No MAC address detected. Generating mock MAC for testing: AA:BB:CC:DD:EE:FF');
    }

    const payButton = document.getElementById('btn-pay-now');
    payButton.disabled = true;
    payButton.innerHTML = '<span>Processing...</span>';

    try {
        const response = await fetch(`${CONFIG.apiBase}/payments/initiate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone_number: normalisedPhone,
                package_id: state.selectedPackage.id,
                mac_address: state.mac,
                ip_address: state.ip
            }),
        });

        const result = await response.json();
        
        if (result.success) {
            state.currentPaymentId = result.data.payment_id;
            startPaymentPolling();
        } else {
            throw new Error(result.error || 'Failed to initiate payment');
        }
    } catch (error) {
        console.error('Payment Error:', error);
        showToast(error.message || 'M-Pesa STK push failed. Please try again.', 'error');
    } finally {
        payButton.disabled = false;
        payButton.innerHTML = '<span>Pay via M-Pesa</span>';
    }
}

// Poll M-Pesa STK push status
let pollingTimeout = null;
let pollStartTime = 0;

function startPaymentPolling() {
    switchView('status');
    btnCancelPolling.classList.remove('hidden');
    statusTitle.innerText = "Requesting M-Pesa STK Push...";
    statusDesc.innerText = "Confirm the M-Pesa PIN prompt on your phone now.";
    
    pollStartTime = Date.now();
    statusProgressBar.style.transform = 'translateX(-100%)';
    
    // Start polling sequence
    pollStatus();
}

async function pollStatus() {
    const elapsed = Date.now() - pollStartTime;
    const remainingSeconds = Math.max(0, Math.round((CONFIG.maxPollingTime - elapsed) / 1000));
    
    // Update progress UI
    statusTimer.innerText = `${remainingSeconds}s remaining`;
    const progressPercent = Math.min(100, (elapsed / CONFIG.maxPollingTime) * 100);
    statusProgressBar.style.transform = `translateX(${progressPercent - 100}%)`;

    if (elapsed >= CONFIG.maxPollingTime) {
        handlePollingTimeout();
        return;
    }

    try {
        const response = await fetch(`${CONFIG.apiBase}/payments/status/${state.currentPaymentId}`);
        const result = await response.json();

        if (result.success) {
            const status = result.data.status;
            
            if (status === 'success') {
                stopPolling();
                // Save session returned in database response
                state.activeSession = result.data.session;
                localStorage.setItem('active_session', JSON.stringify(state.activeSession));
                
                statusTitle.innerText = "Payment Successful!";
                statusDesc.innerText = "Authenticating with network, please wait...";
                
                await authenticateWithRouter();
            } else if (status === 'failed') {
                stopPolling();
                showToast('Payment was rejected or failed. Please try again.', 'error');
                switchView('payment');
            } else {
                // Keep polling if 'pending'
                pollingTimeout = setTimeout(pollStatus, CONFIG.pollingInterval);
            }
        } else {
            // Log issue, continue polling in case of transient API error
            console.error('Polling error from API:', result.error);
            pollingTimeout = setTimeout(pollStatus, CONFIG.pollingInterval);
        }
    } catch (error) {
        console.error('Polling Net Error:', error);
        pollingTimeout = setTimeout(pollStatus, CONFIG.pollingInterval);
    }
}

function stopPolling() {
    if (pollingTimeout) {
        clearTimeout(pollingTimeout);
        pollingTimeout = null;
    }
}

function handlePollingTimeout() {
    stopPolling();
    showToast('Payment verification timed out. If you charged, please check with admin.', 'error');
    switchView('payment');
}

// Handle Voucher Form Submission
async function handleVoucherSubmit(e) {
    e.preventDefault();
    
    const code = voucherCodeInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (code.length !== 12) {
        showToast('Please enter a complete 12-digit voucher code.', 'error');
        return;
    }

    if (!state.mac) {
        state.mac = 'AA:BB:CC:DD:EE:FF';
    }

    const redeemButton = document.getElementById('btn-redeem-voucher');
    redeemButton.disabled = true;
    redeemButton.innerHTML = '<span>Validating Voucher...</span>';

    try {
        const response = await fetch(`${CONFIG.apiBase}/vouchers/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                mac_address: state.mac,
                ip_address: state.ip
            }),
        });

        const result = await response.json();

        if (result.success) {
            state.activeSession = result.data.session;
            localStorage.setItem('active_session', JSON.stringify(state.activeSession));
            
            showToast('Voucher Redeemed Successfully!', 'success');
            await authenticateWithRouter();
        } else {
            throw new Error(result.error || 'Voucher code is invalid or expired.');
        }
    } catch (error) {
        console.error('Voucher Error:', error);
        showToast(error.message, 'error');
    } finally {
        redeemButton.disabled = false;
        redeemButton.innerHTML = '<span>Connect Using Voucher</span>';
    }
}

// Log Client Into MikroTik Router Hotspot
async function authenticateWithRouter() {
    if (!state.linkLogin) {
        console.warn('Not connected to a MikroTik Hotspot router interface. Mocking network entry.');
        showConnectedView();
        return;
    }

    try {
        // Authenticating via PAP/CHAP standard login on MikroTik hotspot
        // We submit a POST request to linkLogin with mac as username/password
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = state.linkLogin;
        form.style.display = 'none';

        // Add standard RouterOS Hotspot input fields
        const usernameInput = document.createElement('input');
        usernameInput.type = 'hidden';
        usernameInput.name = 'username';
        usernameInput.value = state.mac.toLowerCase(); // RADIUS verifies active session by MAC address
        form.appendChild(usernameInput);

        const passwordInput = document.createElement('input');
        passwordInput.type = 'hidden';
        passwordInput.name = 'password';
        passwordInput.value = state.mac.toLowerCase();
        form.appendChild(passwordInput);

        // Include destination redirect if present
        if (state.linkOrig) {
            const dstInput = document.createElement('input');
            dstInput.type = 'hidden';
            dstInput.name = 'dst';
            dstInput.value = state.linkOrig;
            form.appendChild(dstInput);
        }

        document.body.appendChild(form);
        
        // Short pause to show user success status before redirect
        setTimeout(() => {
            form.submit();
        }, 1500);

    } catch (e) {
        console.error('Router Login Redirection Failed:', e);
        showToast('Connected, but router login redirection failed. Try reloading any page.', 'warning');
        showConnectedView();
    }
}

// Render and countdown on the connected screen
function showConnectedView() {
    switchView('connected');
    
    connectedMac.innerText = state.activeSession.mac_address;
    connectedIp.innerText = state.ip || state.activeSession.ip_address || 'Dynamic';
    
    // Clear any previous interval running
    if (state.timerInterval) clearInterval(state.timerInterval);
    
    const expiryTime = new Date(state.activeSession.expires_at).getTime();
    
    function updateCountdown() {
        const now = Date.now();
        const diff = expiryTime - now;
        
        if (diff <= 0) {
            clearInterval(state.timerInterval);
            connectedTimeRemaining.innerText = "Expired";
            connectedTimeRemaining.style.color = "var(--error)";
            localStorage.removeItem('active_session');
            showToast('Your session has expired. Redirecting...', 'warning');
            setTimeout(() => switchView('landing'), 3000);
            return;
        }
        
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        const pad = (num) => String(num).padStart(2, '0');
        connectedTimeRemaining.innerText = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    
    updateCountdown();
    state.timerInterval = setInterval(updateCountdown, 1000);
}

// Toast Helpers
function showToast(message, type = 'info') {
    toastMessage.innerText = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    
    // Auto-hide after 5 seconds
    setTimeout(hideToast, 5000);
}

function hideToast() {
    toast.classList.add('hidden');
}
