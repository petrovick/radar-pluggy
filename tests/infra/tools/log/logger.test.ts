import { describe, expect, it } from 'vitest'
import { createLogger } from '../../../../src/infra/tools/log/logger.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

describe('Logger com allowlist estrita', () => {
  it('filtra campos de contexto mantendo apenas chaves permitidas', () => {
    let output = ''
    const logger = createLogger((_level, line) => {
      output = line
    })

    logger.addContext({
      itemId: 'item-123',
      personId: 42,
      secretPassword: 'super-secret-password',
      authToken: 'bearer-xyz',
    })

    logger.info('mensagem de teste')

    const parsed = JSON.parse(output)
    expect(parsed.itemId).toBe('item-123')
    expect(parsed.personId).toBe(42)
    expect(parsed.secretPassword).toBeUndefined()
    expect(parsed.authToken).toBeUndefined()
    expect(output).not.toContain('super-secret-password')
    expect(output).not.toContain('bearer-xyz')
  })

  it('redige completamente DatabaseError do Sequelize: remove SQL, parâmetros e mensagens sensíveis', () => {
    let output = ''
    const logger = createLogger((_level, line) => {
      output = line
    })

    const fakeSequelizeError = {
      name: 'SequelizeDatabaseError',
      message: 'SELECT * FROM pluggy_connector_accounts WHERE balance = 1234.56 AND secret = "chave_sintetica"',
      sql: 'SELECT * FROM pluggy_connector_accounts WHERE balance = 1234.56 AND secret = "chave_sintetica"',
      parameters: ['1234.56', 'chave_sintetica'],
      parent: { detail: 'detalhe interno do driver mysql' },
      original: { code: 'ER_BAD_FIELD_ERROR' },
    }

    logger.error('falha no banco de dados', { err: fakeSequelizeError })

    expect(output).not.toContain('SELECT')
    expect(output).not.toContain('balance')
    expect(output).not.toContain('1234.56')
    expect(output).not.toContain('chave_sintetica')
    expect(output).not.toContain('detalhe interno')

    const parsed = JSON.parse(output)
    expect(parsed.level).toBe('error')
    expect(parsed.message).toBe('falha no banco de dados')
    expect(parsed.extra.error).toEqual({
      name: 'SequelizeDatabaseError',
      code: 'ER_BAD_FIELD_ERROR',
    })
  })

  it('filtra detalhes de ApplicationError permitindo apenas campos seguros', () => {
    let output = ''
    const logger = createLogger((_level, line) => {
      output = line
    })

    const appError = new ApplicationError('PLUGGY_ITEM_UNAUTHORIZED', {
      itemId: 'item-99',
      personId: 10,
      clientSecret: 'shhh-secret',
      financialBalance: 5000,
    } as unknown as Record<string, unknown>)

    logger.error('acesso não autorizado', { err: appError })

    const parsed = JSON.parse(output)
    expect(parsed.extra.error).toEqual({
      errorType: 'PLUGGY_ITEM_UNAUTHORIZED',
      details: {
        itemId: 'item-99',
        personId: 10,
      },
    })
    expect(output).not.toContain('shhh-secret')
    expect(output).not.toContain('financialBalance')
  })

  it('filtra propriedades arbitrárias em extra mantendo apenas allowlist', () => {
    let output = ''
    const logger = createLogger((_level, line) => {
      output = line
    })

    logger.info('progresso', {
      sourcesScanned: 5,
      executionStatus: 'SUCCESS',
      arbitrarySensitiveData: 'nao-deve-aparecer',
    })

    const parsed = JSON.parse(output)
    expect(parsed.extra).toEqual({
      sourcesScanned: 5,
      executionStatus: 'SUCCESS',
    })
    expect(output).not.toContain('nao-deve-aparecer')
  })
})
