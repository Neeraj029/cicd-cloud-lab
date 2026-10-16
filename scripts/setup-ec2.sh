#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-shot provisioning for the CCA-2 CI/CD host (Ubuntu 24.04 (22.04 also works)).
# Installs Docker, Java 21, Jenkins (+plugins), AWS CLI, kubectl, Minikube.
# Minikube is started AS THE jenkins USER so the pipeline can reach the cluster.
#
#     bash scripts/setup-ec2.sh        # run as the ubuntu SSH user
# Safe to re-run; finished steps are skipped.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MINIKUBE_CPUS="${MINIKUBE_CPUS:-2}"
RAM_MB="$(free -m | awk '/^Mem:/{print $2}')"
if [ "$RAM_MB" -ge 3500 ]; then DEF_MEM=2200; else DEF_MEM=1800; fi   # 1800 MB is the Minikube minimum
MINIKUBE_MEMORY="${MINIKUBE_MEMORY:-$DEF_MEM}"
NODE_PORT="${NODE_PORT:-30080}"

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
export DEBIAN_FRONTEND=noninteractive
CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"

log "0/9 Swap safety net (free-tier machines have little RAM)"
if [ "$RAM_MB" -lt 6000 ] && [ -z "$(swapon --show --noheadings)" ]; then
    if [ "$RAM_MB" -lt 3000 ]; then SWAP=4G; else SWAP=2G; fi
    $SUDO fallocate -l "$SWAP" /swapfile && $SUDO chmod 600 /swapfile && $SUDO mkswap /swapfile >/dev/null && $SUDO swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
    echo "created $SWAP swap file"
else
    echo "swap not needed or already present"
fi

log "1/9 Base packages"
$SUDO apt-get update -y
$SUDO apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg git unzip jq socat fontconfig conntrack \
    python3 python3-pip python3-venv

log "2/9 Docker Engine"
if have docker; then
    echo "docker already present: $(docker --version)"
else
    $SUDO install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO tee /etc/apt/keyrings/docker.asc >/dev/null
    $SUDO chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
        | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
fi
$SUDO systemctl enable --now docker
$SUDO usermod -aG docker "$(id -un)" || true

log "3/9 Java 21"
if have java && java -version 2>&1 | grep -q 'version "21'; then
    echo "java 21 already present"
else
    $SUDO apt-get install -y openjdk-21-jre-headless
fi

log "4/9 Jenkins (2026 signing key)"
if ! have jenkins && [ ! -d /var/lib/jenkins ]; then
    $SUDO install -m 0755 -d /etc/apt/keyrings
    $SUDO wget -qO /etc/apt/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key
    echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" \
        | $SUDO tee /etc/apt/sources.list.d/jenkins.list >/dev/null
    $SUDO apt-get update -y
    $SUDO apt-get install -y jenkins
fi
$SUDO usermod -aG docker jenkins        # jenkins exists only now, so do this AFTER install
$SUDO systemctl stop jenkins || true

log "5/9 Jenkins plugins"
if [ ! -f /var/lib/jenkins/plugins/git.jpi ] && [ ! -d /var/lib/jenkins/plugins/git ]; then
    $SUDO mkdir -p /var/lib/jenkins/plugins
    curl -fsSL -o /tmp/jpm.jar \
        https://github.com/jenkinsci/plugin-installation-manager-tool/releases/latest/download/jenkins-plugin-manager.jar
    $SUDO java -jar /tmp/jpm.jar \
        --war /usr/share/java/jenkins.war \
        --plugin-file "$REPO_DIR/scripts/jenkins-plugins.txt" \
        --plugin-download-directory /var/lib/jenkins/plugins
    rm -f /tmp/jpm.jar
    $SUDO chown -R jenkins:jenkins /var/lib/jenkins/plugins
else
    echo "plugins already installed"
fi

log "6/9 AWS CLI"
if ! have aws; then
    curl -fsSL -o /tmp/awscliv2.zip https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip
    unzip -q -o /tmp/awscliv2.zip -d /tmp
    $SUDO /tmp/aws/install
    rm -rf /tmp/awscliv2.zip /tmp/aws
else
    echo "aws cli already present"
fi

log "7/9 kubectl + Minikube"
if ! have kubectl; then
    KVER="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
    curl -fsSLo /tmp/kubectl "https://dl.k8s.io/release/${KVER}/bin/linux/amd64/kubectl"
    $SUDO install -m 0755 /tmp/kubectl /usr/local/bin/kubectl && rm -f /tmp/kubectl
fi
if ! have minikube; then
    curl -fsSLo /tmp/minikube https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
    $SUDO install -m 0755 /tmp/minikube /usr/local/bin/minikube && rm -f /tmp/minikube
fi

log "8/9 Start Minikube as the jenkins user + expose NodePort $NODE_PORT"
$SUDO -u jenkins -H /usr/local/bin/minikube start --driver=docker \
    --cpus="$MINIKUBE_CPUS" --memory="$MINIKUBE_MEMORY"
$SUDO -u jenkins -H /usr/local/bin/kubectl get nodes

