#!/usr/bin/env bash
# Open secure encrypted tunnel and launch local dashboard
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY="$DIR/demand-automator-key.pem"
IP="13.204.76.22"

# Check if port 3000 is already tunneled
if lsof -i :3000 >/dev/null 2>&1; then
  echo "✅ Secure tunnel is already active on http://localhost:3000"
  open "http://localhost:3000"
  exit 0
fi

echo "🔐 Establishing end-to-end encrypted SSH tunnel to AWS..."
ssh -i "$KEY" -o StrictHostKeyChecking=no -N -L 3000:127.0.0.1:3000 ec2-user@$IP &
TUNNEL_PID=$!

sleep 1
echo "🚀 Opening private dashboard at http://localhost:3000..."
open "http://localhost:3000"

echo ""
echo "=========================================================="
echo "  🔒 PRIVATE LOCAL DASHBOARD: http://localhost:3000"
echo "  Internet Access: 100% BLOCKED & FIREWALLED ON AWS"
echo "  Press Ctrl+C to close the secure tunnel."
echo "=========================================================="

trap "kill $TUNNEL_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait $TUNNEL_PID
