# VoteTerminal — Installation Guide

Choose your installation method:

- **[Community Edition](#community-edition)** — install directly on your server (recommended for most users)
- **[Docker Edition](#docker-edition)** — run in containers (recommended if you already use Docker)

---

## System Requirements

### Minimum
| Component | Requirement |
|-----------|-------------|
| RAM | 512 MB (1 GB recommended) |
| Disk | 2 GB free space |
| CPU | 1 vCPU |
| Network | Public IP address |
| Domain | A domain or subdomain pointing to your server |

### Supported Operating Systems

**Debian-based (Community + Docker)**
| OS | Versions |
|----|---------|
| Ubuntu | 20.04 LTS, 22.04 LTS, 24.04 LTS |
| Debian | 11 (Bullseye), 12 (Bookworm) |

**Red Hat-based (Community + Docker)**
| OS | Versions |
|----|---------|
| RHEL | 8, 9 |
| CentOS Stream | 8, 9 |
| Rocky Linux | 8, 9 |
| AlmaLinux | 8, 9 |
| Fedora | 37, 38, 39, 40 |

**Docker (any OS with Docker Engine)**
| OS | Notes |
|----|-------|
| Any Linux | Requires Docker Engine 20.10+ and Docker Compose v2 |
| macOS | Docker Desktop 4.0+ |
| Windows | Docker Desktop with WSL2 backend |

### Software (auto-installed by the installer)
- Node.js 20 LTS
- npm 9+
- Apache (httpd) with mod_proxy
- pm2 (process manager)
- certbot (Let's Encrypt SSL)

---

## Before You Begin

1. **Point your DNS** — add an A record for your domain pointing to your server's public IP. The SSL step requires this to be live.
2. **Open ports** — ensure ports 80 (HTTP) and 443 (HTTPS) are open in your firewall or cloud security group.
3. **Have root access** — both install methods require `sudo` or root.

---

## Community Edition

The community edition installs directly on your server using Apache as the web server and pm2 as the process manager.

### Quick Install

```bash
# 1. Download the VoteTerminal package and unzip it, then:
chmod +x install.sh
sudo ./install.sh
```

The installer will ask for:
- Your domain name (e.g. `vote.myorg.com`)
- Your organisation name
- Admin email and password
- Email provider (Resend, SMTP, or console/test mode)

It handles everything else automatically.

---

### Manual Install — Debian / Ubuntu

If you prefer to install step by step:

**Step 1 — Update and install dependencies**
```bash
sudo apt-get update
sudo apt-get install -y curl openssl apache2 certbot python3-certbot-apache
```

**Step 2 — Install Node.js 20**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v20.x.x
```

**Step 3 — Install pm2**
```bash
sudo npm install -g pm2
```

**Step 4 — Create directory structure**
```bash
sudo mkdir -p /var/www/voterterm/{backend,frontend/build,landing}
sudo chown -R $USER:$USER /var/www/voterterm
```

**Step 5 — Upload files and install dependencies**
```bash
# Upload voting-app-server.js, email-service.js, package.json to /var/www/voterterm/backend/
cd /var/www/voterterm/backend
npm install --omit=dev
```

**Step 6 — Create .env**
```bash
nano /var/www/voterterm/backend/.env
```
See `.env.example` for all available options.

**Step 7 — Enable Apache modules and configure**
```bash
sudo a2enmod proxy proxy_http rewrite headers
# Copy apache-voterterminal.conf to /etc/apache2/sites-available/
sudo a2ensite voterterminal.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

**Step 8 — Start with pm2**
```bash
cd /var/www/voterterm/backend
pm2 start voting-app-server.js --name voterterminal
pm2 save
pm2 startup   # follow the printed command
```

**Step 9 — SSL**
```bash
sudo certbot --apache -d yourdomain.com
```

---

### Manual Install — Red Hat / CentOS / Rocky / Alma

**Step 1 — Install dependencies**
```bash
# Install EPEL (required for certbot)
sudo dnf install -y epel-release

sudo dnf install -y curl openssl httpd mod_ssl certbot python3-certbot-apache

# Enable and start httpd
sudo systemctl enable --now httpd

# Open firewall
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

**Step 2 — Install Node.js 20**
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node --version   # should print v20.x.x
```

**Step 3 — Install pm2**
```bash
sudo npm install -g pm2
```

**Step 4 — Create directory structure**
```bash
sudo mkdir -p /var/www/voterterm/{backend,frontend/build,landing}
sudo chown -R $USER:$USER /var/www/voterterm
```

**Step 5 — Upload files and install dependencies**
```bash
cd /var/www/voterterm/backend
npm install --omit=dev
```

**Step 6 — Create .env**
```bash
nano /var/www/voterterm/backend/.env
```

**Step 7 — Configure httpd**

Create `/etc/httpd/conf.d/voterterminal.conf`:
```apacheconf
<VirtualHost *:80>
    ServerName yourdomain.com
    DocumentRoot /var/www/voterterm/frontend/build

    ProxyPreserveHost On
    ProxyPass /api http://localhost:3001/api
    ProxyPassReverse /api http://localhost:3001/api

    <Directory /var/www/voterterm/frontend/build>
        Options -Indexes
        AllowOverride All
        Require all granted
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^ /index.html [L]
    </Directory>

    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
</VirtualHost>
```

```bash
# Allow httpd to connect to Node.js (SELinux)
sudo setsebool -P httpd_can_network_connect 1

sudo httpd -t        # must say: Syntax OK
sudo systemctl reload httpd
```

**Step 8 — Start with pm2**
```bash
cd /var/www/voterterm/backend
pm2 start voting-app-server.js --name voterterminal
pm2 save
pm2 startup
```

**Step 9 — SSL**
```bash
sudo certbot --apache -d yourdomain.com
```

> **Note on SELinux:** If you see permission errors connecting to Node.js, run:
> `sudo setsebool -P httpd_can_network_connect 1`

---

## Docker Edition

The Docker edition runs VoteTerminal in containers. nginx handles SSL termination and proxying; Node.js runs in an isolated container.

### Prerequisites

Install Docker Engine and Docker Compose v2:

**Ubuntu / Debian:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in after this
```

**RHEL / CentOS / Rocky / Alma:**
```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

**Fedora:**
```bash
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Verify:
```bash
docker --version         # Docker version 24+
docker compose version   # Docker Compose version v2+
```

---

### Docker Quick Start

**Step 1 — Copy and configure environment**
```bash
cp .env.example .env
nano .env   # fill in JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, email settings
```

**Step 2 — Get an SSL certificate (before starting Docker)**

The nginx container uses certificates managed by certbot on the host. Get them first:
```bash
sudo apt-get install -y certbot   # or: sudo dnf install -y certbot
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
```

**Step 3 — Configure nginx**

Edit `docker/nginx.conf` and replace `voterterminal.com` with your domain.

**Step 4 — Build and start**
```bash
docker compose up -d --build
```

**Step 5 — Verify**
```bash
docker compose ps           # both containers should be running
docker compose logs app     # check for startup errors
curl http://localhost/api/health   # should return {"status":"ok",...}
```

---

### Docker Management Commands

```bash
# View logs
docker compose logs -f app

# Restart after a code change
docker compose up -d --build app

# Stop everything
docker compose down

# Update environment variables
nano .env
docker compose up -d   # picks up new env vars

# Shell into the container
docker compose exec app sh
```

---

### Updating to a New Version (Docker)

```bash
# Pull new code, then rebuild
docker compose up -d --build
```

The build process automatically rebuilds the React frontend inside Docker using the `voting-app/` directory on your host.

---

## Post-Install: First Steps

After either install method:

1. **Open your admin panel** at `https://yourdomain.com/admin`
2. **Log in** with the email and password you set during installation
3. **Change your password** in ⚙️ Settings → Change Password
4. **Configure email** — add your Resend API key or SMTP settings so voter confirmation emails work
5. **Create your first election** in the Elections tab
6. **Test it** — register as a voter, cast a vote, verify the confirmation email arrives

---

## Troubleshooting

**403 Forbidden on the site**
```bash
# Check which VirtualHost Apache matched
sudo apachectl -S          # Debian/Ubuntu
sudo httpd -S              # RHEL/CentOS

# Check error logs
sudo tail -30 /var/log/apache2/error.log    # Debian
sudo tail -30 /var/log/httpd/error_log      # RHEL
```

**API returning 503 Service Unavailable**
```bash
pm2 status
pm2 logs voterterminal --lines 30
curl http://localhost:3001/api/health
```

**Node.js won't start (check for errors)**
```bash
pm2 logs voterterminal --lines 50
# Common causes: missing .env, wrong file path, syntax error in server file
```

**SELinux blocking proxy (RHEL/CentOS only)**
```bash
sudo setsebool -P httpd_can_network_connect 1
sudo systemctl reload httpd
```

**Emails landing in spam**
- Add SPF, DKIM, and DMARC DNS records (your email provider will give you the values)
- Use a real sending domain — not gmail.com or hotmail.com

**SSL certificate not renewing**
```bash
sudo certbot renew --dry-run
sudo systemctl status certbot.timer   # Debian
sudo systemctl status crond           # RHEL
```

---

## Getting Help

- Self-host guide with branding instructions: `SELF_HOST.md`
- Redeployment reference: `REDEPLOY.md`
- Managed hosting: [voterterminal.com](https://voterterminal.com)
- Email: elections@voterterminal.com
