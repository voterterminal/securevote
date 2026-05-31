<div align="center">

<img src="logo.svg" alt="VoterTerminal" width="80" height="80" />

<h1>VoterTerminal — Community Edition</h1>

**Free, self-hosted voting for organizations that need a real ballot — not a survey tool**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org)
[![Self-hostable](https://img.shields.io/badge/Self--host-free%20forever-brightgreen.svg)](#-quick-start)
[![Docker](https://img.shields.io/badge/Docker-supported-blue.svg)](#option-2--docker)

[**Managed hosting**](https://voterterminal.com) · [**Install guide**](INSTALL.md) · [**Report a bug**](https://github.com/voterterminal/securevote/issues)

</div>

---

VoterTerminal Community Edition is an open-source, self-hosted voting app. Voters show up, scan a QR code or go to your URL, enter a shared ballot code, and vote — no email addresses, no voter roll, no accounts. Results are calculated automatically when you end the election.

Built for small organizations, clubs, committees, and any group that needs a fast, anonymous, in-person vote.

---

## ✨ What's included

| Feature | Details |
|---|---|
| 🗳️ **Ballot voting** | Candidates listed on a clean ballot; voter taps one to select |
| 🔒 **Anonymous by design** | Session tokens only — no names, no emails, no identity stored |
| 📱 **QR code display** | One-click QR code for the ballot URL — display on a monitor or print it |
| 📊 **Live results** | Real-time tally as votes come in; final results when you end the election |
| 🏷️ **Org branding** | Your organization name, logo, and colors on the ballot page |
| 🛡️ **Anti-double-vote** | Each browser session can vote exactly once |
| 👥 **Admin dashboard** | Create elections, manage candidates, view results, end elections |

**Community Edition limits** (upgrade to [VoterTerminal SaaS](https://voterterminal.com) to remove them):
- One active election at a time
- Up to 2 admin accounts
- Plurality voting only (most votes wins)
- No voter roll — anyone with the ballot code can vote

---

## 🚀 Quick Start

### Option 1 — One-command Linux install

```bash
curl -fsSL https://raw.githubusercontent.com/voterterminal/securevote/community/install.sh | bash
```

The installer handles Node.js, Apache, pm2, Let's Encrypt SSL, and first-run setup automatically.
Works on **Ubuntu 20.04+, Debian 11+, RHEL/AlmaLinux/Rocky 8–9, CentOS Stream, and Fedora 37+**.

→ Full guide: [INSTALL.md](INSTALL.md)

### Option 2 — Docker

```bash
cp .env.example .env          # fill in your settings
docker compose up -d --build
```

→ Full guide: [INSTALL.md](INSTALL.md)

---

## 🗳️ How it works

**Admin side:**
1. Log in at `yourdomain.com/admin`
2. Create an election — give it a name, set a ballot code (e.g. `VOTE2026`), set an end time, add candidates
3. Share the ballot code with voters (announce it, write it on a whiteboard, show the QR code)
4. When voting closes, click "End Election" to see the final tally

**Voter side:**
1. Go to `yourdomain.com` (or scan the QR code)
2. Select the active election
3. Enter the ballot code
4. Tap a candidate and submit

Votes are anonymous. The server stores a session token per browser to prevent double-voting — no name or email is ever collected.

---

## 🔒 How anonymity works

```
sessions (anti-double-vote)     votes (ballot choices)
────────────────────────────    ─────────────────────
sessionId (random hex)          electionId
electionId               ✗      candidateName
                   no link      timestamp
```

`sessionId` is generated fresh when a voter enters the ballot code. It proves they have access but carries no identity. The vote record has no reference back to who cast it.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and set at minimum:

```bash
JWT_SECRET=a-long-random-string-here
ADMIN_EMAIL=admin@yourorg.com
ADMIN_PASSWORD=your-secure-password
ORG_NAME=Your Organization Name

# Optional: PostgreSQL for data that survives restarts
# DATABASE_URL=postgres://user:pass@host:5432/dbname
```

Without `DATABASE_URL` the app runs in **demo mode** — all data lives in RAM and wipes on restart. Fine for a single meeting; set a real database for anything ongoing.

→ See [DATABASE_UPGRADE.md](DATABASE_UPGRADE.md) to add PostgreSQL later.

---

## 📦 File reference

| File | Purpose |
|---|---|
| `voting-app-server.js` | Express backend — all API routes |
| `db.js` | Database abstraction (in-memory + PostgreSQL) |
| `VotingApp.jsx` | React frontend — admin dashboard + voter portal |
| `VotingApp.css` | Frontend styles |
| `migrate.js` | PostgreSQL schema setup (run once) |
| `install.sh` | One-command Linux server installer |
| `Dockerfile` + `docker-compose.yml` | Docker install option |
| `.env.example` | All configuration variables with docs |
| `INSTALL.md` | Full install guide |
| `SELF_HOST.md` | Branding & customization |
| `DATABASE_UPGRADE.md` | Switching from demo mode to PostgreSQL |

---

## 🌐 Server requirements

**Minimum:** 512 MB RAM · 1 vCPU · 2 GB disk · public IP · domain name

| OS | Versions |
|----|---------|
| Ubuntu | 20.04 LTS, 22.04 LTS, 24.04 LTS |
| Debian | 11, 12 |
| RHEL / AlmaLinux / Rocky Linux | 8, 9 |
| CentOS Stream | 8, 9 |
| Fedora | 37–40 |
| Docker | Any OS with Docker Engine 20.10+ |

---

## ⬆️ Need more?

Community Edition is designed for simple in-person votes. If you need any of these, upgrade to [VoterTerminal SaaS](https://voterterminal.com):

- **Voter rolls** — invite specific voters by email with individual access codes
- **Ranked choice voting** (IRV) and majority threshold voting
- **Multiple simultaneous elections**
- **Emergency audit panel** — see who voted (not how) for dispute resolution
- **Affidavit / oath** — voters sign a statement before casting a ballot
- **Unlimited admins**
- **Managed hosting** — no server to maintain

→ [voterterminal.com](https://voterterminal.com) — 7-day free trial, plans from $29/mo

---

## 🤝 Contributing

Pull requests are welcome. Open an issue first for significant changes.

1. Fork the repo and create a feature branch
2. Make your changes
3. Test with `node voting-app-server.js` — it should start cleanly
4. Open a pull request

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and distribute.

---

## 📬 Support

- **Self-host questions:** [GitHub Issues](https://github.com/voterterminal/securevote/issues)
- **Managed hosting:** [voterterminal.com](https://voterterminal.com)
- **Email:** [elections@voterterminal.com](mailto:elections@voterterminal.com)

---

<div align="center">
Built for communities that take fair elections seriously.
</div>
