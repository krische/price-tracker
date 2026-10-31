#!/bin/sh
set -e

# Start virtual display if no display is available
if [ -z "$DISPLAY" ]; then
  Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp > /dev/null 2>&1 &
  export DISPLAY=:99
fi

exec "$@"
