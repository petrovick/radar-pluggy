import { describe, expect, it, vi } from 'vitest'
import { PluggyItemCredentialResolver } from '../../../src/adapters/gateways/pluggy-item-credential.resolver.js'
import { PluggyCredential } from '../../../src/entities/pluggy-credential.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

const credential = PluggyCredential.reconstitute({
  id: 42,
  personId: 5,
  clientId: 'client-1',
  clientSecret: 'segredo',
})

function buildResolver(options: {
  credentialIdByItem?: number | undefined
  credentialById?: PluggyCredential | undefined
  clientFor?: (clientId: string, clientSecret: string) => unknown
}) {
  const findCredentialIdByItemId = vi.fn().mockResolvedValue(options.credentialIdByItem)
  const findById = vi.fn().mockResolvedValue(options.credentialById)
  const findByItemId = vi.fn().mockResolvedValue(undefined)

  const container = {
    pluggyCredentialItemRep: { findCredentialIdByItemId, findByItemId },
    pluggyCredentialRep: { findById },
    pluggyClientGateway: { clientFor: options.clientFor ?? vi.fn().mockReturnValue({ id: 'cliente-do-sdk' }) },
    pluggyCallRecorder: { record: () => {} },
  } as unknown as AppContainer

  return { resolver: new PluggyItemCredentialResolver(container), findCredentialIdByItemId, findById }
}

describe('PluggyItemCredentialResolver', () => {
  it('credentialFor devolve a credencial do item', async () => {
    const { resolver } = buildResolver({ credentialIdByItem: 42, credentialById: credential })

    await expect(resolver.credentialFor('item-1')).resolves.toBe(credential)
  })

  it('credentialFor distingue item sem vínculo de credencial inexistente', async () => {
    const semVinculo = buildResolver({ credentialIdByItem: undefined })
    await expect(semVinculo.resolver.credentialFor('item-1')).rejects.toMatchObject({
      errorType: 'PLUGGY_CREDENTIAL_ITEM_NOT_LINKED',
    })

    const semCredencial = buildResolver({ credentialIdByItem: 42, credentialById: undefined })
    await expect(semCredencial.resolver.credentialFor('item-1')).rejects.toMatchObject({
      errorType: 'PLUGGY_CREDENTIAL_NOT_FOUND',
      details: { itemId: 'item-1', credentialId: 42 },
    })
  })

  it('findCredentialFor devolve undefined nas duas ausências, sem revelar qual foi', async () => {
    const semVinculo = buildResolver({ credentialIdByItem: undefined })
    await expect(semVinculo.resolver.findCredentialFor('item-1')).resolves.toBeUndefined()

    const semCredencial = buildResolver({ credentialIdByItem: 42, credentialById: undefined })
    await expect(semCredencial.resolver.findCredentialFor('item-1')).resolves.toBeUndefined()
  })

  it('findCredentialFor deixa falha de banco estourar — ausência não é o mesmo que erro', async () => {
    const { resolver, findCredentialIdByItemId } = buildResolver({})
    findCredentialIdByItemId.mockRejectedValue(new Error('conexão caiu'))

    await expect(resolver.findCredentialFor('item-1')).rejects.toThrow('conexão caiu')
  })

  it('memoiza a credencial por unidade de trabalho: duas chamadas, uma leitura de cada tabela', async () => {
    const { resolver, findCredentialIdByItemId, findById } = buildResolver({
      credentialIdByItem: 42,
      credentialById: credential,
    })

    await resolver.credentialFor('item-1')
    await resolver.findCredentialFor('item-1')
    await resolver.clientFor('item-1')

    expect(findCredentialIdByItemId).toHaveBeenCalledTimes(1)
    expect(findById).toHaveBeenCalledTimes(1)
  })

  it('clientFor resolve o cliente com as credenciais daquele item, nunca com um segredo de processo', async () => {
    const clientDoItem = { id: 'cliente-do-item' }
    const clientForCredential = vi.fn().mockReturnValue(clientDoItem)
    const { resolver } = buildResolver({
      credentialIdByItem: 42,
      credentialById: credential,
      clientFor: clientForCredential,
    })

    // O cliente devolvido é instrumentado (design.md D3) — um Proxy em volta do cliente real, nunca
    // a mesma referência, mas com o mesmo comportamento observável.
    await expect(resolver.clientFor('item-1')).resolves.toEqual(clientDoItem)
    expect(clientForCredential).toHaveBeenCalledWith('client-1', 'segredo')
  })

  it('clientFor propaga a recusa nomeada quando o item não tem credencial vinculada', async () => {
    const { resolver } = buildResolver({ credentialIdByItem: undefined })

    await expect(resolver.clientFor('item-1')).rejects.toBeInstanceOf(ApplicationError)
  })
})
