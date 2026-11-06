#!/usr/bin/env bash
# Removes HFee AI from a server set up by install.sh.
#
#   sudo bash uninstall.sh           # keeps users, chats and models in /var/lib/hfee
#   sudo bash uninstall.sh --purge   # deletes those too
#
# Caddy, Node.js and Docker/Podman stay installed; other things may use them.
set -euo pipefail

PURGE=false
case "${1:-}" in
  "") ;;
  --purge) PURGE=true ;;
  *) echo "Usage: sudo bash uninstall.sh [--purge]" >&2; exit 1 ;;
esac
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

echo "Stopping services"
for s in hfee-ai hfee hfee-whisper hfee-vision hfee-search; do
  systemctl disable --now "$s" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
if command -v docker >/dev/null; then
  docker rm -f hfee-searxng >/dev/null 2>&1 || true
fi

echo "Removing programs"
rm -rf /opt/hfee-ai /opt/hfee-engines /usr/local/bin/hfee

if [[ -f /etc/caddy/Caddyfile ]] && grep -q 'reverse_proxy 127.0.0.1:3001' /etc/caddy/Caddyfile; then
  echo "Removing the HFee AI site from Caddy"
  printf '# Add your sites here: https://caddyserver.com/docs/caddyfile\n' >/etc/caddy/Caddyfile
  systemctl reload caddy 2>/dev/null || true
fi

if $PURGE; then
  echo "Deleting data and the hfee user"
  rm -rf /var/lib/hfee
  userdel hfee 2>/dev/null || true
  echo "HFee AI has been removed."
else
  echo "HFee AI has been removed. Your data is still in /var/lib/hfee;"
  echo "run again with --purge to delete it, or install again to carry on where you left off."
fi
