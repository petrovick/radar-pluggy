import { describe, expect, it } from 'vitest'
import { toConnectionStatus } from '../../../src/adapters/gateways/pluggy-connection-status.js'

const base = { inactiveAt: undefined, status: undefined, executionStatus: undefined }

describe('toConnectionStatus', () => {
  it('DISCONNECTED vem exclusivamente de inactiveAt, antes de qualquer tradução de (status, executionStatus)', () => {
    expect(toConnectionStatus({ ...base, inactiveAt: new Date(), status: 'UPDATED', executionStatus: 'SUCCESS' })).toBe(
      'DISCONNECTED',
    )
  })

  it('item nunca observado responde UNKNOWN, nunca CONNECTED por omissão', () => {
    expect(toConnectionStatus(base)).toBe('UNKNOWN')
  })

  it('UPDATED + SUCCESS é CONNECTED', () => {
    expect(toConnectionStatus({ ...base, status: 'UPDATED', executionStatus: 'SUCCESS' })).toBe('CONNECTED')
  })

  it('UPDATED + PARTIAL_SUCCESS é PARTIAL', () => {
    expect(toConnectionStatus({ ...base, status: 'UPDATED', executionStatus: 'PARTIAL_SUCCESS' })).toBe('PARTIAL')
  })

  it('LOGIN_ERROR é NEEDS_RECONNECT', () => {
    expect(toConnectionStatus({ ...base, status: 'LOGIN_ERROR', executionStatus: 'ERROR' })).toBe('NEEDS_RECONNECT')
  })

  it.each(['WAITING_USER_INPUT', 'WAITING_USER_ACTION'])('%s é AWAITING_USER_INPUT', (status) => {
    expect(toConnectionStatus({ ...base, status, executionStatus: 'WAITING_USER_INPUT' })).toBe('AWAITING_USER_INPUT')
  })

  it.each(['UPDATING', 'MERGING'])('%s é CONNECTING', (status) => {
    expect(toConnectionStatus({ ...base, status, executionStatus: 'UPDATING' })).toBe('CONNECTING')
  })

  it('OUTDATED é STALE', () => {
    expect(toConnectionStatus({ ...base, status: 'OUTDATED', executionStatus: 'OUTDATED' })).toBe('STALE')
  })
})
