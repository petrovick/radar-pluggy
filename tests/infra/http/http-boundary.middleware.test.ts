import express from 'express'
import { describe, expect, it } from 'vitest'
import { createHttpBoundaryMiddleware } from '../../../src/infra/http/middleware/http-boundary.middleware.js'

async function withServer(origins: readonly string[], run: (url: string) => Promise<void>): Promise<void> {
  const app = express()
  app.use(createHttpBoundaryMiddleware(origins))
  app.get('/private', (_req, res) => res.json({ value: 42 }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server address unavailable')
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

describe('Pluggy HTTP boundary', () => {
  it('nega CORS por padrão e impede cache de dados privados diretos', async () => {
    await withServer([], async (url) => {
      const privateResponse = await fetch(`${url}/private`)
      expect(privateResponse.headers.get('cache-control')).toBe('no-store')
      for (const origin of ['https://evil.example', 'null']) {
        const response = await fetch(`${url}/private`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
        })
        expect(response.headers.get('access-control-allow-origin')).toBeNull()
        expect(response.headers.get('access-control-allow-credentials')).toBeNull()
      }
    })
  })

  it('autoriza somente origem exata do config, nunca um sufixo parecido', async () => {
    await withServer(['https://app.example'], async (url) => {
      const allowed = await fetch(`${url}/private`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET' },
      })
      expect(allowed.status).toBe(204)
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example')
      expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')

      const denied = await fetch(`${url}/private`, { headers: { Origin: 'https://app.example.evil' } })
      expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    })
  })
})
