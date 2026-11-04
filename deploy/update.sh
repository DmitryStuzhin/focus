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
    # Fail closed on unavailable API, pending, cancelled, skipped, or failed CI.
    python3 - "$revision" <<'PY'
import json,sys,urllib.request
sha=sys.argv[1]
url=f'https://api.github.com/repos/DmitryStuzhin/focus/actions/workflows/ci.yml/runs?event=push&head_sha={sha}&per_page=10'
req=urllib.request.Request(url,headers={'Accept':'application/vnd.github+json','User-Agent':'focus-deployer'})
with urllib.request.urlopen(req,timeout=30) as r: runs=json.load(r)['workflow_runs']
runs=sorted([r for r in runs if r['head_sha']==sha and r['head_branch']=='main'],key=lambda r:(r['run_number'],r.get('run_attempt',1)),reverse=True)
if not runs or runs[0]['status']!='completed' or runs[0]['conclusion']!='success':
    print('Waiting for successful GitHub CI:',sha);sys.exit(75)
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
printf 'Deployed %s\n' "$revision"
