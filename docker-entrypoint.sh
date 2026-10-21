#!/bin/sh
set -eu

PUID="${PUID:-0}"
PGID="${PGID:-0}"

case "$PUID" in
  ''|*[!0-9]*)
    echo "PUID must be a numeric user ID" >&2
    exit 1
    ;;
esac

case "$PGID" in
  ''|*[!0-9]*)
    echo "PGID must be a numeric group ID" >&2
    exit 1
    ;;
esac

exec gosu "$PUID:$PGID" npm start
