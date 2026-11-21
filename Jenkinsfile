// Jenkins pipeline: pulls the code from GitHub and runs everything on this
// machine — local MySQL, the backend (port 4001), the frontend (port 4000) —
// then runs the Playwright E2E suite (Chromium) against localhost.
//
// Trigger: polls GitHub every ~5 minutes and builds when main has new commits.
//
// Prerequisites on the Jenkins machine:
//   - Node.js in C:\Program Files\nodejs
//   - MySQL 8 running locally
//   - Jenkins "Secret text" credential `eventhub-ci-database-url`, e.g.
//       mysql://root:<password>@localhost:3306/eventhub_ci
//     (a dedicated DB — it is created/migrated/seeded on every build, so your
//      dev `eventhub` database is never touched)
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
        // The Jenkins Windows service does not inherit Node.js on its PATH.
        PATH = "C:\\Program Files\\nodejs;${env.PATH}"

        DATABASE_URL = credentials('eventhub-ci-database-url')
        JWT_SECRET   = 'jenkins_local_ci_secret'

        // Local app ports (different from the 3000/3001 dev servers)
        WEB_PORT = '4000'
        API_PORT = '4001'
        NEXT_PUBLIC_API_URL = 'http://localhost:4001/api'

        // Tell playwright.config.ts + test helpers to target the local app
        LOCAL_APP = 'true'
        API_URL   = 'http://localhost:4001/api'

        PLAYWRIGHT_JUNIT_OUTPUT_NAME = 'test-results/junit.xml'
    }

    stages {
        stage('Install dependencies') {
            steps {
                bat 'node -v && npm -v'
                bat 'npm ci'
                bat 'npm ci --prefix backend'
                bat 'npm ci --prefix frontend'
                bat 'npx playwright install chromium'
            }
        }

        stage('Prepare database') {
            steps {
                dir('backend') {
                    bat 'npx prisma generate'
                    bat 'npx prisma migrate deploy'
                    bat 'npm run seed'
                }
            }
        }

        stage('Build frontend') {
            steps {
                bat 'npm run build --prefix frontend'
            }
        }

        stage('Run Playwright tests') {
            steps {
                // Playwright starts backend + frontend (webServer) and stops them afterwards
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
