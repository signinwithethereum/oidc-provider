import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Redis from 'ioredis'

const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379'

vi.stubGlobal('useRuntimeConfig', () => ({
  oidc: { redisUrl: REDIS_URL },
}))

// Stubs for Nitro auto-imports used by the middleware
vi.stubGlobal('defineEventHandler', (fn: Function) => fn)
const mockSetResponseHeaders = vi.fn()
const mockSetResponseHeader = vi.fn()
vi.stubGlobal('setResponseHeaders', mockSetResponseHeaders)
vi.stubGlobal('setResponseHeader', mockSetResponseHeader)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(opts.statusMessage), opts),
)

vi.mock('h3', () => ({
  getRequestIP: () => '127.0.0.1',
}))

const { checkRateLimit } = await import('../server/utils/rate-limit')
const rateLimitMiddleware = (await import('../server/middleware/0.0.rate-limit'))
  .default as (event: { path: string }) => Promise<void>

let redis: Redis

const redisAvailable = await new Redis(REDIS_URL)
  .ping()
  .then(() => true)
  .catch(() => false)

if (!redisAvailable) {
  console.warn(
    '\n⚠  Skipping rate limit tests — Redis is not running.\n' +
      '   Start it with: docker compose up redis\n',
  )
}

describe.skipIf(!redisAvailable)('checkRateLimit', () => {
  beforeAll(() => {
    redis = new Redis(REDIS_URL)
  })

  afterAll(async () => {
    await redis.quit()
  })

  beforeEach(async () => {
    const keys = await redis.keys('rl:*')
    if (keys.length) await redis.del(...keys)
  })

  it('allows requests under the limit', async () => {
    const result = await checkRateLimit('127.0.0.1', '/token', 5, 60)

    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(5)
    expect(result.remaining).toBe(4)
    expect(result.reset).toBeGreaterThan(0)
  })

  it('tracks remaining count across calls', async () => {
    await checkRateLimit('127.0.0.1', '/token', 3, 60)
    await checkRateLimit('127.0.0.1', '/token', 3, 60)
    const result = await checkRateLimit('127.0.0.1', '/token', 3, 60)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0)
  })

  it('blocks requests over the limit', async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit('127.0.0.1', '/reg', 3, 60)
    }
    const result = await checkRateLimit('127.0.0.1', '/reg', 3, 60)

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('isolates limits by IP', async () => {
    for (let i = 0; i < 2; i++) {
      await checkRateLimit('10.0.0.1', '/token', 2, 60)
    }

    const blocked = await checkRateLimit('10.0.0.1', '/token', 2, 60)
    const allowed = await checkRateLimit('10.0.0.2', '/token', 2, 60)

    expect(blocked.allowed).toBe(false)
    expect(allowed.allowed).toBe(true)
  })

  it('isolates limits by endpoint', async () => {
    for (let i = 0; i < 2; i++) {
      await checkRateLimit('127.0.0.1', '/reg', 2, 60)
    }

    const blocked = await checkRateLimit('127.0.0.1', '/reg', 2, 60)
    const allowed = await checkRateLimit('127.0.0.1', '/auth', 2, 60)

    expect(blocked.allowed).toBe(false)
    expect(allowed.allowed).toBe(true)
  })

  it('sets a TTL on the rate limit key', async () => {
    await checkRateLimit('127.0.0.1', '/token', 5, 10)

    const ttl = await redis.ttl('rl:127.0.0.1:/token')
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(10)
  })
})

describe.skipIf(!redisAvailable)('rate-limit middleware', () => {
  beforeAll(() => {
    redis = new Redis(REDIS_URL)
  })

  afterAll(async () => {
    await redis.quit()
  })

  beforeEach(async () => {
    const keys = await redis.keys('rl:*')
    if (keys.length) await redis.del(...keys)
    mockSetResponseHeaders.mockClear()
    mockSetResponseHeader.mockClear()
  })

  it('throws 429 when rate limit is exceeded', async () => {
    // /reg has a limit of 5/min
    for (let i = 0; i < 5; i++) {
      await rateLimitMiddleware({ path: '/reg' })
    }

    const error = await rateLimitMiddleware({ path: '/reg' }).catch((e) => e)

    expect(error).toBeDefined()
    expect(error.statusCode).toBe(429)
    expect(error.message).toBe('Too Many Requests')
  })

  it('sets Retry-After header on 429', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimitMiddleware({ path: '/reg' })
    }

    await rateLimitMiddleware({ path: '/reg' }).catch(() => {})

    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      'Retry-After',
      expect.any(String),
    )
  })

  it('sets RateLimit headers on allowed requests', async () => {
    await rateLimitMiddleware({ path: '/token' })

    expect(mockSetResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'RateLimit-Limit': '20',
        'RateLimit-Remaining': '19',
      }),
    )
  })

  it('passes through for non-limited paths', async () => {
    const result = await rateLimitMiddleware({ path: '/.well-known/openid-configuration' })

    expect(result).toBeUndefined()
    expect(mockSetResponseHeaders).not.toHaveBeenCalled()
  })

  it('matches sub-paths to their parent limit', async () => {
    await rateLimitMiddleware({ path: '/token/introspection' })

    expect(mockSetResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ 'RateLimit-Limit': '20' }),
    )
  })

  it('strips query strings before matching', async () => {
    await rateLimitMiddleware({ path: '/auth?client_id=abc' })

    expect(mockSetResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ 'RateLimit-Limit': '30' }),
    )
  })
})
