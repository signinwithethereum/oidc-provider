import { getRequestIP } from 'h3'
import { checkRateLimit } from '../utils/rate-limit'

interface RateLimitConfig {
  limit: number
  window: number
}

// Requests per window (seconds) per IP.
const RATE_LIMITS: [string, RateLimitConfig][] = [
  ['/reg', { limit: 5, window: 60 }],
  ['/api/interaction', { limit: 10, window: 60 }],
  ['/session/end', { limit: 10, window: 60 }],
  ['/token', { limit: 20, window: 60 }],
  ['/auth', { limit: 30, window: 60 }],
  ['/me', { limit: 30, window: 60 }],
]

function findConfig(path: string): [string, RateLimitConfig] | null {
  for (const [prefix, config] of RATE_LIMITS) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return [prefix, config]
    }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  const match = findConfig(path)
  if (!match) return

  const [endpoint, config] = match
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const result = await checkRateLimit(ip, endpoint, config.limit, config.window)

  setResponseHeaders(event, {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.reset),
  })

  if (!result.allowed) {
    setResponseHeader(event, 'Retry-After', String(result.reset))
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
    })
  }
})
