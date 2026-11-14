#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run as root'; exit 1; }
[[ -f /etc/focus/app.env ]] || { echo 'Install Focus first'; exit 1; }
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY </dev/tty
printf '\n' >/dev/tty
[[ "$OPENROUTER_API_KEY" =~ ^sk-or-v1-[A-Za-z0-9_-]+$ ]] || { echo 'Invalid OpenRouter key format'; exit 1; }
export OPENROUTER_API_KEY
python3 <<'PY'
import os,pathlib,tempfile
path=pathlib.Path('/etc/focus/app.env')
lines=[s for s in path.read_text().splitlines() if not s.startswith('OPENROUTER_API_KEY=')]
lines.append('OPENROUTER_API_KEY='+os.environ['OPENROUTER_API_KEY'])
fd,name=tempfile.mkstemp(dir=path.parent)
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'w') as f: f.write('\n'.join(lines)+'\n')
 os.replace(name,path)
finally:
 if os.path.exists(name): os.unlink(name)
PY
unset OPENROUTER_API_KEY
systemctl restart focus
# Trigger the usual CI gate. Pending CI is harmless; the timer retries later.
systemctl start focus-update.service || true
curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:3000/healthz
printf '\nSign in to Focus and send a chat message to verify OpenRouter and the configured budget.\n'
