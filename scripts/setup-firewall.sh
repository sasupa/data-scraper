#!/usr/bin/env bash
# Idempotent ufw rule for an internal service: allow incoming on a port
# via the Tailscale interface only. ufw's default-deny + lack of any
# explicit allow on other interfaces keeps everything else blocked, so
# the public Hetzner IP cannot reach the service even when the process
# is bound to 0.0.0.0.
#
# Usage:
#   sudo scripts/setup-firewall.sh <port> [service-name]
#
# Examples:
#   sudo scripts/setup-firewall.sh 3030 datascraper
#   sudo scripts/setup-firewall.sh 3025 metube-api
#
# Re-running with the same arguments is safe — ufw skips existing rules.
# Run this manually whenever you add a new internal service. Do NOT
# auto-run from any deploy hook; opening firewall ports is the kind of
# decision that should always be human-acknowledged.

set -euo pipefail

PORT="${1:-}"
SERVICE="${2:-internal}"

if [[ -z "$PORT" || ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "usage: $0 <port> [service-name]" >&2
  echo "  port must be a number in 1..65535" >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "must run as root (use sudo)" >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw is not installed" >&2
  exit 1
fi

if ! ip link show tailscale0 >/dev/null 2>&1; then
  echo "tailscale0 interface not found — install Tailscale and run 'sudo tailscale up' first" >&2
  exit 1
fi

if ! ufw status | grep -q '^Status: active'; then
  echo "ufw is not active. Confirm SSH is allowed and run 'sudo ufw enable' first." >&2
  exit 1
fi

COMMENT="${SERVICE}:${PORT} via tailscale"

# ufw is idempotent for identical rules — it prints "Skipping adding
# existing rule" and exits 0.
ufw allow in on tailscale0 to any port "$PORT" proto tcp comment "$COMMENT"

echo
echo "Verify:"
echo "  ufw status verbose | grep -E '(${PORT}|tailscale0)'"
