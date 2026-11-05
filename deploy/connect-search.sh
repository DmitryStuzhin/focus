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
printf '\nSearch configuration:\n'
for attempt in {1..10}; do
 if curl --fail --silent --show-error http://127.0.0.1:3000/api/status; then break; fi
 sleep 1
done
printf '\nIf searchConfigured is missing, wait for CI and the next update timer tick.\n'
# A real search, without sending the credential to the terminal or to the model.
if curl --fail --silent http://127.0.0.1:3000/api/status | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("searchConfigured") else 1)'; then
 printf '\nLive Tavily check (uses one search credit):\n'
 curl --silent --show-error --max-time 30 http://127.0.0.1:3000/api/search -H 'Content-Type: application/json' --data '{"query":"LibreOffice official documentation PDF export"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print("Search works. Sources:",len(d["sources"])) if "sources" in d else print("Search failed:",d.get("error","Unknown error"))'
fi
