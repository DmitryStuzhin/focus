#!/usr/bin/env bash
# Run on the Focus VPS after the release containing /login is deployed.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
umask 077
cd /opt/focus/current
node=/opt/focus-node/bin/node
[[ -x "$node" && -f scripts/auth.mjs && -f scripts/mail.mjs ]] || { echo 'Deploy the Focus login release first.' >&2; exit 1; }

IFS= read -r -p 'Timeweb mailbox [auth@tokenapp.ru]: ' smtp_user </dev/tty
smtp_user=${smtp_user:-auth@tokenapp.ru}
IFS= read -r -s -p 'Timeweb mailbox password: ' smtp_password </dev/tty
printf '\n'
[[ -n "$smtp_password" ]] || { echo 'A mailbox password is required.' >&2; exit 1; }
IFS= read -r -p 'Address to receive a test email: ' smtp_test </dev/tty
smtp_port=$(printf '%s' "$smtp_password" | runuser -u focus -- "$node" --disable-warning=ExperimentalWarning --input-type=module -e '
 import {readFileSync} from "node:fs";
 import {normalizeEmail} from "./scripts/auth.mjs";
 import {sendLoginCode} from "./scripts/mail.mjs";
 const [sender,recipient]=process.argv.slice(1);
 const from=normalizeEmail(sender),to=normalizeEmail(recipient);
 if(!from||!to){console.error("Check the mailbox and test recipient addresses.");process.exit(1);}
 try{
  const port=await sendLoginCode({from,to,password:readFileSync(0,"utf8"),code:"000000"});
  process.stdout.write(String(port));
 }catch(error){console.error(error.message);process.exit(1);}
' "$smtp_user" "$smtp_test")
echo "Timeweb accepted the test email on port $smtp_port."
IFS= read -r -p 'When the test email arrives, type yes to enable required sign-in: ' proceed </dev/tty
[[ "$proceed" == yes ]] || exit 0

exec 9>/run/lock/focus-update.lock
flock -w 30 9
auth_env=/etc/focus/auth.env
dropin_dir=/etc/systemd/system/focus.service.d
dropin=$dropin_dir/40-auth.conf
backup=$(mktemp -d /etc/focus/auth-backup.XXXXXX)
changed=0
committed=0
cleanup(){
 if [[ "$changed" == 1 && "$committed" == 0 ]]; then
  for file in "$auth_env" "$dropin"; do
   if [[ -f "$backup/${file##*/}" ]]; then
    cp -p -- "$backup/${file##*/}" "$file"
   else
    rm -f -- "$file"
   fi
  done
  systemctl daemon-reload || true
  systemctl restart focus || true
 fi
 rm -rf -- "$backup"
}
trap cleanup EXIT
for file in "$auth_env" "$dropin"; do
 if [[ -f "$file" ]]; then cp -p -- "$file" "$backup/"; fi
done
secret=''
if [[ -f "$auth_env" ]]; then
 secret=$(sed -n 's/^FOCUS_AUTH_SECRET=\([0-9a-f]\{64\}\)$/\1/p' "$auth_env" | head -n 1)
fi
if [[ -z "$secret" ]]; then
 secret=$("$node" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
fi

# systemd EnvironmentFile accepts quoted values. The password stays off command lines.
printf '%s\n%s' "$secret" "$smtp_password" | "$node" --input-type=module -e '
 import {readFileSync,writeFileSync} from "node:fs";
 import {normalizeEmail} from "./scripts/auth.mjs";
 const [path,user,port]=process.argv.slice(1);
 const input=readFileSync(0,"utf8");
 const separator=input.indexOf("\n");
 const secret=input.slice(0,separator),password=input.slice(separator+1);
 const quote=value=>JSON.stringify(value);
 if(/[\r\n\0]/u.test(password))process.exit(1);
 writeFileSync(path,[
  "FOCUS_AUTH_ENABLED=1",
  "FOCUS_AUTH_DB=/var/lib/focus/accounts.sqlite",
  "FOCUS_AUTH_SECRET="+secret,
  "FOCUS_SMTP_USER="+quote(normalizeEmail(user)),
  "FOCUS_SMTP_PORT="+port,
  "FOCUS_SMTP_PASSWORD="+quote(password),"",
 ].join("\n"),{mode:0o600});
' "$backup/new-auth.env" "$smtp_user" "$smtp_port"
unset smtp_password secret
install -d -m 755 "$dropin_dir"
changed=1
install -m 600 "$backup/new-auth.env" "$auth_env"
cat > "$dropin" <<'UNIT'
[Service]
StateDirectory=focus
StateDirectoryMode=0700
EnvironmentFile=/etc/focus/auth.env
UNIT
chmod 644 "$dropin"
systemctl daemon-reload
systemctl restart focus
for _ in {1..20}; do
 if curl -fsS --max-time 2 http://127.0.0.1:3000/api/auth/session |
  "$node" -e 'const v=JSON.parse(require("node:fs").readFileSync(0,"utf8"));process.exit(v.enabled===true?0:1)' 2>/dev/null; then
  committed=1
  echo 'Email sign-in is enabled.'
  exit 0
 fi
 sleep 1
done
echo 'Focus did not start with authentication. Restoring the previous configuration.' >&2
exit 1
