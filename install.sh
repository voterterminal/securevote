#!/bin/bash
# ==========================================
# VoteTerminal — Self-Install Script
# ==========================================
# Supports:
#   Debian-based:  Ubuntu 20.04+, Debian 11+
#   Red Hat-based: RHEL 8/9, CentOS Stream 8/9, Rocky Linux 8/9,
#                  AlmaLinux 8/9, Fedora 37+
#
# Installs: Node.js 20, pm2, Apache (httpd), VoteTerminal
#
# Usage:
#   chmod +x install.sh
#   sudo ./install.sh
# ==========================================

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
section() { echo -e "\n${BOLD}━━━ $1 ━━━${NC}"; }

# ── Root check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  error "Please run as root: sudo ./install.sh"
fi

# ── Detect OS family ──────────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID}"
    OS_ID_LIKE="${ID_LIKE:-}"
    OS_VERSION="${VERSION_ID:-}"
    OS_NAME="${PRETTY_NAME:-$NAME}"
  else
    error "Cannot detect OS. /etc/os-release not found."
  fi

  # Determine family
  if echo "${OS_ID} ${OS_ID_LIKE}" | grep -qiE "debian|ubuntu"; then
    OS_FAMILY="debian"
    PKG_MANAGER="apt-get"
    APACHE_SERVICE="apache2"
    APACHE_PKG="apache2"
    APACHE_CONF_DIR="/etc/apache2/sites-available"
    APACHE_ENABLED_DIR="/etc/apache2/sites-enabled"
    APACHE_LOG_VAR='${APACHE_LOG_DIR}'
    APACHE_CONF_EXT=".conf"
    CERTBOT_PKG="certbot python3-certbot-apache"
    ENABLE_SITE_CMD="a2ensite"
    ENABLE_MOD_CMD="a2enmod"
  elif echo "${OS_ID} ${OS_ID_LIKE}" | grep -qiE "rhel|centos|fedora|rocky|alma|ol"; then
    OS_FAMILY="rhel"
    # Prefer dnf, fall back to yum
    if command -v dnf &>/dev/null; then
      PKG_MANAGER="dnf"
    else
      PKG_MANAGER="yum"
    fi
    APACHE_SERVICE="httpd"
    APACHE_PKG="httpd mod_ssl mod_proxy mod_proxy_http"
    APACHE_CONF_DIR="/etc/httpd/conf.d"
    APACHE_ENABLED_DIR="/etc/httpd/conf.d"
    APACHE_LOG_VAR='/var/log/httpd'
    APACHE_CONF_EXT=".conf"
    CERTBOT_PKG="certbot python3-certbot-apache"
    ENABLE_SITE_CMD=""   # Not needed on RHEL — drop file in conf.d
    ENABLE_MOD_CMD=""    # Modules enabled via LoadModule / package install
  else
    error "Unsupported OS: ${OS_NAME}. Supported: Ubuntu, Debian, RHEL, CentOS, Rocky, Alma, Fedora."
  fi
}

detect_os

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║        VoteTerminal Installer        ║${NC}"
echo -e "${BOLD}║  Anonymous Voting Platform — v1.0   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""
info "Detected OS: ${OS_NAME} (${OS_FAMILY} family)"
echo ""

# ── Gather config ─────────────────────────────────────────────────────────────
section "Configuration"

read -p "Your domain (e.g. vote.myorg.com): " DOMAIN
[ -z "$DOMAIN" ] && error "Domain is required."

read -p "Your organization name: " ORG_NAME
[ -z "$ORG_NAME" ] && ORG_NAME="My Organization"

read -p "Admin email address: " ADMIN_EMAIL
[ -z "$ADMIN_EMAIL" ] && error "Admin email is required."

