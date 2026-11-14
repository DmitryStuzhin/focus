#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run as root'; exit 1; }
[[ -f /etc/focus/app.env ]] || { echo 'Install Focus first'; exit 1; }
read -r -s -p 'Tavily API key: ' TAVILY_API_KEY </dev/tty
printf '\n' >/dev/tty
[[ "$TAVILY_API_KEY" =~ ^tvly-[A-Za-z0-9_-]+$ ]] || { echo 'Invalid Tavily key format'; exit 1; }
export TAVILY_API_KEY
python3 <<'PY'
import os,pathlib,tempfile
path=pathlib.Path('/etc/focus/app.env')
lines=[s for s in path.read_text().splitlines() if not s.startswith('TAVILY_API_KEY=')]
lines.append('TAVILY_API_KEY='+os.environ['TAVILY_API_KEY'])
fd,name=tempfile.mkstemp(dir=path.parent)
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'w') as f: f.write('\n'.join(lines)+'\n')
 os.replace(name,path)
finally:
 if os.path.exists(name): os.unlink(name)
PY
unset TAVILY_API_KEY
systemctl start focus-update.service || true
systemctl restart focus
curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:3000/healthz
printf '\nSign in to Focus and run a web search to verify Tavily and the configured budget.\n'
