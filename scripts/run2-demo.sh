#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Stage 9 of the rubric: change the source, push it, re-run the pipeline.
# Commits whatever is in your working tree, pushes to origin, then triggers
# Jenkins automatically if credentials are available (otherwise it tells you to
# click Build Now).
#
#     bash scripts/run2-demo.sh "add message counter to composer"
# ---------------------------------------------------------------------------
set -euo pipefail

MSG="${1:-update pulsechat app}"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
JOB="${JOB:-pulsechat-pipeline}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "Working tree changes"
git status --short
git --no-pager diff --stat

if git diff --quiet && git diff --cached --quiet; then
    echo
    echo "Nothing changed. Make your source edit first (see HOSTING.md - Run 2)."
    exit 1
fi

step "Commit: $MSG"
git add -A
git commit -m "$MSG"

step "Push to origin/$BRANCH"
git push origin "$BRANCH"

step "Trigger Jenkins"
if [ -n "${JENKINS_URL:-}" ] && [ -n "${JENKINS_USER:-}" ] && [ -n "${JENKINS_TOKEN:-}" ]; then
    crumb="$(curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" \
        "$JENKINS_URL/crumbIssuer/api/xml?xpath=//crumb/text()" || true)"
    if [ -n "$crumb" ]; then
        curl -sS -o /dev/null -w 'build triggered: HTTP %{http_code}\n' \
            -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" \
            -H "Jenkins-Crumb: $crumb" \
            "$JENKINS_URL/job/$JOB/build"
    else
        echo "could not read CSRF crumb - trigger the build manually"
    fi
else
    echo "Set JENKINS_URL, JENKINS_USER, JENKINS_TOKEN to auto-trigger, or:"
    echo "  open $JENKINS_URL/job/$JOB  and click Build Now"
fi

cat <<'EOF'

Next:
  1. Watch all six stages go green.
  2. kubectl get pods -l app=pulsechat      -> new pod, new age
  3. Open the app -> version badge shows the new BUILD_NUMBER
  4. Screenshot old vs new.
EOF