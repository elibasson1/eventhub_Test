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
// Results: Allure report, JUnit test results (trend + per-test view) and the
// Playwright HTML report archived as a build artifact.
//
// Written for a Windows agent (uses `bat`).

// Stops whatever is listening on the app ports (leftovers or this build's servers).
// (powershell.exe by full path: it is not on the Jenkins service's PATH.)
void stopApp() {
    bat '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command ' +
        '"foreach ($p in 4000,4001) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ' +
        'ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }; exit 0"'
}

pipeline {
    // HEADED builds run on the "local-ui" agent (label `headed`), which runs as
    // the logged-in Windows user, so the Chrome window shows on the desktop.
    // Start it with C:\Users\eliba\jenkins-agent\start-agent.bat.
    // Normal builds run on the Jenkins service (built-in node), no window.
    agent { label "${params.HEADED ? 'headed' : 'built-in'}" }

    parameters {
        booleanParam(name: 'HEADED', defaultValue: false,
            description: 'Show the browser on your desktop (needs the local-ui agent running)')
        string(name: 'SLOW_MO', defaultValue: '500',
            description: 'HEADED only: delay in ms between browser actions, so you can follow along')
    }

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

        // Tell playwright.config.ts + test helpers to target the local app.
        // Jenkins starts/stops the servers itself (stage 'Start app' + post).
        LOCAL_APP     = 'true'
        START_SERVERS = 'false'
        API_URL       = 'http://localhost:4001/api'
        PORT          = '4001'
        CORS_ORIGIN   = 'http://localhost:4000'

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

        stage('Start app') {
            steps {
                script { stopApp() }
                // dontKillMe: keep the servers alive after the bat step ends;
                // stopApp() in post stops them once the build is done.
                withEnv(['JENKINS_NODE_COOKIE=dontKillMe']) {
                    dir('backend') {
                        bat 'start "" /B cmd /c "node server.js > ..\\backend.log 2>&1"'
                    }
                    dir('frontend') {
                        bat 'start "" /B cmd /c "node node_modules\\next\\dist\\bin\\next start -p %WEB_PORT% > ..\\frontend.log 2>&1"'
                    }
                }
                bat 'node scripts\\wait-for-url.js http://localhost:%API_PORT%/api/health http://localhost:%WEB_PORT%'
            }
        }

        stage('Run Playwright tests') {
            steps {
                // The workspace is reused between builds: drop old Allure results
                bat 'if exist allure-results rmdir /s /q allure-results'
                script {
                    if (params.HEADED) {
                        withEnv(["SLOW_MO=${params.SLOW_MO}"]) {
                            bat 'npx playwright test --headed --reporter=line,html,junit,allure-playwright'
                        }
                    } else {
                        bat 'npx playwright test --reporter=line,html,junit,allure-playwright'
                    }
                }
            }
        }
    }

    post {
        always {
            script { stopApp() }
            archiveArtifacts artifacts: 'backend.log, frontend.log', allowEmptyArchive: true
            junit allowEmptyResults: true, testResults: 'test-results/junit.xml'
            archiveArtifacts artifacts: 'playwright-report/**', allowEmptyArchive: true
            // Allure report (Jenkins tool "Allure-Pipeline", auto-installed 2.34.1)
            allure commandline: 'Allure-Pipeline', includeProperties: false, results: [[path: 'allure-results']]
        }
    }
}
