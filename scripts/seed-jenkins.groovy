/*
 * Auto-seeds Jenkins on boot from /opt/pulsechat/jenkins.env.
 * Installed by scripts/setup-ec2.sh into /var/lib/jenkins/init.groovy.d/.
 *
 * Creates:
 *   1. the ECR credential        (id: ecr-creds)  = AWS key id + secret access key
 *   2. the pipeline job          "pulsechat-pipeline" pointed at your GitHub repo
 *
 * Idempotent - safe to re-run on every restart. Reads:
 *   AWS_ACCESS_KEY_ID     IAM user access key id
 *   AWS_SECRET_ACCESS_KEY IAM user secret access key
 *   AWS_REGION            e.g. ap-south-1
 *   ECR_REPO              repository name (default pulsechat)
 *   PULSE_REPO            https://github.com/<user>/<repo>.git
 *   PULSE_BRANCH          branch name (default main)
 */
import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.domains.Domain
import com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl
import jenkins.model.GlobalQuietPeriodConfiguration
import jenkins.model.Jenkins
import hudson.plugins.git.BranchSpec
import hudson.plugins.git.GitSCM
import org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition
import org.jenkinsci.plugins.workflow.job.WorkflowJob

def log = { String m -> println "[pulsechat-seed] " + m }
def cfg = new Properties()
def envFile = new File("/opt/pulsechat/jenkins.env")
if (envFile.exists()) {
    envFile.withInputStream { cfg.load(it) }
} else {
    log "no /opt/pulsechat/jenkins.env yet - create it to enable auto-seeding"
}

def j = Jenkins.get()

try { j.setNumExecutors(2) } catch (Exception e) { log "executors: " + e }
try { GlobalQuietPeriodConfiguration.get().setQuietPeriod(0) } catch (Exception e) { log "quiet period: " + e }

String credId = cfg.getProperty("ECR_CREDS_ID") ?: "ecr-creds"
String jobName = cfg.getProperty("JOB_NAME") ?: "pulsechat-pipeline"
String branch = cfg.getProperty("PULSE_BRANCH") ?: "main"
String keyId = cfg.getProperty("AWS_ACCESS_KEY_ID")
String secret = cfg.getProperty("AWS_SECRET_ACCESS_KEY")
String repo = cfg.getProperty("PULSE_REPO")

if (keyId && secret) {
    def store = SystemCredentialsProvider.getInstance().getStore()
    def present = store.getCredentials(Domain.global()).any { it.id == credId }
    if (present) {
        log "credential '" + credId + "' already exists - leaving it alone"
    } else {
        store.addCredentials(Domain.global(), new UsernamePasswordCredentialsImpl(
                CredentialsScope.GLOBAL, credId,
                "Amazon ECR - IAM user access key", keyId, secret))
        log "created ECR credential '" + credId + "'"
    }
} else {
    log "SKIPPED credential: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in /opt/pulsechat/jenkins.env"
}

if (repo) {
    WorkflowJob job = j.getItem(jobName)
    if (job == null) {
        job = j.createProject(WorkflowJob, jobName)
    }
    def scm = new GitSCM(GitSCM.createRepoList(repo, null), [new BranchSpec("*/" + branch)], null, null, [])
    job.setDefinition(new CpsScmFlowDefinition(scm, "Jenkinsfile"))
    job.save()
    log "pipeline job '" + jobName + "' -> " + repo + " (" + branch + ")"
} else {
    log "SKIPPED job: set PULSE_REPO in /opt/pulsechat/jenkins.env"
}