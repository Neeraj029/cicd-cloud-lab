# Running CCA-2 on the AWS Free Tier

## 1. Which kind of free tier do you have?
Billing console -> **Free Tier**. Two kinds exist:

| Account created | You have | Eligible EC2 types |
|---|---|---|
| on/after 15 Jul 2025 | **Free plan**: ~6 months, credits-based, cannot overspend | t3.micro, t3.small, t4g.micro, t4g.small, **c7i-flex.large**, m7i-flex.large |
| before 15 Jul 2025 | **12-month free tier**: 750 h/month | t2.micro, t3.micro |

Confirm in your region: `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true --query "InstanceTypes[*].[InstanceType]" --output text | sort`
(or look for the "Free tier eligible" label in the EC2 launch wizard).

## 2. Instance choice (Jenkins + Docker + Minikube need ~4 GB RAM)
* Free plan account  -> **c7i-flex.large** (2 vCPU / 4 GB). If it is not offered in your region, pick a region where it is and set `AWS_REGION` in the Jenkinsfile and `jenkins.env`.
* 12-month account   -> `t3.micro` (1 GB) CANNOT run Minikube. Use **t3.medium** for the few hours you need (about US$0.04/hour, so roughly US$0.50 for a 10-hour project). Stop it whenever you are not working.
* Cheapest paid fallback: t3.small (2 GB). `setup-ec2.sh` adds a 4 GB swap file and runs Minikube at 1800 MB, but expect slow builds.

## 3. Settings that keep it free
* EBS root volume: **25 GB gp3** (free allowance is 30 GB).
* Do **not** allocate an Elastic IP (idle or stopped-instance EIPs are billed). The public IP changes after each stop/start; just use the new one.
* Security group: 22, 8080, 30080, source **My IP**.
* ECR: private repo storage is limited (500 MB/month on the 12-month tier). The pipeline sets a lifecycle policy that keeps only the 3 newest images (~150 MB each, layers shared).
* Create a **Zero-spend budget** (Billing -> Budgets -> Use a template) so AWS emails you on any charge.
* Stop (not terminate) the instance after each session. After starting it again: `bash scripts/resume.sh`.

## 4. IAM user
Attach **AmazonEC2ContainerRegistryFullAccess** to `jenkins-ecr` (the pipeline creates the repo and sets the lifecycle policy; PowerUser lacks both).

## 5. After you are graded: delete everything
1. EC2 -> terminate the instance (this also deletes its volume).
2. ECR -> delete repository `pulsechat`.
3. IAM -> delete user `jenkins-ecr` and its access keys.
4. Billing -> check no resources remain.

## 6. Running unattended for 20 days (budget: US$159.61 credits)
Estimated cost, Mumbai, 24/7 for 20 days (480 h): c7i-flex.large about US$0.083-0.085/h = ~US$41, 25 GB gp3 ~US$1.5, public IPv4 (US$0.005/h) ~US$2.4, ECR ~US$0. **Total roughly US$45**, leaving over US$100 of buffer. Verify in the AWS Pricing Calculator; prices vary by region.

Built into `setup-ec2.sh`:
* `pulsechat-minikube.service` starts Minikube (as jenkins) on every boot; the NodePort forwarder waits for it.
* `pulsechat-ecr-refresh.timer` renews the ECR pull secret every 6 h (tokens expire after 12 h).
* Chat history lives on a PersistentVolumeClaim, so it survives pod restarts and redeploys.
* Jenkins heap capped at 640 MB; the pipeline prunes images and build cache every run.
* `bash scripts/set-autostop.sh 20` makes the instance shut itself down (stop, not terminate) after 20 days.

Weekly check (2 minutes): `bash scripts/verify.sh`, `df -h /`, and Billing -> Free Tier credits.
Create budget alerts at US$50 and US$100 (Billing -> Budgets) so an email warns you if something runs away.
