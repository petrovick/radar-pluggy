import { defineRailway, image, preserve, project, service } from 'railway/iac'

// `oplab-radar-api`/`oplab-radar-front` vivem em outro repositório e não são declarados aqui.
// `partial` diz ao Railway que este arquivo só é dono do `radar-pluggy` — sem isso, `config
// apply` reconciliaria o projeto inteiro e poderia remover os outros dois serviços.
export const partial = 'radar-pluggy'

export default defineRailway(() => {
  const app = service('radar-pluggy', {
    source: image('ghcr.io/petrovick/radar-pluggy:staging'),
    healthcheck: '/healthcheck',
    preDeploy: 'node node_modules/sequelize-cli/lib/sequelize db:migrate --env staging',
    // Domínio customizado, anexado à parte (MCP Railway `generate-domain`) — `config apply` recusa
    // CRIAR domínio custom por IaC. Declarado aqui só como documentação do estado real.
    domains: ['radar-pluggy.petrovick.work'],
    env: {
      NODE_ENV: 'staging',
      // Mesmo banco físico do `oplab-radar-api` (schema `oplab_radar`, mesmo Aiven) — referência
      // resolvida pelo próprio Railway, nunca em texto puro neste arquivo nem no meu contexto.
      DATABASES: '${{oplab-radar-api.DATABASES}}',
      // `pluggy.credentialEncryptionKey` mora dentro do `CONFIG` — decisão explícita do usuário:
      // este tipo de config vive no blob de config, não em variável de ambiente solta.
      // `preserve()` impede que `config apply` sobrescreva com valor vazio a cada reaplicação.
      CONFIG: preserve(),
    },
  })

  return project('oplab-radar', { resources: [app] })
})
