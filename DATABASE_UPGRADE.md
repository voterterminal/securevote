# Database Upgrade Guide — Demo Mode → PostgreSQL

**Version:** 1.3  
**Applies to:** Anyone who has been running SecureVote with the default in-memory (demo) storage and wants to upgrade to persistent PostgreSQL storage.

---

## Understanding the Two Modes

SecureVote v1.3 supports two storage modes:

**Demo mode** (no `DATABASE_URL` set)  
Data lives in the server's RAM. Zero setup required. Every server restart wipes all elections, votes, voter rolls, admin accounts, and settings. Good for local development and first-time setup. Not suitable for real elections.

**PostgreSQL mode** (`DATABASE_URL` set)  
Data is written to disk. Survives server restarts, crashes, deployments, and OS updates. Required for any election where the results need to persist.

---

## What Data Is at Risk

If you've been running demo mode on a live server, the following data is currently alive in RAM and will be lost permanently the next time the server restarts:

| Data | Lost on restart? | Can be backed up? |
|------|-----------------|-------------------|
| All elections (names, candidates, settings) | ✅ Yes | ✅ Yes |
| Voter rolls (email lists, access codes, who voted) | ✅ Yes | ✅ Yes |
| Admin accounts you added after setup | ✅ Yes | ✅ Yes |
| Password changes on existing admins | ✅ Yes | ✅ Yes |
| Org branding (name, logo, colors) | ✅ Yes | ✅ Yes |
| Email template customizations | ✅ Yes | ✅ Yes |
| Email provider settings | ✅ Yes | ⚠️ Partial (no credentials) |
| Affidavit templates you created | ✅ Yes | ✅ Yes |
| **Anonymous votes (ballot contents)** | ✅ Yes | ❌ No — by design |
| **Audit log** | ✅ Yes | ❌ No — not exposed via API |
| Your `.env` file | ❌ No | — |
| `affidavits.gdp.json` templates | ❌ No | — |

> **Important:** Anonymous votes cannot be exported. The privacy model intentionally prevents linking ballot contents to voter identities, which also means they cannot be safely moved between systems. If you need to preserve vote *counts and results*, export the results report from the admin panel before upgrading.

---

## Before You Upgrade — Save Your Results

If real elections have been run and the server has not restarted, the results are still in memory. Before doing anything else:

1. Log into the admin panel
2. Go to the **Results** tab for each completed election
3. Screenshot or copy the final tallies
4. Save them somewhere permanent (email, document, etc.)

You cannot recover this from the backup tool.

---

## Step-by-Step Upgrade

### Step 1: Back Up the Live Server

Run this on the machine where the server is currently running — **while the server is still up**. Do not restart the server until the backup is complete.

```bash
# On the live server, in the SecureVote project directory:
node export-data.js
```

This connects to your running server, authenticates as admin, and exports everything it can to a JSON file:

```
securevote-backup-2026-05-13.json
```

Keep this file. It contains admin password hashes — treat it like a password file.

If your server is running on a different URL or port:
```bash
node export-data.js --url http://yourdomain.com
```

If your admin credentials aren't the defaults:
```bash
ADMIN_EMAIL=yourname@org.com ADMIN_PASSWORD=yourpass node export-data.js
```

---

### Step 2: Set Up PostgreSQL

**Option A: Managed hosting (recommended — no server admin required)**

These services offer free or low-cost PostgreSQL with zero setup:

