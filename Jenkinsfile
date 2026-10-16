pipeline {
  agent any

  triggers {
    // auto-run on every new commit pushed to GitHub (checked every ~2 minutes)
    pollSCM('H/2 * * * *')
  }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    // ---- EDIT: region should match your EC2 instance --------------------------
    AWS_REGION = 'ap-south-1'
    AWS_DEFAULT_REGION = 'ap-south-1'   // aws cli v2 reads this one
    ECR_REPO   = 'pulsechat'
    // Jenkins credential (Username/Password) = AWS access key id + secret access key
    ECR_CREDS  = 'ecr-creds'
    // Minikube kubeconfig, created because Minikube is started as the jenkins user (setup-ec2.sh)
    KUBECONFIG = '/var/lib/jenkins/.kube/config'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Build & Test') {
      steps {
        sh '''
          set -e
          python3 -m venv .venv
          .venv/bin/pip install --quiet --upgrade pip
          .venv/bin/pip install --quiet -r requirements.txt
          .venv/bin/python -m py_compile app.py
          .venv/bin/python -m pytest -q
        '''
      }
    }

    // The account id is never hardcoded: we ask AWS who we are, then build the
    // private registry endpoint <account>.dkr.ecr.<region>.amazonaws.com
    stage('ECR Setup') {
      steps {
        withCredentials([usernamePassword(credentialsId: env.ECR_CREDS,
                                         usernameVariable: 'AWS_ACCESS_KEY_ID',
                                         passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''
            set -e
            echo "region: $AWS_REGION"
            ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
            REGISTRY="${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
            echo "$REGISTRY" > .registry
            echo "registry: $REGISTRY"
            aws ecr describe-repositories --region "$AWS_REGION" \
              --repository-names "$ECR_REPO" >/dev/null 2>&1 \
              || aws ecr create-repository --region "$AWS_REGION" \
                   --repository-name "$ECR_REPO" \
                   --image-scanning-configuration scanOnPush=true >/dev/null
            # free tier: only 500 MB of private ECR storage - keep the 3 newest images
            aws ecr put-lifecycle-policy --region "$AWS_REGION" --repository-name "$ECR_REPO" \
              --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep last 3","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}' >/dev/null \
              || echo "lifecycle policy skipped (needs ecr:PutLifecyclePolicy)"
            echo "repository ready: $REGISTRY/$ECR_REPO"
          '''
        }
      }
    }

    stage('Docker Build') {
      steps {
        sh '''
          set -e
          REGISTRY=$(cat .registry)
          docker version --format 'server {{.Server.Version}}'
          docker build -t "$REGISTRY/$ECR_REPO:${BUILD_NUMBER}" -t "$REGISTRY/$ECR_REPO:latest" .
          docker images "$REGISTRY/$ECR_REPO"
        '''
      }
    }

    stage('Push Image to ECR') {
      steps {
        withCredentials([usernamePassword(credentialsId: env.ECR_CREDS,
                                         usernameVariable: 'AWS_ACCESS_KEY_ID',
                                         passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''
            set -e
            REGISTRY=$(cat .registry)
            aws ecr get-login-password --region "$AWS_REGION" \
              | docker login --username AWS --password-stdin "$REGISTRY"
            docker push "$REGISTRY/$ECR_REPO:${BUILD_NUMBER}"
            docker push "$REGISTRY/$ECR_REPO:latest"
            echo "pushed - latest image now in ECR:"
            aws ecr describe-images --region "$AWS_REGION" --repository-name "$ECR_REPO" \
              --query 'sort_by(imageDetails,&pushTimestamp)[-1].[imageTag,pushTimestamp]' --output text
          '''
        }
      }
    }

    stage('Deploy to Minikube') {
      steps {
        withCredentials([usernamePassword(credentialsId: env.ECR_CREDS,
                                         usernameVariable: 'AWS_ACCESS_KEY_ID',
                                         passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
          sh '''
            set -e
            REGISTRY=$(cat .registry)
            IMAGE="$REGISTRY/$ECR_REPO"

            # private ECR: the nodes need a pull secret to fetch the image
            aws ecr get-login-password --region "$AWS_REGION" \
              | kubectl create secret docker-registry ecr-pull \
                  --docker-server="$REGISTRY" --docker-username=AWS --docker-password-stdin \
                  --dry-run=client -o yaml | kubectl apply -f -

            # keep the manifest in step with what we just pushed
            sed -i "s|image: .*/${ECR_REPO}:.*|image: $IMAGE:${BUILD_NUMBER}|" k8s/deployment.yaml
            kubectl apply -f k8s/pvc.yaml
            kubectl apply -f k8s/deployment.yaml
            kubectl apply -f k8s/service.yaml
            kubectl set image deployment/pulsechat pulsechat="$IMAGE:${BUILD_NUMBER}"
            kubectl set env deployment/pulsechat APP_VERSION=v2.0-BUILD-${BUILD_NUMBER} BUILD_NUMBER=${BUILD_NUMBER}
            kubectl rollout status deployment/pulsechat --timeout=180s
          '''
        }
      }
    }

    stage('Verify') {
      steps {
        sh 'bash scripts/verify.sh'
      }
    }
  }

  post {
    always {
      // keep the small free-tier disk from filling up
      sh 'docker image prune -f || true; docker builder prune -f --keep-storage 2GB || true'
    }
    success {
      echo "SUCCESS: $ECR_REPO:${BUILD_NUMBER} is live on Minikube."
    }
    failure {
      echo 'FAILED: inspect the failing stage log above.'
    }
  }
}