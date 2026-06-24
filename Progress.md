
# Progress Tracker
**Project:** MikroTik Hotspot Billing System
**Started:** 2026-05-31
**Status:** Ready for Testing & Configuration

---

## Phase 1 — Foundation
> Target: Week 1–2

| Task | Status | Notes |
|---|---|---|
| Project requirements defined | ✅ Done | See Project-Requirements.md |
| Firebase project created | ✅ Done | Templates and configuration created |
| Firestore schema set up | ✅ Done | Security rules and index files finalized |
| Firebase Auth configured | ✅ Done | Admin authorization logic created |
| Node.js project scaffolded | ✅ Done | Full structure, package.json files built |
| GitHub repo created | ⬜ Pending | |
| Domain / subdomain configured | ⬜ Pending | For portal and API |

---

## Phase 2 — RADIUS & Core Auth
> Target: Week 3–4

| Task | Status | Notes |
|---|---|---|
| RADIUS server setup | ✅ Done | server.js UDP sockets, WISPr dictionary complete |
| MikroTik RADIUS client config | ✅ Done | Configured in setup script |
| Voucher generation logic | ✅ Done | Cryptographically random, transaction-based |
| Session start/stop/accounting | ✅ Done | Accounting-Request listeners fully written |
| One-paste setup script (RouterOS) | ✅ Done | mikrotik.js endpoint generator written |
| Walled garden auto-configuration | ✅ Done | whitelisted portal and safaricom domains |
| Firewall rules script | ✅ Done | Idempotent script block created |

---

## Phase 3 — Payments Integration
> Target: Week 5–6

| Task | Status | Notes |
|---|---|---|
| M-Pesa Daraja credentials | ⬜ Pending | Apply on Safaricom developer portal |
| STK Push implementation | ✅ Done | payments.js axios integration complete |
| M-Pesa callback handler | ✅ Done | Atomic session activation transactions written |
| Payment → session activation flow | ✅ Done | Full integration finished |
| Airtel Money integration | ⬜ Pending | Optional |
| Payment retry/timeout handling | ✅ Done | Polling API, cancellation handling written |
| SMS confirmation on payment | ⬜ Pending | Optional |

---

## Phase 4 — Captive Portal
> Target: Week 7–8

| Task | Status | Notes |
|---|---|---|
| Portal HTML/CSS (mobile-first) | ✅ Done | Clean, minimal, glassmorphic UI built |
| Package selection screen | ✅ Done | Loaded dynamically from Firestore |
| Payment flow (STK Push UI) | ✅ Done | Normalises inputs, shows progress spinners |
| Voucher entry screen | ✅ Done | Validation handler with uppercase formatting |
| Success / error screens | ✅ Done | Displays countdown timer, stats, browse trigger |
| iOS Safari captive portal fix | ✅ Done | Platform check, redirection handling |
| Android WebView compatibility | ✅ Done | Plain JavaScript with no heavy library wrappers |
| Cross-device QA | ⬜ Pending | |

---

## Phase 5 — Admin Dashboard
> Target: Week 9–10

| Task | Status | Notes |
|---|---|---|
| Admin login (Firebase Auth) | ✅ Done | App.jsx checks operator profiles, claims |
| Dashboard overview | ✅ Done | Today's revenue, active users, activity stream |
| Package management UI | ✅ Done | Complete CRUD modals with speed caps |
| Voucher batch generation | ✅ Done | Batch input form, printable card layouts |
| Active sessions view | ✅ Done | Lists sessions with byte transfer totals |
| Session disconnect feature | ✅ Done | Disconnect buttons fire RADIUS CoA triggers |
| Reports (revenue chart) | ✅ Done | Custom ChartJS line graph for last 30 days |
| Multi-hotspot support | ✅ Done | settings.jsx controls multiple routers |

---

## Phase 6 — Testing & Launch
> Target: Week 11–12

| Task | Status | Notes |
|---|---|---|
| End-to-end test on hAP Lite | ⬜ Pending | |
| Load test RADIUS server | ⬜ Pending | |
| Payment flow QA | ⬜ Pending | |
| Security audit | ✅ Done | rules and rate limit boundaries implemented |
| Documentation written | ✅ Done | README.md complete |
| Production deployment | ⬜ Pending | |

---

## Blockers

| # | Issue | Priority | Status |
|---|---|---|---|
| 1 | M-Pesa Daraja API requires business registration | High | Pending |
| 2 | iOS Safari requires portal on HTTPS | High | Pending |
| 3 | FreeRADIUS vs custom RADIUS — decision needed | Medium | ✅ Resolved (Custom Node.js RADIUS server built) |

---

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-31 | Firebase as primary database | Google credits available; zero ops overhead; scales automatically |
| 2026-05-31 | All billing logic on cloud, not router | hAP Lite has 32MB RAM — router must stay lean |
| 2026-05-31 | Vanilla JS for captive portal | No framework overhead; fast on slow 3G connections |
| 2026-05-31 | Custom Node.js RADIUS server | Lighter than FreeRADIUS; easier to integrate with Firestore |

