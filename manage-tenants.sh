#!/usr/bin/env bash
# ============================================================
# VoterTerminal — Tenant Management CLI
# ============================================================
# All commands talk to the superadmin API on your live server.
#
# Usage:
#   ./manage-tenants.sh <command> [options]
#
# Commands:
#   list                         List all tenants
#   add     <subdomain>          Add a tenant interactively
#   remove  <subdomain>          Delete a tenant and all its data
#   info    <subdomain>          Show full tenant details
#   plan    <subdomain> <plan>   Change plan (free/starter/pro/enterprise/grandfathered)
#   suspend <subdomain>          Suspend a tenant (blocks all logins)
#   reactivate <subdomain>       Re-activate a suspended tenant
#   reset-admin <subdomain>      Force-reset (or add) an admin account
#   list-admins <subdomain>      List all admin accounts for a tenant
#
# Config (set as env vars or edit defaults below):
#   VTADMIN_URL      Base URL of your server  (default: https://voterterminal.com)
#   VTADMIN_EMAIL    Superadmin email
#   VTADMIN_PASS     Superadmin password
#   VTADMIN_TOKEN    Pre-supplied JWT (skips login)
#
# Example:
#   VTADMIN_EMAIL=super@voterterminal.com VTADMIN_PASS=secret ./manage-tenants.sh list
# ============================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL="${VTADMIN_URL:-https://voterterminal.com}"
SA_EMAIL="${VTADMIN_EMAIL:-}"
SA_PASS="${VTADMIN_PASS:-}"
TOKEN="${VTADMIN_TOKEN:-}"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}ℹ  $*${RESET}"; }
ok()      { echo -e "${GREEN}✔  $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠  $*${RESET}"; }
die()     { echo -e "${RED}✖  $*${RESET}" >&2; exit 1; }
heading() { echo -e "\n${BOLD}$*${RESET}"; }

# ── Dependency check ──────────────────────────────────────────────────────────
for cmd in curl jq; do
  command -v "$cmd" &>/dev/null || die "$cmd is required. Install it first: apt install $cmd  OR  brew install $cmd"
done

# ── Get superadmin token ──────────────────────────────────────────────────────
get_token() {
  if [ -n "$TOKEN" ]; then return; fi

  if [ -z "$SA_EMAIL" ]; then
    echo -n "Superadmin email: "; read -r SA_EMAIL
  fi
  if [ -z "$SA_PASS" ]; then
    echo -n "Superadmin password: "; read -rs SA_PASS; echo
  fi

  info "Authenticating as $SA_EMAIL..."
  RESP=$(curl -sf -X POST "$BASE_URL/api/superadmin/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$SA_EMAIL\",\"password\":\"$SA_PASS\"}" 2>&1) \
    || die "Login failed — check URL and credentials.\nResponse: $RESP"

  TOKEN=$(echo "$RESP" | jq -r '.token // empty')
  [ -n "$TOKEN" ] || die "No token returned. Response: $RESP"
  ok "Authenticated."
}

# ── API helpers ───────────────────────────────────────────────────────────────
api_get() {
  curl -sf -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/superadmin/$1"
}

api_post() {
  curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$2" "$BASE_URL/api/superadmin/$1"
}

api_put() {
  curl -sf -X PUT -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$2" "$BASE_URL/api/superadmin/$1"
}

api_delete() {
  curl -sf -X DELETE -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/superadmin/$1"
}

# ============================================================
# COMMANDS
# ============================================================

cmd_list() {
  get_token
  heading "All Tenants"
  RESP=$(api_get tenants)
  echo "$RESP" | jq -r '
    ["SUBDOMAIN","ORG NAME","PLAN","STATUS","ELECTIONS","CREATED"],
    ["─────────","────────","────","──────","─────────","───────"],
    (.[] | [.subdomain, .orgName, .plan, .status, (.elections|tostring), .createdAt[:10]])
    | @tsv' | column -t
  echo ""
  COUNT=$(echo "$RESP" | jq 'length')
  ok "$COUNT tenant(s) total."
}

cmd_info() {
  local SUB="${1:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain: "; read -r SUB; }
  get_token
  heading "Tenant: $SUB"
  api_get "tenants" | jq --arg s "$SUB" '.[] | select(.subdomain==$s)'
}

cmd_add() {
  local SUB="${1:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain (e.g. myorg): "; read -r SUB; }
  echo -n "Org name: "; read -r ORG_NAME
  echo -n "Admin email: "; read -r ADMIN_EMAIL
  echo -n "Admin password (min 8 chars): "; read -rs ADMIN_PASS; echo
  echo "Plan [free/starter/pro/enterprise] (default: starter): "; read -r PLAN
  PLAN="${PLAN:-starter}"

  get_token
  info "Creating tenant '$SUB'..."
  RESP=$(api_post tenants \
    "{\"subdomain\":\"$SUB\",\"orgName\":\"$ORG_NAME\",\"adminEmail\":\"$ADMIN_EMAIL\",\"adminPassword\":\"$ADMIN_PASS\",\"plan\":\"$PLAN\"}")
  echo "$RESP" | jq .
  ok "Tenant '$SUB' created. They can now log in at: https://$SUB.voterterminal.com/admin"
}

