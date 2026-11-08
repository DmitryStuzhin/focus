#!/usr/bin/env bash
set -Eeuo pipefail
export PATH=/opt/focus-node/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/var/lib/focus-build
exec 9>/run/lock/focus-update.lock
flock -n 9 || exit 0
cd /opt/focus/source
runuser -u focus-build -- git fetch --quiet origin main
revision=$(runuser -u focus-build -- git rev-parse origin/main)
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
previous=$(readlink -e /opt/focus/current || true)
# Only a real, existing release is eligible for rollback.
[[ "$previous" == /opt/focus/releases/* && -d "$previous" ]] || previous=
[[ "${previous##*/}" != "$revision" ]] || exit 0
if [[ "${1:-}" != '--initial' ]]; then
    # Fail closed while GitHub is unavailable, but do not mark a transient outage
    # as a broken deployment. systemd treats exit 75 as a successful wait.
    python3 - "$revision" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request

sha = sys.argv[1]
url = f'https://api.github.com/repos/DmitryStuzhin/focus/actions/workflows/ci.yml/runs?event=push&head_sha={sha}&per_page=10'
request = urllib.request.Request(url, headers={
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'focus-deployer',
})

payload = None
last_error = None
for attempt in range(5):
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        break
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        last_error = error
        if attempt < 4:
            time.sleep(min(2 ** attempt, 8))

if payload is None:
    print(f'GitHub CI is temporarily unavailable; deployment postponed: {last_error}', file=sys.stderr)
    sys.exit(75)

runs = sorted(
    [run for run in payload.get('workflow_runs', []) if run.get('head_sha') == sha and run.get('head_branch') == 'main'],
    key=lambda run: (run.get('run_number', 0), run.get('run_attempt', 1)),
    reverse=True,
)
if not runs or runs[0].get('status') != 'completed' or runs[0].get('conclusion') != 'success':
    print('Waiting for successful GitHub CI:', sha)
    sys.exit(75)
PY
fi
stage=$(mktemp -d /opt/focus/staging/build.XXXXXX)
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT
chown focus-build:focus-build "$stage"
runuser -u focus-build -- bash -o pipefail -c 'cd /opt/focus/source; git archive "$1" | tar -x -C "$2"' -- "$revision" "$stage"
runuser -u focus-build -- bash -c 'cd "$1"; npm test && npm run build && npm run validate' -- "$stage"
# Root-owned immutable release; the web process cannot modify application code.
release="/opt/focus/releases/$revision"
[[ ! -e "$release" ]] || rm -rf -- "$release"
cp -a "$stage" "$release"
chown -R root:root "$release"
# mktemp creates a 0700 directory; allow the unprivileged web service to read it.
chmod -R a+rX,go-w "$release"
ln -sfn "$release" /opt/focus/current.next
mv -Tf /opt/focus/current.next /opt/focus/current
systemctl restart focus
healthy=0
for attempt in {1..15}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3000/healthz >/dev/null; then healthy=1; break; fi
    sleep 1
done
if [[ "$healthy" != 1 ]]; then
    if [[ -n "$previous" && -d "$previous" ]]; then
        ln -sfn "$previous" /opt/focus/current.next
        mv -Tf /opt/focus/current.next /opt/focus/current
        systemctl restart focus
        echo 'New release failed readiness; restored previous release.' >&2
    else
        systemctl stop focus
        echo 'Initial release failed readiness.' >&2
    fi
    exit 1
fi
# Keep the installed deployment machinery in sync with the verified release.
install -m 644 "$release/deploy/focus.service" /etc/systemd/system/focus.service
install -m 644 "$release/deploy/focus-update.service" /etc/systemd/system/focus-update.service
install -m 644 "$release/deploy/focus-update.timer" /etc/systemd/system/focus-update.timer
install -m 755 "$release/deploy/update.sh" /usr/local/sbin/focus-update
systemctl daemon-reload
printf 'Deployed %s\n' "$revision"
