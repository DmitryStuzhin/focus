#!/usr/bin/env bash
set -Eeuo pipefail
: "${FOCUS_BACKUP_REMOTE:?Set an rclone crypt destination}"
: "${RCLONE_CONFIG:?Set the path to a protected rclone configuration}"
: "${FOCUS_AUTH_DB:?Set the absolute path to the active SQLite database}"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
file="accounts-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
/opt/focus-node/bin/node /opt/focus/current/scripts/backup.mjs "$FOCUS_AUTH_DB" "$scratch/$file"
rclone copyto --immutable "$scratch/$file" "${FOCUS_BACKUP_REMOTE%/}/$file"
