<div align="center">

<img src="logo.svg" alt="VoterTerminal" width="80" height="80" />

<h1>VoterTerminal</h1>

**Anonymous, secure, self-hostable voting for communities, nonprofits, and civic organizations**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org)
[![Self-hostable](https://img.shields.io/badge/Self--host-free%20forever-brightgreen.svg)](#-self-hosted-edition)
[![Docker](https://img.shields.io/badge/Docker-supported-blue.svg)](#-docker-edition)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[**Live demo**](https://demo.voterterminal.com) · [**Managed hosting**](https://voterterminal.com) · [**Install guide**](INSTALL.md) · [**Report a bug**](https://github.com/voterterminal/securevote/issues)

</div>

---

VoterTerminal is an open-source voting platform built for organizations that need **real elections** — not survey-tool workarounds. It separates voter identity from ballot choices at the data level so even administrators cannot see how any individual voted.

Built for HOAs, nonprofits, political parties, civic organizations, and any group that takes democratic process seriously.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔒 **True anonymity** | Voter identity and ballot choices stored in completely separate records — no shared ID, ever |
| ✅ **Verified voters** | Email-verified access codes prevent duplicate votes without compromising ballot secrecy |
| 🗂️ **Voter rolls** | Upload a CSV of eligible voters; the system sends each one a personal access code automatically |
| 📧 **Email receipts** | Every voter gets a confirmation receipt ID after voting — proof their vote was counted |
| 📊 **Live results** | Real-time turnout and tallies as votes come in; auto-calculated when election closes |
| 🏷️ **Custom branding** | Your logo, org name, and colors — voters see your brand, not ours |
| 🌐 **Multiple voting methods** | Plurality, majority (50%+1), and instant-runoff ranked choice |
| 🛡️ **Emergency audit trail** | Password-protected panel shows *who voted* (not *how*) for dispute resolution |
| 📬 **Flexible email delivery** | Resend, SendGrid, Mailgun, or any SMTP provider |

---

## 🚀 Quick Start

### Option 1 — Self-hosted (one command)

```bash
# 1. Download and unzip VoterTerminal, then:
chmod +x install.sh
sudo ./install.sh
```

The installer handles Node.js, Apache, pm2, Let's Encrypt SSL, and first-run configuration automatically. Works on **Ubuntu, Debian, RHEL, CentOS, Rocky Linux, AlmaLinux, and Fedora**.

→ Full guide: [INSTALL.md](INSTALL.md)

### Option 2 — Docker

```bash
cp .env.example .env          # fill in your settings
sudo certbot certonly --standalone -d yourdomain.com
docker compose up -d --build
```

→ Full guide: [INSTALL.md#docker-edition](INSTALL.md#docker-edition)

### Option 3 — Managed hosting

Skip the server entirely. We handle setup, updates, email delivery, and SSL.
→ [voterterminal.com](https://voterterminal.com) — 7-day free trial, Starter from $29/mo.

---

## 🔐 How anonymity works

Most "secure voting" tools claim anonymity but store enough data to reconstruct a voter's choices. VoterTerminal uses a two-table architecture:

```
voters[]                    votes[]
─────────────────           ──────────────────
id                          id
email         ✗  no link    electionId
hasVoted                    candidateId
votedAt                     timestamp
receiptId  ─────────────→   receiptId
```

The `receiptId` is a randomly generated token. It proves a ballot exists but carries no identity information. Even with full database access, it is not possible to link a specific person to a specific ballot.

---

## 🗳️ Voting methods

- **Plurality** — most votes wins (board elections, officer races)
- **Majority** — winner must exceed 50% (constitutional amendments, bylaws)
- **Ranked Choice (IRV)** — voters rank candidates; instant runoff until a winner emerges

---

## 🏗️ Architecture

```
voterterminal.com/           ← Marketing landing page (static HTML)
org.voterterminal.com/       ← React frontend
  ├── /                      ← Voter portal
  └── /admin                 ← Admin dashboard
      └── Apache → Node.js (voting-app-server.js) on :3001
```

**Stack:**
- **Backend:** Node.js 20 / Express — `voting-app-server.js`
- **Frontend:** React (Create React App) — `VotingApp.jsx` + `VotingApp.css`
- **Email:** Pluggable via `email-service.js` (Resend / SendGrid / Mailgun / SMTP)
- **Process manager:** pm2
- **Web server:** Apache (Community edition) or nginx (Docker edition)
- **SSL:** Let's Encrypt / certbot (auto-renews)

**SaaS / multi-tenant:**
- `tenant-server.js` — multi-tenant backend with Stripe billing, trial management, and per-subdomain isolation
- `stripe-setup.js` — one-time Stripe product/price provisioning script

---

## ⚙️ Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in:

```bash
# Required
JWT_SECRET=your-random-secret-here
ADMIN_EMAIL=admin@yourorg.com
ADMIN_PASSWORD=your-secure-password

# Email (choose one provider)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxx

# Branding
ORG_NAME=Your Organization Name
ORG_LOGO_URL=https://yourorg.com/logo.png
ORG_TAGLINE=Official Ballot
```

See [`.env.example`](.env.example) for the full list with documentation.

---

## 📦 File Reference

| File | Purpose |
|------|---------|
| `voting-app-server.js` | Single-tenant backend (production) |
| `tenant-server.js` | Multi-tenant SaaS backend |
| `email-service.js` | Pluggable email delivery |
| `stripe-setup.js` | One-time Stripe product setup script |
| `VotingApp.jsx` | React frontend (compile with Create React App) |
| `VotingApp.css` | Frontend styles |
| `install.sh` | One-command server installer |
| `.env.example` | Configuration reference |
| `INSTALL.md` | Full installation guide |
| `SELF_HOST.md` | Branding & customization guide |
| `REDEPLOY.md` | Deployment workflow quick reference |
| `Dockerfile` | Multi-stage Docker build |
| `docker-compose.yml` | Docker Compose stack (app + nginx) |
| `docker/nginx.conf` | nginx reverse proxy config |
| `landing/index.html` | voterterminal.com marketing page |

---

## 🌐 Self-hosted Edition

**Minimum requirements:** 512 MB RAM · 2 GB disk · 1 vCPU · public IP · domain name

**Supported operating systems:**

| OS | Versions |
|----|---------|
| Ubuntu | 20.04 LTS, 22.04 LTS, 24.04 LTS |
| Debian | 11 (Bullseye), 12 (Bookworm) |
| RHEL / AlmaLinux / Rocky Linux | 8, 9 |
| CentOS Stream | 8, 9 |
| Fedora | 37, 38, 39, 40 |
| Docker (any Linux / macOS / Windows) | Docker Engine 20.10+ |

---

## 🐳 Docker Edition

```bash
docker compose up -d --build   # start
docker compose logs -f app     # tail logs
docker compose down            # stop
docker compose up -d --build app  # redeploy after changes
```

---

## 💳 Plans

| | Self-hosted | Starter | Pro | Enterprise |
|---|---|---|---|---|
| **Price** | Free forever | $29/mo | $75/mo | Custom |
| **Elections** | Unlimited | 10/month | Unlimited | Unlimited |
| **Voters per election** | Unlimited | 500 | 2,000 | Unlimited |
| **Email delivery** | Bring your own | ✅ Included | ✅ Included | ✅ Included |
| **Custom branding** | ✅ | ✅ | ✅ | ✅ White-label |
| **Support** | Community | Email | Priority | Dedicated rep |
| **Multi-chapter** | ❌ | ❌ | ❌ | ✅ |
| **SLA** | ❌ | ❌ | ❌ | ✅ |

Managed plans include a **7-day free trial** — no setup fees, cancel any time. No per-election fees, ever. Competitors charge $99–$299 per election; VoterTerminal's flat monthly rate saves most active organizations money within 2 months.

→ [voterterminal.com/#pricing](https://voterterminal.com/#pricing)

---

## 🤝 Contributing

Pull requests are welcome. For significant changes, please open an issue first.

1. Fork the repo and create a feature branch (`git checkout -b feature/my-feature`)
2. Make your changes
3. Make sure `node voting-app-server.js` starts without errors
4. Commit and push, then open a pull request

Please document any new environment variables in `.env.example`.

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and distribute. Attribution appreciated but not required.

---

## 📬 Support

- **Self-host questions:** Open a [GitHub issue](https://github.com/voterterminal/securevote/issues)
- **Managed hosting:** [voterterminal.com](https://voterterminal.com)
- **Enterprise / large-org inquiries:** [elections@voterterminal.com](mailto:elections@voterterminal.com)

---

<div align="center">
Built with ❤️ for communities that care about fair elections.
</div>
