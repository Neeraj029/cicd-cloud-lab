# ⚡ PulseChat — CCA-2 CI/CD Demo (Python)

Multi-room chat app built to satisfy **every stage** of the CCA-2 pipeline:
Jenkins checkout → build/test → Docker build → push → Minikube deploy → verify,
plus a visible 2nd-run redeployment.

**Deploying it? Start with [HOSTING.md](HOSTING.md)** — it lists the AWS console
steps, the ECR IAM setup, and the automation scripts in `scripts/`.

## 1. Project chosen
PulseChat: Flask + Gunicorn + SQLite + vanilla JS. No Node build step, single
container, no external DB — so the pipeline never breaks on AWS. Features:
multi-room chat, account registration/login, token-based auth for posting,
timestamps, polling refresh (2.5s), dark mode, `/health` and
`/api/version` endpoints.

### UI
The page has two mutually exclusive views. Signed out, only the sign-in card
exists — nothing is fetched, and no room, message or poll request is made until
a session is verified. Signed in, the chat window takes over.

* **Sign in** — segmented Sign in / Create account, labelled fields, password
  reveal, inline errors (no `alert()`), spinner on submit, staggered entrance.
* **Chat** — iOS-flavoured system look: grouped list sidebar, blurred chrome,
  a real dark-mode switch, messages animated in only when genuinely new
  (the poller diffs by id instead of rebuilding the DOM), grouped consecutive
  messages, scroll only auto-follows when you are already at the bottom, and a
  "New messages" pill when you are not. Under 820px the sidebar becomes a
  drawer. `prefers-reduced-motion` is respected.

## 2. Run locally
```bash
pip install -r requirements.txt
python app.py            # http://localhost:5000
pytest -q                # 7 tests
```

Create an account from the sidebar (register/login) before sending messages.

### Fonts
UI is **Inter** (variable, 48 KB, bundled in `static/fonts/`) — the standard
open-source stand-in for Apple's SF Pro. Stack: `-apple-system`, `SF Pro Text`,
`Inter Variable`, Helvetica, Arial, so macOS renders real SF Pro and every other
platform renders Inter. No internet needed, so Minikube screenshots always look
the same.

## 3. Docker
```bash
docker build -t pulsechat:local .
docker run -p 5000:5000 -e APP_VERSION=v1.0-BUILD-1 pulsechat:local
curl localhost:5000/health
```

## 4. Pipeline stages (Jenkinsfile)
| Stage | What it does |
|---|---|
| Checkout | `checkout scm` pulls GitHub |
| Build & Test | `pip install`, `py_compile`, `pytest -q` |
| ECR Setup | `aws sts get-caller-identity` builds the registry URL; creates the ECR repo if missing |
| Docker Build | `docker build -t <ecr-registry>/pulsechat:${BUILD_NUMBER}` + `:latest` |
| Push Image | `aws ecr get-login-password` → `docker push` to private ECR (tags `${BUILD_NUMBER}` + `latest`) |
| Deploy to Minikube | ECR pull secret, `kubectl apply -f k8s/`, `set image`, `set env APP_VERSION`, `rollout status` |
| Verify | `kubectl get deploy/pods/svc`, `wait --for=condition=available`, `minikube service --url` |

## 5. Jenkins on AWS (you do this part)
1. EC2 Ubuntu 24.04 (c7i-flex.large or t3.medium, 25GB - see FREE-TIER.md), security group open on 22, 8080, 30080.
2. Install: Java 21, Jenkins, Docker, AWS CLI, Minikube, kubectl — `bash scripts/setup-ec2.sh`.
3. Jenkins plugins: `scripts/jenkins-plugins.txt`.
4. Credential: `ecr-creds` (AWS access key id + secret) — auto-created from `jenkins.env`.
5. Pipeline job -> SCM -> your GitHub URL -> branch `main` -> Script Path `Jenkinsfile`.
6. Set `AWS_REGION` in the Jenkinsfile to your EC2 instance's region.

## 6. Push image
Jenkins does it automatically into a **private Amazon ECR** repository
(`<account>.dkr.ecr.<region>.amazonaws.com/pulsechat`). The account id is never
hardcoded - the pipeline calls `aws sts get-caller-identity` at build time. The
IAM access key lives in the Jenkins credential `ecr-creds`, created from
`jenkins.env` by `scripts/seed-jenkins.groovy`, never in the repo.
Manual check: AWS console -> ECR -> Repositories -> `pulsechat` shows tags
`1`, `2`, ... and `latest`.

## 7. Deploy + access on Minikube
```bash
minikube start --driver=docker   # run as the jenkins user on the server
kubectl apply -f k8s/
kubectl rollout status deployment/pulsechat
kubectl get pods,svc,deploy -l app=pulsechat
minikube service pulsechat-service --url   # open in browser
# public access: http://<ec2-public-ip>:30080 (socat forwards it to the NodePort)
```

## 8. 2nd run (code-change redeploy)
Already prepared: dark-mode toggle + emoji tray + timestamps are the "v2"
delta. For the demo: change a visible string (e.g. brand to `⚡ PulseChat v2`),
commit, push, `Build Now` in Jenkins. `APP_VERSION=v2.0-BUILD-${BUILD_NUMBER}`
updates the footer + `/api/version`. Screenshot v1 vs v2 + Jenkins build # history.

## 9. Viva cheat-sheet
* Why polling not WebSocket? NodePort Service + single-file frontend; no sticky sessions needed.
* Why replicas: 1? SQLite is file-backed; scale via Postgres for replicas > 1.
* Probes hit `/health` which also checks DB.
* Image tag `${BUILD_NUMBER}` proves which pipeline run is live.

## Repo layout (submission-ready)
```
app.py  requirements.txt  Dockerfile  Jenkinsfile  README.md
templates/index.html  static/app.js  static/style.css
tests/test_app.py  k8s/deployment.yaml  k8s/service.yaml
scripts/setup-ec2.sh        # provision Docker/Jenkins/AWS CLI/kubectl/Minikube + create ECR repo
scripts/seed-jenkins.groovy# auto-create the ECR credential + pipeline job
scripts/verify.sh          # pods/deploy/svc + live HTTP check
scripts/deploy-manual.sh   # same flow without Jenkins (fallback)
scripts/run2-demo.sh       # commit, push, retrigger for the 2nd run
HOSTING.md  jenkins.env.example
```
