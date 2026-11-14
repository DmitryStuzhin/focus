#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
umask 077
cd /opt/focus/current
focus_node=/opt/focus-node/bin/node
[[ -x "$focus_node" && -f scripts/admin.mjs ]] || { echo 'Deploy the Focus admin release first.' >&2; exit 1; }
[[ -f /etc/focus/auth.env ]] || { echo 'Configure Focus email sign-in first.' >&2; exit 1; }

IFS= read -r -p 'Allowed client IP addresses (comma-separated): ' admin_allowed_ips </dev/tty
admin_allowed_ips=$("$focus_node" --input-type=module -e '
 import {trustedProxies} from "./scripts/proxy.mjs";
 const addresses=[...trustedProxies(process.argv[1])];
 if(!addresses.length)process.exit(1);
 console.log(addresses.join(","));
' "$admin_allowed_ips") || { echo 'Enter at least one exact IP address.' >&2; exit 1; }
IFS= read -r -p 'Admin login: ' admin_login </dev/tty
[[ "$admin_login" =~ ^[A-Za-z0-9_.-]{3,64}$ ]] || { echo 'Use 3–64 letters, numbers, dots, dashes or underscores.' >&2; exit 1; }
IFS= read -r -s -p 'Admin password (at least 14 characters): ' admin_password </dev/tty
printf '\n'
IFS= read -r -s -p 'Repeat admin password: ' admin_repeat </dev/tty
printf '\n'
[[ "$admin_password" == "$admin_repeat" ]] || { echo 'Passwords did not match.' >&2; exit 1; }
unset admin_repeat
admin_hash=$(printf '%s' "$admin_password" | "$focus_node" --input-type=module -e '
 import {readFileSync} from "node:fs";
 import {hashAdminPassword} from "./scripts/admin.mjs";
 try{process.stdout.write(await hashAdminPassword(readFileSync(0,"utf8")));}
 catch(error){console.error(error.message);process.exit(1);}
')
unset admin_password

exec 9>/run/lock/focus-update.lock
flock -w 30 9
admin_env=/etc/focus/admin.env
dropin_dir=/etc/systemd/system/focus.service.d
dropin=$dropin_dir/50-admin.conf
backup=$(mktemp -d /etc/focus/admin-backup.XXXXXX)
changed=0
committed=0
cleanup(){
 if [[ "$changed" == 1 && "$committed" == 0 ]]; then
  for file in "$admin_env" "$dropin"; do
   if [[ -f "$backup/${file##*/}" ]]; then cp -p -- "$backup/${file##*/}" "$file"
   else rm -f -- "$file"; fi
  done
  systemctl daemon-reload || true
  systemctl restart focus || true
 fi
 rm -rf -- "$backup"
}
trap cleanup EXIT
for file in "$admin_env" "$dropin"; do
 if [[ -f "$file" ]]; then cp -p -- "$file" "$backup/"; fi
done
printf 'FOCUS_ADMIN_LOGIN=%s\nFOCUS_ADMIN_PASSWORD_HASH=%s\nFOCUS_ADMIN_ALLOWED_IPS=%s\n' "$admin_login" "$admin_hash" "$admin_allowed_ips" > "$backup/new-admin.env"
unset admin_hash
install -d -m 755 "$dropin_dir"
changed=1
install -m 600 "$backup/new-admin.env" "$admin_env"
cat > "$dropin" <<'UNIT'
[Service]
EnvironmentFile=/etc/focus/admin.env
UNIT
chmod 644 "$dropin"
systemctl daemon-reload
systemctl restart focus
for _ in {1..20}; do
 if curl -fsS --max-time 2 http://127.0.0.1:3000/healthz >/dev/null; then
  committed=1
  echo 'Focus is ready. Verify admin access from an allowed IP address at /admin.'
  exit 0
 fi
 sleep 1
done
echo 'Focus did not enable the admin panel. Restoring the previous configuration.' >&2
exit 1
