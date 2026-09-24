import type { RequestHandler } from 'express'

/** A browser normally reaches this service through the same-origin frontend proxy. */
export function createHttpBoundaryMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    const origin = req.headers.origin
    if (origin && allowedOrigins.includes(origin)) {
      res.vary('Origin')
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
        res.status(204).end()
        return
      }
    }
    next()
  }
}
