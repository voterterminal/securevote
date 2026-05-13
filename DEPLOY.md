# VoteTerminal — Deploy Checklist

Quick reference for pushing changes to the live server and GitHub.

---

## 0 — Back up .env before every deploy

The `.env` file lives only on the server and must never be overwritten. Back it up first:

```bash
ssh dadeacon@66.179.191.190 "cp /var/www/voterterm/backend/.env /var/www/voterterm/backend/.env.bak && echo 'Backup OK'"
```

> If something ever goes wrong, restore it with:
> `ssh dadeacon@66.179.191.190 "cp /var/www/voterterm/backend/.env.bak /var/www/voterterm/backend/.env"`

---

## 1 — Upload to the Server (GDP tenant)

Run these commands from your Mac terminal.

### 1a — Copy updated backend files

```bash
SERVER=dadeacon@66.179.191.190
BACKEND=/var/www/voterterm/backend

scp ~/Documents/SecureVote-Project/voting-app-server.js  $SERVER:$BACKEND/
scp ~/Documents/SecureVote-Project/email-service.js       $SERVER:$BACKEND/
scp ~/Documents/SecureVote-Project/affidavits.gdp.json    $SERVER:$BACKEND/
```

### 1b — Add the two new env vars (first deploy only)

```bash
ssh dadeacon@66.179.191.190 << 'EOF'
echo "" >> /var/www/voterterm/backend/.env
echo "# Ballot link in invite emails" >> /var/www/voterterm/backend/.env
echo "APP_URL=https://gdp.voterterminal.com" >> /var/www/voterterm/backend/.env
echo "" >> /var/www/voterterm/backend/.env
echo "# GCDP affidavit templates" >> /var/www/voterterm/backend/.env
echo "AFFIDAVIT_TEMPLATES_FILE=./affidavits.gdp.json" >> /var/www/voterterm/backend/.env
EOF
```

> Skip 1b on future deploys — env vars persist on the server.

### 1c — Restart the app

```bash
ssh dadeacon@66.179.191.190 "pm2 restart voterterminal && pm2 save"
```

### 1d — Rebuild and deploy the React frontend

```bash
cd ~/Documents/SecureVote-Project/frontend

VITE_API_URL=https://gdp.voterterminal.com/api npm run build

scp -r build/* dadeacon@66.179.191.190:/var/www/voterterm/frontend/build/
```

### 1e — Verify it's live

```bash
curl -sf https://gdp.voterterminal.com/api/health && echo "Backend OK"
```

Then open https://gdp.voterterminal.com/admin in your browser and log in.

---

## 2 — Push to GitHub

```bash
cd ~/Documents/SecureVote-Project

git add -A

git commit -m "feat: voter roll upload in election form, affidavit templates, invite email editor, ballot link in invite emails"

git push origin main
```

### What's in this commit

| File | Change |
|------|--------|
| `VotingApp.jsx` | Voter roll CSV upload in Create Election; Affidavit selector with live preview; AffidavitManager tab; Invite email editor in Settings |
| `VotingApp.css` | Styles for all new UI sections |
| `voting-app-server.js` | Affidavit CRUD endpoints; email template GET/PUT; APP_URL ballot link; affidavit snapshot on elections |
| `email-service.js` | `inviteCode()` accepts custom subject, intro, instruction, help, and footnote fields |
| `affidavits.gdp.json` | GCDP-specific oath templates (loaded via env var — not in general release) |
| `.env.example` | Documents `APP_URL` and `AFFIDAVIT_TEMPLATES_FILE` |
| `USER_MANUAL.docx` | Updated for all new features |

---

## 3 — Quick Fix During or After the Demo

```bash
# Edit the file on your Mac, then:
scp ~/Documents/SecureVote-Project/<changed-file> dadeacon@66.179.191.190:/var/www/voterterm/backend/
ssh dadeacon@66.179.191.190 "pm2 restart voterterminal"
```

For frontend-only changes (CSS/JSX), rebuild and scp the `build/` folder as in step 1d — no pm2 restart needed.
