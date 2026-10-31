pipeline {
  agent none
  options {
    timestamps()
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }
  parameters {
    booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Deploy the verified main build to this Jenkins host')
  }
  stages {
    stage('Main CI/CD') {
      when {
        beforeAgent true
        branch 'main'
      }
      agent any
      stages {
        stage('Checkout') {
          steps { checkout scm }
        }
        stage('Install') {
          steps { sh 'bash scripts/ci-log.sh install npm ci --no-audit --no-fund' }
        }
        stage('Generate') {
          steps { sh 'bash scripts/ci-log.sh generate npm run db:generate' }
        }
        stage('Test') {
          steps { sh 'bash scripts/ci-log.sh test npm test' }
        }
        stage('Typecheck') {
          steps { sh 'bash scripts/ci-log.sh typecheck npm run typecheck' }
        }
        stage('Build') {
          steps { sh 'bash scripts/ci-log.sh build npm run build' }
        }
        stage('Docker build') {
          steps { sh 'bash scripts/ci-log.sh docker-build bash scripts/ci-docker-build.sh' }
        }
        stage('Retain three images') {
          steps { sh 'bash scripts/ci-log.sh image-retention bash scripts/ci-prune-images.sh' }
        }
        stage('Deploy') {
          when { expression { params.DEPLOY } }
          steps {
            withCredentials([file(credentialsId: 'tiktok-cungduong', variable: 'DEPLOY_ENV')]) {
              sh 'bash scripts/ci-log.sh deploy bash scripts/ci-deploy.sh "$DEPLOY_ENV" "$BUILD_NUMBER"'
            }
          }
        }
      }
      post {
        failure {
          sh '''#!/usr/bin/env bash
mkdir -p ci-logs
docker ps -a --filter label=com.docker.compose.project=tiktok-cungduong --format '{{.Names}} {{.Status}}' > ci-logs/docker-containers.log 2>&1 || true
for service in api web tiktok-worker ai-worker; do
  container=$(docker ps -aq --filter label=com.docker.compose.project=tiktok-cungduong --filter "label=com.docker.compose.service=$service" | head -n 1)
  if [ -n "$container" ]; then
    docker logs --timestamps --tail 200 "$container" > "ci-logs/$service.log" 2>&1 || true
  fi
done
'''
          archiveArtifacts artifacts: 'ci-logs/*.log', allowEmptyArchive: true
          echo 'CI/CD failed. See the archived ci-logs artifacts and Jenkins console output.'
        }
      }
    }
  }
}