cmd_remove() {
  local SUB="${1:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain to delete: "; read -r SUB; }

  warn "This will permanently delete tenant '$SUB' and ALL its data (elections, votes, voters)."
  echo -n "Type the subdomain again to confirm: "; read -r CONFIRM
  [ "$CONFIRM" = "$SUB" ] || die "Confirmation did not match. Aborting."

  get_token
  info "Deleting tenant '$SUB'..."
  RESP=$(api_delete "tenants/$SUB")
  echo "$RESP" | jq .
  ok "Tenant '$SUB' deleted."
}

cmd_plan() {
  local SUB="${1:-}" PLAN="${2:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain: "; read -r SUB; }
  [ -n "$PLAN" ] || { echo -n "New plan [free/starter/pro/enterprise/grandfathered]: "; read -r PLAN; }

  get_token
  info "Updating '$SUB' to plan '$PLAN'..."
  RESP=$(api_put "tenants/$SUB/plan" "{\"plan\":\"$PLAN\"}")
  echo "$RESP" | jq .
  ok "Plan updated."
}

cmd_suspend() {
  local SUB="${1:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain to suspend: "; read -r SUB; }
  get_token
  info "Suspending '$SUB'..."
  RESP=$(api_put "tenants/$SUB/plan" "{\"status\":\"suspended\"}")
  echo "$RESP" | jq .
  ok "'$SUB' is now suspended. Tenant admins and voters will see an access-denied message."
}

cmd_reactivate() {
  local SUB="${1:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain to reactivate: "; read -r SUB; }
  get_token
  info "Reactivating '$SUB'..."
  RESP=$(api_put "tenants/$SUB/plan" "{\"status\":\"active\"}")
  echo "$RESP" | jq .
  ok "'$SUB' is now active."
}

cmd_reset_admin() {
  local SUB="${1:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain: "; read -r SUB; }
  echo -n "Admin email to reset (or create): "; read -r ADMIN_EMAIL
  echo -n "New password (min 8 chars): "; read -rs ADMIN_PASS; echo

  get_token
  info "Resetting admin '$ADMIN_EMAIL' on tenant '$SUB'..."
  RESP=$(api_put "tenants/$SUB/reset-admin" \
    "{\"email\":\"$ADMIN_EMAIL\",\"newPassword\":\"$ADMIN_PASS\"}")
  echo "$RESP" | jq .
  ok "Done. Admin can now log in at https://$SUB.voterterminal.com/admin"
}

cmd_list_admins() {
  local SUB="${1:-}"
  [ -n "$SUB" ] || { echo -n "Subdomain: "; read -r SUB; }
  get_token
  heading "Admin accounts for: $SUB"

  # Temporarily login as tenant admin via superadmin token isn't directly available,
  # so we read from the tenant listing and show what we have.
  warn "Note: this shows tenant summary only. For full admin list SSH to the server and run:"
  echo "  node -e \"const t=require('./tenants.json'); console.log(JSON.stringify(t['$SUB'].adminUsers.map(a=>({id:a.id,email:a.email})),null,2))\""
}

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF

${BOLD}VoterTerminal Tenant Manager${RESET}

Usage: ./manage-tenants.sh <command> [subdomain] [options]

  ${CYAN}list${RESET}                      List all tenants
  ${CYAN}add${RESET}      <subdomain>       Create a new tenant
  ${CYAN}remove${RESET}   <subdomain>       Delete a tenant (with confirmation)
  ${CYAN}info${RESET}     <subdomain>       Show tenant details
  ${CYAN}plan${RESET}     <subdomain> <plan>  Change plan
  ${CYAN}suspend${RESET}  <subdomain>       Suspend tenant access
  ${CYAN}reactivate${RESET} <subdomain>     Restore suspended tenant
  ${CYAN}reset-admin${RESET} <subdomain>    Force-reset or add an admin account
  ${CYAN}list-admins${RESET} <subdomain>    List admin accounts

Plans: free | starter | pro | enterprise | grandfathered

Config env vars:
  VTADMIN_URL    Server base URL  (default: https://voterterminal.com)
  VTADMIN_EMAIL  Superadmin email
  VTADMIN_PASS   Superadmin password

EOF
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
CMD="${1:-}"
shift 2>/dev/null || true

case "$CMD" in
  list)        cmd_list ;;
  info)        cmd_info "$@" ;;
  add)         cmd_add "$@" ;;
  remove)      cmd_remove "$@" ;;
  plan)        cmd_plan "$@" ;;
  suspend)     cmd_suspend "$@" ;;
  reactivate)  cmd_reactivate "$@" ;;
  reset-admin) cmd_reset_admin "$@" ;;
  list-admins) cmd_list_admins "$@" ;;
  *)           usage; exit 0 ;;
esac
