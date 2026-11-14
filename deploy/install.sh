#!/usr/bin/env bash
# Run on the target VPS, not on a developer workstation.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
[[ -f /etc/debian_version ]] || { echo 'Ubuntu/Debian required.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
export PATH=/opt/focus-node/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 022
domain=tokenapp.ru
revision=${FOCUS_INSTALL_REVISION:?Set FOCUS_INSTALL_REVISION to the verified release commit.}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release commit.' >&2; exit 1; }
expected_ip=${FOCUS_SERVER_IP:?Set FOCUS_SERVER_IP to the public address of the deployment.}
prepare_only=${FOCUS_PREPARE_ONLY:-0}
if [[ "$prepare_only" != 1 ]] && ! getent ahostsv4 "$domain" | awk '{print $1}' | sort -u | grep -qx "$expected_ip"; then
    echo "First set DNS A record: @ -> $expected_ip for $domain, then rerun." >&2
    exit 1
fi
if [[ ! -f /etc/focus/installed ]] && systemctl is-active --quiet nginx; then
    if nginx -T 2>&1 | grep -Eq 'server_name[^;]*\btokenapp\.ru\b'; then
        # A failed certificate request may leave our own HTTP host installed.
        # Resume only when both files exactly match this Focus installation.
        if [[ -f /etc/focus/app.env ]] &&
           cmp -s /opt/focus/source/deploy/nginx.conf /etc/nginx/conf.d/focus.conf &&
           cmp -s /opt/focus/source/deploy/focus.service /etc/systemd/system/focus.service; then
            echo 'Resuming existing Focus installation after incomplete HTTPS setup.'
        else
            echo 'An existing tokenapp.ru nginx virtual host was found. Review it before installing Focus.' >&2
            exit 1
        fi
    fi
fi
apt-get update
apt-get install -y ca-certificates curl git xz-utils nginx certbot python3-certbot-nginx python3 util-linux
if [[ ! -x /opt/focus-node/bin/node ]]; then
    case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo 'Unsupported architecture'; exit 1;; esac
    temp=$(mktemp -d)
    trap 'rm -rf -- "$temp"' EXIT
    curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$temp/SHASUMS256.txt"
    archive=$(awk -v arch="$arch" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2}' "$temp/SHASUMS256.txt")
    [[ "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || exit 1
    curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v22.x/$archive" -o "$temp/$archive"
    (cd "$temp"; grep "  $archive$" SHASUMS256.txt | sha256sum --check -)
    mkdir -p /opt/focus-node
    tar -xJf "$temp/$archive" -C /opt/focus-node --strip-components=1
fi
id focus >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin focus
id focus-build >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/focus-build --shell /usr/sbin/nologin focus-build
install -d -m 755 /opt/focus /opt/focus/releases /opt/focus/staging
install -d -m 700 /etc/focus
chown focus-build:focus-build /opt/focus/staging
if [[ ! -d /opt/focus/source/.git ]]; then
    install -d -o focus-build -g focus-build /opt/focus/source
    runuser -u focus-build -- git clone --branch main --single-branch https://github.com/DmitryStuzhin/focus.git /opt/focus/source
else
    runuser -u focus-build -- git -C /opt/focus/source fetch origin main
fi
# Use files from the fetched commit without modifying a running release.
runuser -u focus-build -- git -C /opt/focus/source merge-base --is-ancestor "$revision" origin/main
runuser -u focus-build -- git -C /opt/focus/source reset --hard "$revision"
if [[ ! -f /etc/focus/app.env ]]; then
    key_name=GOOGLE_API_KEY
    key_label=Google
    if [[ "${FOCUS_API_PROVIDER:-google}" == openrouter ]]; then
        key_name=OPENROUTER_API_KEY
        key_label=OpenRouter
    fi
    read -r -s -p "$key_label API key (Enter to configure later): " api_key </dev/tty
    printf '\n' >/dev/tty
    [[ "$api_key" =~ ^[A-Za-z0-9_.?+/-]*$ ]] || { echo 'Unexpected key characters'; exit 1; }
    (umask 077; printf 'HOST=127.0.0.1\nPORT=3000\nPUBLIC_ORIGIN=https://tokenapp.ru\nTRUST_PROXY=127.0.0.1\n%s=%s\n' "$key_name" "$api_key" > /etc/focus/app.env)
    unset api_key
fi
# Validate explicit addresses before replacing the running service.
proxy_value=$(sed -n 's/^TRUST_PROXY=//p' /etc/focus/app.env | tail -n 1)
if ! /opt/focus-node/bin/node --input-type=module -e '
  import {trustedProxies} from "/opt/focus/source/scripts/proxy.mjs";
  trustedProxies(process.argv[1]);
' "$proxy_value"; then
    echo 'Set TRUST_PROXY to the exact IP of the nginx peer in app.env.' >&2
    exit 1
fi
install -m 644 /opt/focus/source/deploy/focus.service /etc/systemd/system/focus.service
install -m 644 /opt/focus/source/deploy/focus-update.service /etc/systemd/system/focus-update.service
install -m 644 /opt/focus/source/deploy/focus-update.timer /etc/systemd/system/focus-update.timer
install -m 755 /opt/focus/source/deploy/update.sh /usr/local/sbin/focus-update
systemctl daemon-reload
FOCUS_INSTALL_REVISION="$revision" /usr/local/sbin/focus-update
systemctl enable focus
if [[ "$prepare_only" == 1 ]]; then
    curl --fail --silent --show-error http://127.0.0.1:3000/healthz
    printf '\nFocus prepared. Change DNS A for %s to %s, then rerun without FOCUS_PREPARE_ONLY.\n' "$domain" "$expected_ip"
    exit 0
fi
if [[ ! -f /etc/nginx/conf.d/focus.conf ]]; then
    install -m 644 /opt/focus/source/deploy/nginx.conf /etc/nginx/conf.d/focus.conf
fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx
# Existing firewall rules remain; add only web ports if UFW is already active.
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
    ufw allow 80/tcp
    ufw allow 443/tcp
fi
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d "$domain"
# Certbot package installs its certificate renewal timer.
systemctl enable --now certbot.timer
curl --fail --silent --show-error "https://$domain/healthz"
systemctl enable --now focus-update.timer
touch /etc/focus/installed
printf '\nFocus: https://%s\nAutodeploy: main, after successful GitHub CI, checked every 2 minutes.\n' "$domain"
