#!/usr/bin/env bash
set -e
if command -v tailscale >/dev/null 2>&1; then
  echo
  echo "===== TAILSCALE ====="
  TS_IP="$(tailscale ip -4 | head -n 1)"
  echo "Share: http://${TS_IP}:3000"
  echo "====================="
  echo
else
  echo "Tailscale CLI not found. Install/sign in first; starting normally on port 3000."
fi
npm start
