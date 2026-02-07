#!/bin/bash

# Load NVM (Node Version Manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Ensure xclip is installed
if ! command -v xclip &> /dev/null; then
    echo "xclip is not installed. Please install it."
    exit 1
fi

# Get text from clipboard
TEXT=$(xclip -o)

if [ -z "$TEXT" ]; then
    echo "Clipboard is empty."
    exit 1
fi

# Open/Focus App
cd /home/kyle/Dropbox/text-explainer && EXPLAIN_TEXT="$TEXT" npx electron . --no-sandbox
exit 0
