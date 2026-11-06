#!/usr/bin/env bash
# Installs or updates HFee AI on a fresh Ubuntu/Debian server:
# HFee (model runner) + the website + Caddy for HTTPS.
#
#   sudo bash install.sh --domain chat.example.com --email you@example.com
#
# Re-running it updates the code and keeps users, chats and models.
set -euo pipefail

DOMAIN=""
EMAIL=""
MODEL="qwen2.5:7b"
SIGNUP="true"
DAILY=200
NUM_CTX=8192
ENGINES="true"

usage() {
  cat <<EOF
Usage: sudo bash install.sh --domain <domain> --email <email> [options]

  --domain     address for the site, e.g. chat.example.com (its DNS A record must point here)
  --email      contact email for the HTTPS certificate
  --model      model to run (default: $MODEL)
  --no-signup  only existing users can sign in
  --daily      messages per user per day (default: $DAILY)
  --ctx        context window in tokens (default: $NUM_CTX)
  --no-engines skip vision, image generation, voice, web search and the code sandbox
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --no-signup) SIGNUP="false"; shift ;;
    --no-engines) ENGINES="false"; shift ;;
    --daily) DAILY="${2:-}"; shift 2 ;;
    --ctx) NUM_CTX="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$DOMAIN" && -n "$EMAIL" ]] || usage
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }
command -v apt-get >/dev/null || { echo "This installer supports Ubuntu and Debian." >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/opt/hfee-ai
DATA_DIR=/var/lib/hfee

case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

step() { printf '\n\033[1;38;2;216;120;88m==>\033[0m %s\n' "$*"; }

step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw >/dev/null

if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; then
  step "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  step "Installing Caddy"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

step "Creating the hfee user and folders"
id hfee >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin hfee
mkdir -p "$DATA_DIR/models" "$DATA_DIR/site" "$APP_DIR"

step "Installing HFee"
install -m 755 "$HERE/bin/hfee-linux-$ARCH" /usr/local/bin/hfee

step "Installing the website"
rsync_like() { rm -rf "${APP_DIR:?}/$1" && cp -r "$HERE/site/$1" "$APP_DIR/$1"; }
for item in dist server package.json package-lock.json; do rsync_like "$item"; done
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

# .env is written once; later runs keep your edits.
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat >"$APP_DIR/.env" <<EOF
AI_BASE_URL=http://127.0.0.1:11500/v1
AI_API_KEY=
AI_MODEL=$MODEL

PORT=3001
HOST=127.0.0.1
NODE_ENV=production

ALLOW_SIGNUP=$SIGNUP
DAILY_MESSAGES=$DAILY
DB_PATH=$DATA_DIR/site/hfee.db
MAX_PARALLEL=4
EOF
fi
chmod 640 "$APP_DIR/.env"
chown -R root:hfee "$APP_DIR"
chown -R hfee:hfee "$DATA_DIR"

step "Setting up services"
cat >/etc/systemd/system/hfee.service <<EOF
[Unit]
Description=HFee model server
After=network-online.target
Wants=network-online.target

[Service]
User=hfee
Group=hfee
Environment=HOME=$DATA_DIR
Environment=HFEE_MODELS=$DATA_DIR/models
Environment=HFEE_KEEP_ALIVE=-1
Environment=HFEE_NUM_CTX=$NUM_CTX
Environment=HFEE_NUM_PARALLEL=4
ExecStart=/usr/local/bin/hfee serve
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/hfee-ai.service <<EOF
[Unit]
Description=HFee AI website
After=network-online.target hfee.service
Wants=hfee.service

[Service]
User=hfee
Group=hfee
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --env-file=.env --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR/site
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now hfee.service >/dev/null
systemctl restart hfee.service

for _ in $(seq 1 30); do
  curl -fs http://127.0.0.1:11500/api/version >/dev/null && break
  sleep 1
done

step "Downloading the model ($MODEL)"
HFEE_HOST=127.0.0.1:11500 /usr/local/bin/hfee pull "$MODEL"
# load it now so the first visitor doesn't wait
curl -fs http://127.0.0.1:11500/api/generate -d "{\"model\":\"$MODEL\"}" >/dev/null

if [[ "$ENGINES" == "true" ]]; then
  bash "$HERE/engines.sh"
fi

systemctl enable --now hfee-ai.service >/dev/null
systemctl restart hfee-ai.service

step "Setting up HTTPS for $DOMAIN"
cat >/etc/caddy/Caddyfile <<EOF
{
	email $EMAIL
}

$DOMAIN {
	encode zstd gzip
	request_body {
		max_size 60MB
	}
	reverse_proxy 127.0.0.1:3001
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

step "Opening the firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

IP="$(curl -fs https://api.ipify.org || echo '<server IP>')"
cat <<EOF

  HFee AI is installed.

  Site:    https://$DOMAIN
  Model:   $MODEL
  DNS:     add an A record  $DOMAIN -> $IP  (HTTPS starts once it resolves)

  Settings: $APP_DIR/.env  (then: systemctl restart hfee-ai)
  Logs:     journalctl -u hfee-ai -u hfee -f

EOF
