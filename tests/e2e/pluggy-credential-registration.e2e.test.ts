import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { asValue } from 'awilix'
import { Op } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpServer } from '../../src/infra/http/http-server.js'
import { setupContainer, type AppContainerInstance } from '../../src/infra/bootstrap/register.js'
import type { PersonRep } from '../../src/adapters/repositories/person.rep.js'
import type { PluggyClientGateway } from '../../src/adapters/gateways/pluggy-client.gateway.js'
import type { Config } from '../../src/infra/config/config.js'
import { createDatabaseConnection } from '../../src/infra/db/database.js'
import { testDatabaseConfig } from '../support/test-database-config.js'
import { definePluggyCredentialModel } from '../../src/infra/db/models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from '../../src/infra/db/models/pluggy-credential-item-model.js'
import { definePluggyItemObservationModel } from '../../src/infra/db/models/pluggy-item-observation-model.js'
import { definePluggyCallModel } from '../../src/infra/db/models/pluggy-call-model.js'
import { definePluggySyncProgressModel } from '../../src/infra/db/models/pluggy-sync-progress-model.js'

// Ponta a ponta do cadastro (tasks.md 10.3): sobe o container REAL (DI de produção,
// `setupContainer`), o servidor HTTP real, e a base de teste real — só o client do SDK da Pluggy é
// substituído por um fake na fronteira mais baixa possível (`pluggyClientGateway`), porque é o único
// jeito de nunca fazer uma chamada de rede de verdade. Tudo que roda ENTRE `POST /credentials` e a
// resposta de `GET /credentials/status` é código de produção sem nenhum outro fake: o cadastro real
// dispara a pré-carga real (D16), que aciona o lease real, os interactors reais de Position/History,
// e grava linhas reais em `radar_pluggy_calls`/`radar_pluggy_item_observations`.
const JWT_SECRET = 'segredo-e2e-com-pelo-menos-32-caracteres!!'
const FAKE_CONNECTOR_ID = 201
const ITEM_UPDATED_AT = '2026-09-07T12:00:00.000Z'
const TEST_PERSON_ID = 950_000_000 + Math.floor(Math.random() * 40_000_000)
const ITEM_ID = randomUUID()

function signToken(sub: string): string {
  const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }))
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

// Cadastro só habilita ACCOUNTS (D26): mantém o fake do client mínimo — Position (INVESTMENTS/LOANS)
// nunca fica elegível, então nunca chama consentimento/investimentos/empréstimos; History só varre
// ACCOUNTS (ACCOUNT_TRANSACTIONS não habilitada), com lista de contas autoritativa vazia (D21).
function buildFakeClient() {
  return {
    fetchItem: async () => ({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: ITEM_UPDATED_AT,
      updatedAt: ITEM_UPDATED_AT,
      nextAutoSyncAt: null,
      statusDetail: null,
      products: ['ACCOUNTS'],
      connector: {
        id: FAKE_CONNECTOR_ID,
        name: 'Banco Exemplo E2E',
        imageUrl: null,
        primaryColor: null,
        products: ['ACCOUNTS'],
      },
    }),
    fetchAccountsPage: async () => ({ results: [], page: 1, total: 0, totalPages: 1 }),
    createWebhook: async () => ({ id: 'wh-e2e-fake-1', url: 'https://example.com/webhooks/pluggy', event: 'all' }),
    updateWebhook: async () => ({ id: 'wh-e2e-fake-1', url: 'https://example.com/webhooks/pluggy', event: 'all' }),
    fetchWebhook: async () => {
      throw new Error('não deveria ser chamado: credencial nova nunca tem webhook salvo antes')
    },
  }
}

async function waitFor(predicate: () => Promise<boolean>, attempts = 60, intervalMs = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`condição não satisfeita após ${attempts} tentativas`)
}

