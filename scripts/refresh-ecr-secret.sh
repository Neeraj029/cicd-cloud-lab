#!/usr/bin/env bash
# ECR login tokens expire after 12 hours. If a pod restarts after that with a stale
# pull secret it goes ImagePullBackOff. A systemd timer runs this every 6 hours.
set -euo pipefail
set -a; . /opt/pulsechat/jenkins.env; set +a
export AWS_DEFAULT_REGION="${AWS_REGION:-ap-south-1}" KUBECONFIG=/var/lib/jenkins/.kube/config
REGISTRY="$(aws sts get-caller-identity --query Account --output text).dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
aws ecr get-login-password --region "$AWS_DEFAULT_REGION" \
  | kubectl create secret docker-registry ecr-pull --docker-server="$REGISTRY" \
      --docker-username=AWS --docker-password-stdin --dry-run=client -o yaml | kubectl apply -f -
echo "ecr-pull refreshed for $REGISTRY"
