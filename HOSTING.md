# Hosting PulseChat for CCA-2

> On the AWS free tier? Read **FREE-TIER.md** first (instance choice, cost controls, cleanup).

Everything runs on **one AWS EC2 instance**: Jenkins, Docker, Minikube and
kubectl. The image is stored in **private Amazon ECR**, the app is served on a
NodePort Service.

```
GitHub --checkout--> Jenkins --docker push--> Amazon ECR --pull--> Minikube --> browser
```

## What you do by hand vs what the scripts do

| Step | Who |
|---|---|
| Create AWS account/key pair, launch EC2, open security group ports | **you, in the console** |
| Create IAM user with `AmazonEC2ContainerRegistryFullAccess`, make an access key | **you, in the console** |
| Create GitHub repo and push this code | **you, in the terminal** |
| Install Docker / Java / Jenkins / plugins / AWS CLI / kubectl / Minikube, create the ECR repo | `scripts/setup-ec2.sh` |
| Wire the ECR credential + create the pipeline job in Jenkins | `scripts/seed-jenkins.groovy` |
| Build, test, image, push, deploy, verify | `Jenkinsfile` |
| Commit + push the v2 change and retrigger | `scripts/run2-demo.sh` |

---

## A. Manual: AWS console

1. **EC2 -> Launch instance**
   - AMI: Ubuntu Server 24.04 LTS (free-tier eligible; 22.04 also works)
   - Instance type: `t3.medium` (2 vCPU / 4 GB; `t3.large` if you want headroom)
   - Root volume: 25 GB gp3 (free allowance is 30 GB)
   - Key pair: create or pick `cca2.pem`
2. **Security group inbound rules:**

   | Type | Port | Source | Purpose |
   |---|---|---|---|
   | SSH | 22 | your IP (or 0.0.0.0/0) | connect |
   | Custom TCP | 8080 | 0.0.0.0/0 | Jenkins UI |
   | Custom TCP | 30080 | 0.0.0.0/0 | the chat app (NodePort) |

3. Note the instance's **region** (e.g. `ap-south-1`) - ECR must use the same one.
4. Connect: `ssh -i cca2.pem ubuntu@<public-ip>`

## B. Manual: IAM user for ECR

1. **IAM -> Users -> Create user** (name it `jenkins-ecr`), skip console access.
2. Attach the managed policy **`AmazonEC2ContainerRegistryFullAccess`**
   (optionally also `AmazonECRContainerRegistryReadOnly`).
3. **Security credentials -> Create access key** -> copy the
   **Access key ID** and **Secret access key** (shown once).
4. Put them in `jenkins.env` (below). `jenkins.env` is gitignored - never commit it.

Why a separate IAM user instead of your login: least privilege, revocable
without touching the account, and it is the credential Jenkins stores in its
encrypted credential store. (Stronger option, mention in the viva: attach an
**instance profile** with the same policy to the EC2 and drop the credential
from Jenkins entirely - then `aws` uses the role automatically.)

## C. Manual: GitHub repo

```powershell
cd X:\Projects\cloud_cca2
git init
git add -A
git commit -m "PulseChat: chat app with Jenkins CI/CD to Minikube"
git branch -M main
git remote add origin https://github.com/<you>/cloud_cca2.git
git push -u origin main
```

Set `AWS_REGION` in `Jenkinsfile` to your instance's region. You do **not** need
to edit the image in `k8s/deployment.yaml` - the pipeline resolves your real
registry endpoint at build time (`aws sts get-caller-identity`), so no account id
is ever hardcoded.

## D. Automated: provision the server

```bash
git clone https://github.com/<you>/cloud_cca2.git
cd cloud_cca2
cp jenkins.env.example jenkins.env
nano jenkins.env        # fill in AWS keys + GitHub repo URL
bash scripts/setup-ec2.sh
```

`setup-ec2.sh` installs Docker, Java 21, Jenkins (current 2026 apt key) + plugins, the AWS CLI,
kubectl and Minikube; creates the **private ECR repository** (scan on push);
starts Minikube **as the jenkins user** (so Jenkins owns the cluster and
kubeconfig); installs a small `socat` service that forwards EC2 port 30080 to
the Minikube NodePort (the docker driver keeps the node on a private network);
and installs `jenkins.env` as `/opt/pulsechat/jenkins.env`.
After an EC2 stop/start run `bash scripts/resume.sh`.

Re-run it any time - every step is skipped if already installed.

## E. Manual: unlock Jenkins

1. `sudo cat /var/lib/jenkins/secrets/initialAdminPassword` -> paste into
   `http://<public-ip>:8080`
2. Choose **Install suggested plugins** (or skip if plugins were pre-installed) and continue.
3. Create an admin account.
4. `Manage Jenkins -> System -> Restart Jenkins Now` so the seed script runs.

Expected in the job list / system log:

```
[pulsechat-seed] created ECR credential 'ecr-creds'
[pulsechat-seed] pipeline job 'pulsechat-pipeline' -> https://github.com/... (main)
```

