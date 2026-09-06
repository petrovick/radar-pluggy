import childProcess from 'child_process'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// Dois eixos independentes, ambos vindos do ambiente do container: WATCH_FILES liga o poll de
// `src` e o restart; DEBUG liga o inspector. Mesma convenção do oplab-radar-api, sem role args
// (`--httpServer`/`--sqsPoller`): este processo só tem um papel.
const watchFiles = ['1', 'true'].includes(process.env.WATCH_FILES ?? '')
const debugMode = ['1', 'true'].includes(process.env.DEBUG ?? '')

let nodeApp
let isRestarting = false
let restartTimer
let pollTimer
let sourceSnapshot = new Map()

process.on('SIGINT', () => {
  shutdown().then(() => process.exit(0))
})

process.on('SIGTERM', () => {
  shutdown().then(() => process.exit(0))
})

const killNodeApp = (app) => {
  return new Promise((resolve) => {
    if (!app) {
      resolve()
      return
    }

    app.on('close', (code) => {
      resolve(code)
    })
    app.kill('SIGINT')
  })
}

const build = () => {
  execSync('npm run build', { stdio: 'inherit' })
}

const startNodeServer = async () => {
  build()

  if (!fs.existsSync('dist/index.js')) {
    return
  }

  await killNodeApp(nodeApp)

  const params = ['dist/index.js']
  if (debugMode) {
    params.unshift('--inspect=0.0.0.0:9251')
  }

  nodeApp = childProcess.spawn('node', params, { env: process.env })

  // Sem watch não há quem reinicie o app: se ele morre, o container morre junto, em vez de
  // ficar de pé com um supervisor ocioso.
  if (!watchFiles) {
    nodeApp.on('close', (code) => process.exit(code ?? 0))
  }

  nodeApp.stdout.on('data', (data) => {
    console.log(data.toString())
  })

  nodeApp.stderr.on('data', (data) => {
    console.error(data.toString())
  })
}

const scheduleRestart = () => {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartNodeServer()
  }, 250)
}

const restartNodeServer = async () => {
  if (isRestarting) {
    scheduleRestart()
    return
  }

  isRestarting = true

  try {
    await startNodeServer()
  } catch (err) {
    console.error(err)
  } finally {
    isRestarting = false
  }
}

const collectSourceSnapshot = () => {
  const snapshot = new Map()

  if (!fs.existsSync('src')) {
    return snapshot
  }

  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        visit(entryPath)
        continue
      }

      if (entry.isFile() && entryPath.endsWith('.ts')) {
        const stat = fs.statSync(entryPath)
        snapshot.set(entryPath, `${stat.mtimeMs}:${stat.size}`)
      }
    }
  }

  visit('src')
  return snapshot
}

const hasSourceChanged = (previousSnapshot, nextSnapshot) => {
  if (previousSnapshot.size !== nextSnapshot.size) {
    return true
  }

  for (const [filePath, fileState] of nextSnapshot) {
    if (previousSnapshot.get(filePath) !== fileState) {
      return true
    }
  }

  return false
}

const startPolling = () => {
  sourceSnapshot = collectSourceSnapshot()

  pollTimer = setInterval(() => {
    const nextSnapshot = collectSourceSnapshot()

    if (!hasSourceChanged(sourceSnapshot, nextSnapshot)) {
      return
    }

    sourceSnapshot = nextSnapshot
    console.log('Source files changed')
    scheduleRestart()
  }, 1000)
}

const shutdown = async () => {
  clearTimeout(restartTimer)
  clearInterval(pollTimer)
  await killNodeApp(nodeApp)
}

console.log(`Starting app (watch=${watchFiles ? 'on' : 'off'}, debug=${debugMode ? 'on' : 'off'})`)

if (watchFiles) {
  restartNodeServer().then(startPolling)
} else {
  restartNodeServer()
}