describe('POST /credentials → pré-carga → GET /credentials/status (ponta a ponta)', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const credentialModel = definePluggyCredentialModel(sequelize)
  const credentialItemModel = definePluggyCredentialItemModel(sequelize)
  const observationModel = definePluggyItemObservationModel(sequelize)
  const callModel = definePluggyCallModel(sequelize)
  const syncProgressModel = definePluggySyncProgressModel(sequelize)

  let container: AppContainerInstance
  let server: Server | undefined
  let port: number
  let createdCredentialId: number | undefined

  beforeAll(async () => {
    const config: Config = {
      port: 0,
      jwtSecret: JWT_SECRET,
      webhookUrl: 'https://example.com/webhooks/pluggy',
      credentialEncryptionKey: randomBytes(32).toString('base64'),
      database: testDatabaseConfig(),
    }
    container = setupContainer(config)

    // Único ponto de substituição: a fronteira mais baixa do SDK da Pluggy — nunca o interactor, nunca
    // o impl, nunca o resolver de credencial/item, todos rodam como em produção.
    const fakePersonRep = { findIdByUsername: async () => TEST_PERSON_ID } as unknown as PersonRep
    const fakeClientGateway = {
      clientFor: () => buildFakeClient(),
      createFreshClient: () => buildFakeClient(),
    } as unknown as PluggyClientGateway
    container.register({
      personRep: asValue(fakePersonRep),
      pluggyClientGateway: asValue(fakeClientGateway),
    })

    const app = createHttpServer({ jwtSecret: JWT_SECRET, container })
    port = await new Promise<number>((resolve) => {
      server = app.listen(0, () => {
        const address = server?.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
  })

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
    }
    await credentialItemModel.destroy({ where: { item_id: ITEM_ID } })
    await observationModel.destroy({ where: { item_id: ITEM_ID } })
    await syncProgressModel.destroy({ where: { item_id: ITEM_ID } })
    await callModel.destroy({ where: { item_id: ITEM_ID } })
    if (createdCredentialId !== undefined) {
      await credentialModel.destroy({ where: { id: createdCredentialId } })
    }
    await sequelize.close()
    await container.resolve('db').connections.main?.close()
  })

  it('cadastra, pré-carrega em background e reflete o estado em /credentials/status', async () => {
    const testStartedAt = new Date()
    const registerResponse = await fetch(`http://127.0.0.1:${port}/credentials`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken('titular-e2e')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), clientSecret: 'segredo-e2e', itemId: ITEM_ID }),
    })

    expect(registerResponse.status).toBe(201)
    const registerBody = (await registerResponse.json()) as { id: number }
    createdCredentialId = registerBody.id

    // Sinal de conclusão da pré-carga: o avanço real de `radar_pluggy_sync_progress` para ACCOUNTS —
    // última escrita AWAITED da cadeia História→ACCOUNTS, nunca a gravação best-effort de
    // `radar_pluggy_calls` (fire-and-forget, D25), que pode legitimamente chegar um instante depois.
    await waitFor(async () => {
      const rows = await syncProgressModel.findAll({
        where: { item_id: ITEM_ID, consumer: 'HISTORY_LOAD', source: 'ACCOUNTS' },
      })
      return rows.length > 0
    })

    // Observação aceita (design.md D33) — gravada ANTES de Position/History processarem, mas só
    // existe garantidamente depois que a pré-carga rodou.
    const observationRows = await observationModel.findAll({ where: { item_id: ITEM_ID } })
    expect(observationRows).toHaveLength(1)
    expect(observationRows[0]?.get('execution_status')).toBe('SUCCESS')

    // `radar_pluggy_calls`: os três triggers do cadastro (tasks.md 8.8/10.3) — gravação best-effort,
    // pode chegar depois da escrita síncrona acima, por isso o polling próprio. O provisionamento de
    // webhook (`CREDENTIAL_REGISTRATION_PROVISIONING`) grava `item_id = NULL` (design.md D22:
    // `call_scope = PLATFORM_CONFIG` é por credencial, nunca por item) — por isso filtra por janela
    // de tempo, não por `item_id`, para pegar as três.
    await waitFor(async () => {
      const byItem = await callModel.findAll({ where: { item_id: ITEM_ID } })
      const byWindow = await callModel.findAll({ where: { created_at: { [Op.gte]: testStartedAt } } })
      const triggers = new Set([...byItem, ...byWindow].map((row) => row.get('trigger')))
      return (
        triggers.has('CREDENTIAL_REGISTRATION_VALIDATION') &&
        triggers.has('CREDENTIAL_REGISTRATION_PROVISIONING') &&
        triggers.has('CREDENTIAL_REGISTRATION_PRELOAD')
      )
    })

    const statusResponse = await fetch(`http://127.0.0.1:${port}/credentials/status`, {
      headers: { authorization: `Bearer ${signToken('titular-e2e')}` },
    })
    expect(statusResponse.status).toBe(200)
    const statusBody = (await statusResponse.json()) as {
      hasCredential: boolean
      items: { itemId: string; connectionStatus: string; connectorId: number; sources: Record<string, unknown> }[]
    }

    expect(statusBody.hasCredential).toBe(true)
    const item = statusBody.items.find((candidate) => candidate.itemId === ITEM_ID)
    expect(item).toBeDefined()
    expect(item?.connectionStatus).toBe('CONNECTED')
    expect(item?.connectorId).toBe(FAKE_CONNECTOR_ID)
    expect(item?.sources).toMatchObject({
      accounts: { supportedByConnector: true, enabledForItem: true, isUpdated: true },
      loans: { supportedByConnector: false },
    })
  }, 20_000)
})
