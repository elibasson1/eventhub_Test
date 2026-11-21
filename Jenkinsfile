// Jenkins pipeline: runs the Playwright E2E suite (Chromium) against the live
// site configured in playwright.config.ts.
//
// Trigger: polls GitHub every ~5 minutes and builds when main has new commits
// (a local Jenkins at localhost cannot receive GitHub webhooks).
//
// Results: JUnit test results (trend + per-test view in Jenkins) and the
// Playwright HTML report archived as a build artifact.
//
// Written for a Windows agent (uses `bat`).

pipeline {
    agent any

    triggers {
        pollSCM('H/5 * * * *')
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        CI = 'true'
        PLAYWRIGHT_JUNIT_OUTPUT_NAME = 'test-results/junit.xml'
    }

    stages {
        stage('Install dependencies') {
            steps {
                bat 'node -v && npm -v'
                bat 'npm ci'
                bat 'npx playwright install chromium'
            }
        }

        stage('Run Playwright tests') {
            steps {
                bat 'npx playwright test --reporter=line,html,junit'
            }
        }
    }

    post {
        always {
            junit allowEmptyResults: true, testResults: 'test-results/junit.xml'
            archiveArtifacts artifacts: 'playwright-report/**', allowEmptyArchive: true
        }
    }
}