# Minikube's docker driver keeps the node on a private docker network, so the
# EC2 public IP cannot reach the NodePort directly. socat forwards it.
$SUDO tee /etc/systemd/system/pulsechat-nodeport.service >/dev/null <<UNIT
[Unit]
Description=Forward EC2 :$NODE_PORT to the Minikube NodePort
After=docker.service pulsechat-minikube.service

[Service]
ExecStart=/bin/sh -c 'exec /usr/bin/socat TCP-LISTEN:$NODE_PORT,fork,reuseaddr TCP:\$(sudo -u jenkins -H /usr/local/bin/minikube ip):$NODE_PORT'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now pulsechat-nodeport

# ---- 20-day unattended running: everything restarts by itself after a reboot ----
$SUDO tee /etc/systemd/system/pulsechat-minikube.service >/dev/null <<UNIT
[Unit]
Description=Start Minikube as the jenkins user at boot
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=jenkins
ExecStart=/usr/local/bin/minikube start --driver=docker
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
UNIT
$SUDO tee /etc/systemd/system/pulsechat-ecr-refresh.service >/dev/null <<UNIT
[Unit]
Description=Refresh the ECR pull secret in Minikube

[Service]
Type=oneshot
User=jenkins
ExecStart=/bin/bash $REPO_DIR/scripts/refresh-ecr-secret.sh
UNIT
$SUDO tee /etc/systemd/system/pulsechat-ecr-refresh.timer >/dev/null <<UNIT
[Unit]
Description=Refresh ECR pull secret every 6 hours

[Timer]
OnBootSec=3min
OnUnitActiveSec=6h

[Install]
WantedBy=timers.target
UNIT
$SUDO tee /etc/systemd/system/pulsechat-autostop.service >/dev/null <<'UNIT'
[Service]
Type=oneshot
ExecStart=/bin/bash -c '[ -f /opt/pulsechat/stop-at ] && [ "$(date +%s)" -ge "$(cat /opt/pulsechat/stop-at)" ] && /sbin/shutdown -h now || true'
UNIT
$SUDO tee /etc/systemd/system/pulsechat-autostop.timer >/dev/null <<'UNIT'
[Timer]
OnBootSec=10min
OnUnitActiveSec=1h

[Install]
WantedBy=timers.target
UNIT
# cap Jenkins' heap so Jenkins + Minikube + docker builds fit in 4 GB
$SUDO mkdir -p /etc/systemd/system/jenkins.service.d
printf '[Service]\nEnvironment="JAVA_OPTS=-Djava.awt.headless=true -Xmx640m"\n' | $SUDO tee /etc/systemd/system/jenkins.service.d/override.conf >/dev/null
$SUDO mkdir -p /opt/pulsechat
$SUDO systemctl daemon-reload
$SUDO systemctl enable pulsechat-minikube pulsechat-ecr-refresh.timer pulsechat-autostop.timer
$SUDO systemctl start pulsechat-ecr-refresh.timer pulsechat-autostop.timer

log "9/9 ECR repository + Jenkins auto-seed"
$SUDO mkdir -p /opt/pulsechat /var/lib/jenkins/init.groovy.d
if [ -f "$REPO_DIR/jenkins.env" ]; then
    set -a; . "$REPO_DIR/jenkins.env"; set +a
    AWS_REGION="${AWS_REGION:-ap-south-1}"; ECR_REPO="${ECR_REPO:-pulsechat}"
    if aws sts get-caller-identity >/dev/null 2>&1; then
        ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
        aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$ECR_REPO" >/dev/null 2>&1 \
          || aws ecr create-repository --region "$AWS_REGION" --repository-name "$ECR_REPO" \
               --image-scanning-configuration scanOnPush=true >/dev/null
        # free tier = 500 MB private ECR storage: keep only the 3 newest images
        aws ecr put-lifecycle-policy --region "$AWS_REGION" --repository-name "$ECR_REPO" \
          --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep last 3","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}' >/dev/null \
          || echo "lifecycle policy skipped (IAM user lacks ecr:PutLifecyclePolicy)"
        echo "ECR repo ready: ${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/$ECR_REPO"
    else
        echo "WARNING: AWS keys in jenkins.env did not authenticate"
    fi
    $SUDO cp "$REPO_DIR/jenkins.env" /opt/pulsechat/jenkins.env
    $SUDO chmod 600 /opt/pulsechat/jenkins.env
    $SUDO cp "$REPO_DIR/scripts/seed-jenkins.groovy" /var/lib/jenkins/init.groovy.d/pulsechat-seed.groovy
else
    echo "no jenkins.env - create the credential and job by hand (HOSTING.md section E)"
fi
$SUDO chown -R jenkins:jenkins /var/lib/jenkins /opt/pulsechat
$SUDO systemctl enable --now jenkins
$SUDO systemctl restart jenkins

log "Done"
cat <<MSG
  1. Open http://<public-ip>:8080 and unlock with:
       sudo cat /var/lib/jenkins/secrets/initialAdminPassword
  2. Log out/in once so your own user gets the docker group.
  3. After an EC2 stop/start run:  bash scripts/resume.sh
MSG
