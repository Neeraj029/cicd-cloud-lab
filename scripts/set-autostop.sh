#!/usr/bin/env bash
# Cost guard: stop (not terminate) this EC2 instance N days from now.
#   bash scripts/set-autostop.sh 20
set -euo pipefail
DAYS="${1:-20}"
echo $(( $(date +%s) + DAYS*86400 )) | sudo tee /opt/pulsechat/stop-at >/dev/null
echo "instance will shut down on: $(date -d @"$(cat /opt/pulsechat/stop-at)")"
