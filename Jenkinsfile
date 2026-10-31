pipeline {
  agent any
  options { timestamps(); disableConcurrentBuilds() }
  parameters { booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Deploy to this Jenkins host after checks') }
  stages {
    stage('Checkout') { steps { checkout scm } }
    stage('Install') { steps { sh 'npm ci --no-audit --no-fund' } }
    stage('Generate') { steps { sh 'npm run db:generate && npm run build -w @cd/shared' } }
    stage('Test') { steps { sh 'npm test && npm run typecheck' } }
    stage('Build') { steps { sh 'npm run build' } }
    stage('Docker build') { steps { sh 'docker build -f infrastructure/docker/Dockerfile -t tiktok-cungduong:${BUILD_NUMBER} .' } }
    stage('Deploy') {
      when { allOf { branch 'main'; expression { params.DEPLOY } } }
      steps {
        withCredentials([file(credentialsId: 'cungduong-env', variable: 'DEPLOY_ENV')]) {
          sh 'docker compose --env-file "$DEPLOY_ENV" config -q && docker compose --env-file "$DEPLOY_ENV" up -d --build --wait'
        }
      }
    }
  }
  post { always { sh 'docker image prune -f --filter "label=project=tiktok-cungduong" || true' } }
}