while true; do
  read -s -p "Admin password (min 8 chars): " ADMIN_PASSWORD; echo
  [ ${#ADMIN_PASSWORD} -ge 8 ] && break
  warn "Password must be at least 8 characters."
done

read -p "Email provider (resend/smtp/console) [console]: " EMAIL_PROVIDER
EMAIL_PROVIDER=${EMAIL_PROVIDER:-console}

RESEND_API_KEY=""
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""
EMAIL_FROM="elections@${DOMAIN}"

if [ "$EMAIL_PROVIDER" = "resend" ]; then
  read -p "Resend API key: " RESEND_API_KEY
elif [ "$EMAIL_PROVIDER" = "smtp" ]; then
  read -p "SMTP host: " SMTP_HOST
  read -p "SMTP port [587]: " SMTP_PORT; SMTP_PORT=${SMTP_PORT:-587}
  read -p "SMTP username: " SMTP_USER
  read -s -p "SMTP password: " SMTP_PASS; echo
fi

read -p "Email from address [elections@${DOMAIN}]: " EMAIL_FROM_INPUT
[ -n "$EMAIL_FROM_INPUT" ] && EMAIL_FROM="$EMAIL_FROM_INPUT"

INSTALL_DIR="/var/www/voterterm"
JWT_SECRET=$(openssl rand -hex 32)
EMERGENCY_PASSWORD=$(openssl rand -hex 12)
DEPLOY_USER=${SUDO_USER:-$USER}

echo ""
info "Installing to: ${INSTALL_DIR}"
info "Domain:        ${DOMAIN}"
info "Org name:      ${ORG_NAME}"
info "Admin email:   ${ADMIN_EMAIL}"
info "Run as user:   ${DEPLOY_USER}"
echo ""
read -p "Proceed? [y/N]: " CONFIRM
[ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ] && { info "Aborted."; exit 0; }

# ── System packages ───────────────────────────────────────────────────────────
section "Installing system packages"

if [ "$OS_FAMILY" = "debian" ]; then
  apt-get update -qq
  apt-get install -y -qq curl openssl ${APACHE_PKG} ${CERTBOT_PKG}

elif [ "$OS_FAMILY" = "rhel" ]; then
  # Enable EPEL (needed for certbot on RHEL/CentOS/Rocky/Alma)
  if ! rpm -q epel-release &>/dev/null; then
    if command -v dnf &>/dev/null; then
      dnf install -y -q epel-release 2>/dev/null || \
        dnf install -y -q https://dl.fedoraproject.org/pub/epel/epel-release-latest-$(rpm -E %rhel).noarch.rpm 2>/dev/null || true
    else
      yum install -y -q epel-release 2>/dev/null || true
    fi
  fi

  $PKG_MANAGER install -y -q curl openssl ${APACHE_PKG} ${CERTBOT_PKG}

  # Enable and start httpd
  systemctl enable --now httpd >/dev/null 2>&1

  # Open firewall if firewalld is running
  if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http  >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    info "Firewall opened for HTTP/HTTPS"
  fi
fi

success "System packages installed"

# ── Node.js 20 ────────────────────────────────────────────────────────────────
section "Installing Node.js 20"

if ! command -v node &>/dev/null || [[ "$(node --version)" != v20* ]]; then
  if [ "$OS_FAMILY" = "debian" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
  elif [ "$OS_FAMILY" = "rhel" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    $PKG_MANAGER install -y -q nodejs
  fi
fi

success "Node.js $(node --version) ready"

# ── pm2 ───────────────────────────────────────────────────────────────────────
section "Installing pm2"
npm install -g pm2 --silent
success "pm2 installed"

# ── Folder structure ──────────────────────────────────────────────────────────
section "Creating directory structure"
mkdir -p "${INSTALL_DIR}/backend"
mkdir -p "${INSTALL_DIR}/frontend/build"
mkdir -p "${INSTALL_DIR}/landing"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${INSTALL_DIR}"
success "Directories created at ${INSTALL_DIR}"

# ── Copy files ────────────────────────────────────────────────────────────────
section "Copying application files"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cp "${SCRIPT_DIR}/voting-app-server.js" "${INSTALL_DIR}/backend/"
cp "${SCRIPT_DIR}/email-service.js"     "${INSTALL_DIR}/backend/"
cp "${SCRIPT_DIR}/package.json"         "${INSTALL_DIR}/backend/"

if [ -d "${SCRIPT_DIR}/landing" ]; then
  cp -r "${SCRIPT_DIR}/landing/." "${INSTALL_DIR}/landing/"
fi

if [ -d "${SCRIPT_DIR}/voting-app/build" ]; then
  cp -r "${SCRIPT_DIR}/voting-app/build/." "${INSTALL_DIR}/frontend/build/"
  success "React frontend copied"
else
  warn "No React build found. Build it on your Mac and upload to ${INSTALL_DIR}/frontend/build/"
fi

chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${INSTALL_DIR}"
success "Files copied"

# ── npm install ───────────────────────────────────────────────────────────────
section "Installing Node.js dependencies"
cd "${INSTALL_DIR}/backend"
sudo -u "${DEPLOY_USER}" npm install --omit=dev --silent
success "Dependencies installed"

# ── .env file ─────────────────────────────────────────────────────────────────
section "Creating .env file"
cat > "${INSTALL_DIR}/backend/.env" <<EOF
NODE_ENV=production
PORT=3001
JWT_SECRET=${JWT_SECRET}
EMERGENCY_PASSWORD=${EMERGENCY_PASSWORD}

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

ORG_NAME=${ORG_NAME}
ORG_TAGLINE=Official Ballot

EMAIL_PROVIDER=${EMAIL_PROVIDER}
EMAIL_FROM=${EMAIL_FROM}
EMAIL_FROM_NAME=${ORG_NAME}
EOF

if [ "$EMAIL_PROVIDER" = "resend" ]; then
  echo "RESEND_API_KEY=${RESEND_API_KEY}" >> "${INSTALL_DIR}/backend/.env"
elif [ "$EMAIL_PROVIDER" = "smtp" ]; then
  cat >> "${INSTALL_DIR}/backend/.env" <<EOF
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
EOF
fi

chmod 600 "${INSTALL_DIR}/backend/.env"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${INSTALL_DIR}/backend/.env"
success ".env created"

# ── Apache / httpd config ──────────────────────────────────────────────────────
section "Configuring web server (${APACHE_SERVICE})"

VHOST_FILE="${APACHE_CONF_DIR}/voterterminal-${DOMAIN}${APACHE_CONF_EXT}"

if [ "$OS_FAMILY" = "debian" ]; then
  # Enable required modules
  a2enmod proxy proxy_http rewrite headers >/dev/null 2>&1

  cat > "${VHOST_FILE}" <<EOF
<VirtualHost *:80>
    ServerName ${DOMAIN}
    DocumentRoot ${INSTALL_DIR}/frontend/build

    ProxyPreserveHost On
    ProxyPass /api http://localhost:3001/api
    ProxyPassReverse /api http://localhost:3001/api

    <Directory ${INSTALL_DIR}/frontend/build>
        Options -Indexes
        AllowOverride All
        Require all granted
        FallbackResource /index.html
    </Directory>

    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"

    ErrorLog \${APACHE_LOG_DIR}/${DOMAIN}-error.log
    CustomLog \${APACHE_LOG_DIR}/${DOMAIN}-access.log combined
</VirtualHost>
EOF

  a2ensite "voterterminal-${DOMAIN}.conf" >/dev/null 2>&1
  apache2ctl configtest 2>&1 | grep -v Warning
  systemctl reload apache2

elif [ "$OS_FAMILY" = "rhel" ]; then
  # On RHEL, mod_proxy is typically already available via httpd package
  # Just drop the config file in conf.d — no a2ensite needed

  cat > "${VHOST_FILE}" <<EOF
<VirtualHost *:80>
    ServerName ${DOMAIN}
    DocumentRoot ${INSTALL_DIR}/frontend/build

    ProxyPreserveHost On
    ProxyPass /api http://localhost:3001/api
    ProxyPassReverse /api http://localhost:3001/api

    <Directory ${INSTALL_DIR}/frontend/build>
        Options -Indexes
        AllowOverride All
        Require all granted
        DirectoryIndex index.html
        # React Router fallback
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^ /index.html [L]
    </Directory>

    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"

    ErrorLog /var/log/httpd/${DOMAIN}-error.log
    CustomLog /var/log/httpd/${DOMAIN}-access.log combined
</VirtualHost>
EOF

  # Disable default welcome page
  if [ -f /etc/httpd/conf.d/welcome.conf ]; then
    mv /etc/httpd/conf.d/welcome.conf /etc/httpd/conf.d/welcome.conf.disabled 2>/dev/null || true
  fi

  # SELinux: allow httpd to connect to Node.js
  if command -v setsebool &>/dev/null; then
    setsebool -P httpd_can_network_connect 1 >/dev/null 2>&1 || true
    info "SELinux: httpd_can_network_connect enabled"
  fi

  httpd -t 2>&1 | grep -v Warning
  systemctl reload httpd
fi

success "${APACHE_SERVICE} configured for ${DOMAIN}"

# ── Start with pm2 ────────────────────────────────────────────────────────────
section "Starting VoteTerminal with pm2"
cd "${INSTALL_DIR}/backend"
sudo -u "${DEPLOY_USER}" pm2 start voting-app-server.js --name voterterminal 2>/dev/null || \
  sudo -u "${DEPLOY_USER}" pm2 restart voterterminal
sudo -u "${DEPLOY_USER}" pm2 save

# Set up pm2 startup for systemd (works on both Debian and RHEL)
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
  -u "${DEPLOY_USER}" --hp "/home/${DEPLOY_USER}" 2>/dev/null | grep "sudo" | bash 2>/dev/null || true
success "pm2 started and configured for auto-restart on reboot"

# ── SSL ───────────────────────────────────────────────────────────────────────
section "SSL Certificate (Let's Encrypt)"
echo ""
warn "DNS must point ${DOMAIN} to this server's IP before certbot will work."
read -p "Run certbot now? [y/N]: " RUN_CERTBOT
if [ "$RUN_CERTBOT" = "y" ] || [ "$RUN_CERTBOT" = "Y" ]; then
  if [ "$OS_FAMILY" = "debian" ]; then
    certbot --apache -d "${DOMAIN}" --non-interactive --agree-tos -m "${ADMIN_EMAIL}"
  elif [ "$OS_FAMILY" = "rhel" ]; then
    certbot --apache -d "${DOMAIN}" --non-interactive --agree-tos -m "${ADMIN_EMAIL}"
  fi
  success "SSL certificate installed — auto-renewal configured"
else
  info "When DNS is ready, run:"
  if [ "$OS_FAMILY" = "debian" ]; then
    echo "  sudo certbot --apache -d ${DOMAIN}"
  else
    echo "  sudo certbot --apache -d ${DOMAIN}"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
section "Installation Complete"
echo ""
echo -e "${GREEN}${BOLD}VoteTerminal is installed!${NC}"
echo ""
echo -e "  ${BOLD}Voter portal:${NC}    http://${DOMAIN}"
echo -e "  ${BOLD}Admin panel:${NC}     http://${DOMAIN}/admin"
echo -e "  ${BOLD}Admin login:${NC}     ${ADMIN_EMAIL}"
echo ""
echo -e "${YELLOW}${BOLD}━━━ SAVE THESE — shown only once ━━━${NC}"
echo -e "  ${BOLD}Emergency password:${NC}  ${EMERGENCY_PASSWORD}"
echo -e "  ${BOLD}Secrets file:${NC}        ${INSTALL_DIR}/backend/.env"
echo ""
echo -e "  ${BOLD}View logs:${NC}    pm2 logs voterterminal"
echo -e "  ${BOLD}Restart:${NC}      pm2 restart voterterminal"
echo -e "  ${BOLD}Full guide:${NC}   see SELF_HOST.md and REDEPLOY.md"
echo ""
