import { copyFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const ensureLocalConfig = () => {
  const source = join('src', 'infra', 'config', 'config.example.json')
  const destination = join('src', 'infra', 'config', 'config.json')
  if (existsSync(destination)) {
    console.log(`${destination} já existe. Pulando.`)
  } else {
    copyFileSync(source, destination)
    console.log(`Gerado ${destination} a partir de ${source}.`)
  }

  const databaseSource = join('src', 'infra', 'config', 'databases.example.json')
  const databaseDestination = join('src', 'infra', 'config', 'databases.json')
  if (existsSync(databaseDestination)) {
    console.log(`${databaseDestination} já existe. Pulando.`)
  } else {
    copyFileSync(databaseSource, databaseDestination)
    console.log(`Gerado ${databaseDestination} a partir de ${databaseSource}.`)
  }
}

const validateNoPlaceholders = () => {
  const destination = join('src', 'infra', 'config', 'config.json')
  const databaseDestination = join('src', 'infra', 'config', 'databases.json')

  const placeholders = [
    'INFORME_AQUI_CHAVE_BASE64_32_BYTES',
    'INFORME_AQUI_JWT_SECRET',
    'INFORME_AQUI_SENHA_BANCO',
    'INFORME_AQUI_USUARIO_BANCO',
  ]

  for (const filePath of [destination, databaseDestination]) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8')
      for (const ph of placeholders) {
        if (content.includes(ph)) {
          console.error(`\n[ERRO DE CONFIGURAÇÃO] O arquivo ${filePath} ainda contém o placeholder "${ph}".`)
          console.error('Configure suas credenciais locais antes de executar o setup e as migrations.\n')
          process.exit(1)
        }
      }
    }
  }
}

// Schema oplab_radar é compartilhado com o oplab-radar-api e já existe no MySQL de dev — só
// migra as tabelas deste serviço, nunca `db:create`.
const migrate = () => {
  const databaseDestination = join('src', 'infra', 'config', 'databases.json')
  const parsed = JSON.parse(readFileSync(databaseDestination, 'utf8'))
  const main = parsed.main || {}
  const dbUser = main.username
  const dbPassword = main.password
  const dbPort = (main.port ? String(main.port) : undefined)
  const dbName = main.database
  const dbHost = main.replication.write.host

  const effective = {
    MYSQL_HOST: dbHost,
    MYSQL_PORT: dbPort,
    MYSQL_DATABASE: dbName,
    MYSQL_USER: dbUser,
    MYSQL_PASSWORD: dbPassword,
  }

  execSync('npx sequelize-cli db:migrate', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...effective,
    },
  })
}

function run() {
  const cmd = process.argv[2]

  if (cmd !== 'setup') {
    console.error('Comando desconhecido. Uso: node tasks/setup.mjs setup')
    process.exit(1)
  }

  ensureLocalConfig()
  validateNoPlaceholders()
  migrate()
}

run()
