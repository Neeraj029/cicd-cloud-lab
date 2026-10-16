#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Post-deploy verification. Run by the Jenkins "Verify" stage and by hand:
#     bash scripts/verify.sh
# Exit code 0 only when the app actually answers over the NodePort Service.
# ---------------------------------------------------------------------------
set -uo pipefail

export KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config}"
APP=pulsechat
SVC=pulsechat-service
FAILED=0

section() { printf '\n\033[1;34m--- %s ---\033[0m\n' "$*"; }

section "Cluster"
kubectl get nodes -o wide

section "Workload"
kubectl get deployment "$APP"
kubectl get pods -l app="$APP" -o wide
kubectl get svc "$SVC"

section "Rollout"
if kubectl rollout status "deployment/$APP" --timeout=120s; then
    echo "rollout: OK"
else
    echo "rollout: NOT COMPLETE"; FAILED=1
fi

NODE_PORT="$(kubectl get svc "$SVC" -o jsonpath='{.spec.ports[0].nodePort}')"
IP="$(minikube ip 2>/dev/null || echo 127.0.0.1)"
BASE="http://${IP}:${NODE_PORT}"

section "Application reachability ($BASE)"
for path in /health /api/version; do
    printf 'GET %-14s -> ' "$path"
    if out="$(curl -sS --max-time 10 "$BASE$path" 2>&1)"; then
        echo "$out"
    else
        echo "UNREACHABLE ($out)"; FAILED=1
    fi
done

printf 'GET %-14s -> ' "/"
if body="$(curl -sS --max-time 10 "$BASE/" 2>&1)"; then
    if printf '%s' "$body" | grep -qi "PulseChat"; then
        echo "UI served OK"
    else
        echo "UI responded but does not look like PulseChat"; FAILED=1
    fi
else
    echo "UNREACHABLE ($body)"; FAILED=1
fi

section "Recent events (last 10)"
kubectl get events --sort-by=.lastTimestamp 2>/dev/null | tail -10

section "Deployment detail (tail)"
kubectl describe deployment "$APP" | tail -15

section "Access URL"
echo "  minikube service $SVC --url"
echo "  $BASE"

if [ "$FAILED" -ne 0 ]; then
    echo
    echo "VERIFY: FAILED - see pods/events above"
    exit 1
fi
echo
echo "VERIFY: PASSED"