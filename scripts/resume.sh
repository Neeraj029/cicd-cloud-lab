#!/usr/bin/env bash
# Run after the EC2 instance is stopped/started: Minikube does not auto-start.
set -euo pipefail
sudo systemctl start docker jenkins
sudo -u jenkins -H /usr/local/bin/minikube start
sudo systemctl restart pulsechat-nodeport
sudo -u jenkins -H /usr/local/bin/kubectl get nodes,pods
