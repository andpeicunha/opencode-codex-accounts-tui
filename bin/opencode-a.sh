#!/bin/bash
# opencode-a — attach/reconnect to persistent opencode server
#
# Usage:
#   opencode-a              # attach to running server (starts one if needed)
#   opencode-a --new        # start a fresh session
#   opencode-a --kill       # stop the background server
#   opencode-a --status     # check if server is running

PORT="${OPENCODE_PORT:-4096}"
URL="http://localhost:$PORT"
PID_FILE="/tmp/opencode-server-$PORT.pid"

cmd="${1:-attach}"

case "$cmd" in
  attach|"")
    # Check if server is already running
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      opencode attach "$URL" -c "$@"
    else
      # Start server in background
      echo "Starting opencode server on port $PORT..."
      nohup opencode serve --port "$PORT" > /tmp/opencode-server-$PORT.log 2>&1 &
      echo $! > "$PID_FILE"
      sleep 3
      echo "Connecting..."
      opencode attach "$URL" -c
    fi
    ;;
  --new|-n)
    opencode attach "$URL" "$@"
    ;;
  --kill|-k)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null && echo "Server stopped."
      rm -f "$PID_FILE"
    else
      echo "No server running."
    fi
    ;;
  --status|-s)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Server running on $URL (PID $(cat "$PID_FILE"))"
    else
      echo "Server not running."
    fi
    ;;
  *)
    opencode attach "$URL" -c "$@"
    ;;
esac
