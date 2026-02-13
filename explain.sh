#!/bin/bash

# Load NVM (Node Version Manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"


# Get text from clipboard
TEXT=$(wl-paste --primary)

if [ -z "$TEXT" ]; then
    echo "Clipboard is empty."
    exit 1
fi

SOCKET_PATH="/tmp/text-explainer.sock"

# Fast path: send to running daemon via Unix socket (near-instant)
if [ -S "$SOCKET_PATH" ]; then
    if printf '%s' "$TEXT" | curl -sf --unix-socket "$SOCKET_PATH" -X POST --data-binary @- http://localhost/explain 2>/dev/null; then
        echo "[text-explainer] Reused running daemon via socket"
        exit 0
    fi
    echo "[text-explainer] Socket exists but daemon not responding, cold starting..."
fi

# Cold start: launch Electron daemon in background
echo "[text-explainer] Cold start: launching Electron daemon..."
cd /home/kyle/text-explainer && EXPLAIN_TEXT="$TEXT" npx electron . --no-sandbox &
disown
exit 0