If the lines are missing, create them by hand (2 minutes, and good to show in the viva):
**Manage Jenkins -> Credentials -> Global -> Add** (Username with password, ID `ecr-creds`,
username = access key id, password = secret key); then **New Item -> Pipeline -> Pipeline script
from SCM -> Git -> your repo URL -> `*/main` -> `Jenkinsfile`**, named `pulsechat-pipeline`.
Otherwise try `sudo systemctl restart jenkins` and confirm
`sudo cat /opt/pulsechat/jenkins.env` has the four AWS values.

## F. Run the pipeline

1. `http://<public-ip>:8080/job/pulsechat-pipeline` -> **Build Now**.
2. Stages: Checkout, Build & Test, ECR Setup, Docker Build, Push Image to ECR,
   Deploy to Minikube, Verify.
3. Verify runs `scripts/verify.sh` and ends with `VERIFY: PASSED`.

Open the app: `http://<public-ip>:30080` or
`minikube service pulsechat-service --url`.

## G. Screenshots to collect

- EC2 instance details (id, type, region)
- Jenkins pipeline view with all stages green
- **ECR Setup** stage log showing the resolved `<account>.dkr.ecr.<region>...`
- Build & Test console showing `6 passed`
- Push stage showing `pushed - latest image now in ECR` with tag + timestamp
- AWS console -> ECR -> Repositories -> `pulsechat`, images tab, tags `1` and `latest`
- `kubectl get deploy,pods,svc` with `1/1 Running`
- App in the browser (run 1) showing the version badge
- `minikube service pulsechat-service --url`
- Run 2: new build number, new pod, app showing `v2.0-BUILD-2`

## H. Run 2: code change redeployment

Make a real source edit, e.g. in `static/app.js` add a character counter, or in
`templates/index.html` change the wordmark to `PulseChat v2`. Then:

```bash
bash scripts/run2-demo.sh "add character counter to composer"
```

It refuses to run if nothing changed, commits, pushes, and triggers Jenkins
(with `JENKINS_URL`/`JENKINS_USER`/`JENKINS_TOKEN` set) or tells you to click
Build Now. The version badge changes from `v2.0-BUILD-1` to `v2.0-BUILD-2`
because the Deploy stage runs
`kubectl set env deployment/pulsechat APP_VERSION=v2.0-BUILD-${BUILD_NUMBER}`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `no basic auth credentials` / `ImagePullBackOff` | private ECR: the `ecr-pull` pull secret is missing or stale - re-run the Deploy stage, or `kubectl delete secret ecr-pull` and build again |
| `RepositoryNotFoundException` | wrong region or the repo was not created: `aws ecr describe-repositories --region ap-south-1` |
| `denied: User is not authorized to perform ecr:*` | IAM user needs `AmazonEC2ContainerRegistryFullAccess` |
| `permission denied ... docker.sock` in Jenkins | `sudo usermod -aG docker jenkins && sudo systemctl restart jenkins` |
| `no configuration has been provided` (kubectl) | Jenkins needs `KUBECONFIG=/var/lib/jenkins/.kube/config` (set in the Jenkinsfile) and that file must exist |
| `CrashLoopBackOff` | `kubectl logs deployment/pulsechat --tail=50` |
| readiness probe fails | `/health` must answer 200 within 10s; it also checks the DB |
| `externally-managed-environment` | should not happen - the pipeline builds in a venv |
| Port 8080/30080 unreachable | security group inbound rules missing, or `sudo systemctl status pulsechat-nodeport` / `bash scripts/resume.sh` after a reboot |
| `kubectl` works for you but not in Jenkins | Minikube must be started by the jenkins user: `sudo -u jenkins -H minikube start --driver=docker` |
| `repository is not signed` while installing Jenkins | use the `jenkins.io-2026.key` (2023 key expired) |
| Jenkins "Jenkinsfile not found" | branch must be `main`, Jenkinsfile at repo root, job SCM URL correct |

## Clean slate

```bash
kubectl delete deployment,pvc,pv,svc -l app=pulsechat
kubectl delete secret ecr-pull
minikube delete && bash scripts/setup-ec2.sh
```

## No-Jenkins fallback

```bash
set -a; . ./jenkins.env; set +a
bash scripts/deploy-manual.sh
```

Same build, test, ECR push, deploy, verify path - useful to show the evaluator
that the pipeline automates something real.

## Viva: why ECR over Docker Hub

* IAM-native: the same AWS identity pushes and pulls, no separate account or token rotation.
* Free tier: 500 GB-month storage for 12 months on new accounts; pulls are unmetered.
* No Docker Hub anonymous pull rate limits, which cause `ImagePullBackOff` on a busy cluster.
* Same-region as the EC2 instance, so pulls are fast.
* `AmazonEC2ContainerRegistryFullAccess` on a dedicated IAM user (scope it to one repo for production); keys are stored encrypted in Jenkins
  credentials, never in the Jenkinsfile or the repo.