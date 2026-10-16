#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build -> test -> push -> deploy, without Jenkins. Use it as a fallback when
# Jenkins is down, or to show the exact steps the pipeline automates.
#
#     set -a; . ./jenkins.env; set +a
#     bash scripts/deploy-manual.sh [tag]
#
# Reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION from the
# environment (jenkins.env). The tag defaults to the short git SHA.
# ---------------------------------------------------------------------------
set -euo pipefail

: "${AWS_ACCESS_KEY_ID:?source jenkins.env first: set -a; . ./jenkins.env; set +a}"
: "${AWS_SECRET_ACCESS_KEY:?source jenkins.env first}"

AWS_REGION="${AWS_REGION:-ap-south-1}"
ECR_REPO="${ECR_REPO:-pulsechat}"
TAG="${1:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)}"
export KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "Build and test (venv)"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
.venv/bin/python -m pytest -q

step "Resolve registry and ensure repo exists"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
echo "registry: $REGISTRY"
aws ecr describe-repositories --region "$AWS_REGION" \
    --repository-names "$ECR_REPO" >/dev/null 2>&1 \
    || aws ecr create-repository --region "$AWS_REGION" \
         --repository-name "$ECR_REPO" \
         --image-scanning-configuration scanOnPush=true >/dev/null

step "Docker build ($REGISTRY/$ECR_REPO:$TAG)"
docker build -t "$REGISTRY/$ECR_REPO:$TAG" -t "$REGISTRY/$ECR_REPO:latest" .

step "ECR login and push"
aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$REGISTRY"
docker push "$REGISTRY/$ECR_REPO:$TAG"
docker push "$REGISTRY/$ECR_REPO:latest"

step "Deploy to Minikube"
aws ecr get-login-password --region "$AWS_REGION" \
    | kubectl create secret docker-registry ecr-pull \
        --docker-server="$REGISTRY" --docker-username=AWS --docker-password-stdin \
        --dry-run=client -o yaml | kubectl apply -f -
sed -i "s|image: .*/${ECR_REPO}:.*|image: $REGISTRY/$ECR_REPO:$TAG|" k8s/deployment.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl set image deployment/pulsechat pulsechat="$REGISTRY/$ECR_REPO:$TAG"
kubectl set env deployment/pulsechat APP_VERSION="manual-$TAG"
kubectl rollout status deployment/pulsechat --timeout=180s

step "Verify"
bash scripts/verify.sh