- **[Supabase](https://supabase.com)** — free tier, excellent for this use case
- **[Railway](https://railway.app)** — generous free tier
- **[Render](https://render.com)** — free PostgreSQL (spins down after inactivity)
- **[Neon](https://neon.tech)** — serverless Postgres, free tier
- **[DigitalOcean Managed Database](https://digitalocean.com)** — $15/mo, reliable

Each of these gives you a `DATABASE_URL` connection string directly in their dashboard. Copy it and go to Step 3.

**Option B: Self-hosted PostgreSQL**

If your server already has PostgreSQL installed:

```bash
# Create the database and user
psql -U postgres << 'EOF'
CREATE DATABASE securevote;
CREATE USER securevote_user WITH PASSWORD 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE securevote TO securevote_user;
EOF
```

Your connection string will be:
```
postgres://securevote_user:choose-a-strong-password@localhost:5432/securevote
```

---

### Step 3: Add DATABASE_URL to Your .env

Open your `.env` file and add:

```bash
DATABASE_URL=postgres://securevote_user:yourpassword@localhost:5432/securevote

# For hosted providers (Supabase, Railway, Render, etc.) — SSL is required:
# DATABASE_SSL=true   ← this is the default, you don't need to add it explicitly
#
# For local Postgres without SSL:
# DATABASE_SSL=false
```

---

### Step 4: Run the Migration

This creates all the tables. It is safe to run multiple times — it uses `CREATE TABLE IF NOT EXISTS` everywhere.

```bash
node migrate.js
```

Expected output:
```
🔄  Running SecureVote v1.3 database migration...

✅  All tables created (or already existed).

Next steps:
  1. Run:  node voting-app-server.js
  2. The server will seed the default admin and affidavit on first boot.
  3. If migrating from demo mode, run:  node import-data.js  on the OLD server first.
```

---

### Step 5: Import the Backup

```bash
node import-data.js securevote-backup-2026-05-13.json
```

Expected output:
```
📂  Backup file: securevote-backup-2026-05-13.json
    Exported at:  2026-05-13T...
    From server:  http://localhost:3001

👤  Importing 2 admin user(s)...
    ✅  Done.
📄  Importing 3 affidavit template(s)...
    ✅  Done.
🏢  Importing org config...
    ✅  Done.
📧  Importing email templates...
    ✅  Done.
📋  Importing 4 election(s)...
    "Spring 2026 Board Election": 47 voter roll entries
    "Bylaws Amendment Vote": 12 voter roll entries
    ✅  Elections done.

✅  Import complete!
```

---

### Step 6: Re-enter Email Provider Credentials

Email provider credentials (API keys, SMTP passwords) are never returned by the API and cannot be exported. After upgrading, either:

- Make sure they are already in your `.env` file (they'll be picked up automatically), or
- Log into the admin panel → Settings → Email and re-enter them there

---

### Step 7: Start the Server

```bash
node voting-app-server.js
```

You should see:
```
[DB] PostgreSQL connection verified.
[DB] Initialization complete.
🗳️  SecureVote v1.3 running on port 3001
   Storage: ✅  PostgreSQL (persistent)
   Environment: production
```

Log in as admin and verify your elections, voter rolls, and org settings are all present.

---

### Step 8: (Optional) Clean Up

Once you've confirmed everything is working:

```bash
# The backup file contains password hashes — store it safely or delete it
rm securevote-backup-2026-05-13.json
```

---

## What to Tell Your Users

If you're upgrading during an active election, here's a template message:

> **System Maintenance Notice**
>
> We are upgrading VoterTerminal.com to permanent database storage. The system will be briefly offline during this upgrade.
>
> **If you are currently in an active election:** your access code remains valid and you can continue voting after the upgrade is complete.
>
> **If you have already voted:** your vote has been preserved. All election data has been transferred to the new system.
>
> If you experience any issues after the upgrade, please contact your election administrator.

If any data was lost (e.g., the server restarted before the backup was taken):

> We recently upgraded our system and discovered that some configuration data was stored in a way that did not survive the upgrade. Specifically, the following may need to be re-entered:
>
> - Elections that were set up: please re-create them in the admin panel
> - Voter rolls: please re-upload your CSV files  
> - Org name and branding: please re-enter in Settings
> - Email templates: please re-enter any customizations in Settings
>
> We apologize for the inconvenience. The system now uses permanent database storage and this will not happen again.

---

## Troubleshooting

**`ERROR: role "securevote_user" does not exist`**  
You need to create the database user first. See Step 2.

**`FATAL: database "securevote" does not exist`**  
Create the database. See Step 2.

**`SSL: certificate verify failed` or similar**  
Add `DATABASE_SSL=false` to `.env` if running local Postgres without SSL.
For hosted providers, remove `DATABASE_SSL` entirely (SSL is the default).

**`Connection refused` or `ECONNREFUSED`**  
Check that PostgreSQL is running (`sudo systemctl status postgresql`) and that `DATABASE_URL` points to the right host and port.

**Import fails partway through**  
The import runs in a transaction — if it fails, nothing is committed. Fix the error and re-run. It's safe to re-run.

**Admin password isn't working after import**  
The password hashes were imported correctly. Try the password you were using on the old server. If it's not working, reset via:
```bash
# Temporary: set in .env and restart
ADMIN_EMAIL=you@org.com
ADMIN_PASSWORD=newpassword
```
The server seeds the default admin on startup if no admins exist, but won't overwrite existing ones. To force a password reset, connect to the database directly:
```sql
UPDATE admin_users SET password_hash = '$2a$10$...' WHERE email = 'you@org.com';
```
Use `bcryptjs` to generate the hash, or use the change-password endpoint once logged in.

---

## Rollback

If something goes wrong and you need to go back to demo mode temporarily:

1. Remove `DATABASE_URL` from `.env`
2. Restart the server

The server will start in demo mode again. Your PostgreSQL data is untouched — you can re-add `DATABASE_URL` and restart at any time to switch back.
