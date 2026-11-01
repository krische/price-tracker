#!/bin/sh
set -e

start_xvfb() {
  Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp > /dev/null 2>&1 &
  xvfb_pid=$!
  for _ in 1 2 3 4 5; do
    if [ -S /tmp/.X11-unix/X99 ]; then
      break
    fi
    if ! kill -0 "$xvfb_pid" 2>/dev/null; then
      echo "Failed to start Xvfb" >&2
      exit 1
    fi
    sleep 1
  done
  if [ ! -S /tmp/.X11-unix/X99 ]; then
    echo "Timed out waiting for Xvfb" >&2
    exit 1
  fi
}

# Start and supervise the virtual display when no display is available.
if [ -z "$DISPLAY" ]; then
  start_xvfb
  export DISPLAY=:99

  (
    while :; do
      sleep 1
      if ! kill -0 "$xvfb_pid" 2>/dev/null; then
        echo "Xvfb exited; restarting virtual display" >&2
        start_xvfb
      fi
    done
  ) &
fi

exec "$@"
