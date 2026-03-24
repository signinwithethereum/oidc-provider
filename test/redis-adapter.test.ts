import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Redis from 'ioredis'

const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379'

// Stub Nuxt's useRuntimeConfig (auto-imported in server code)
vi.stubGlobal('useRuntimeConfig', () => ({
  oidc: { redisUrl: REDIS_URL },
}))

const { RedisAdapter } = await import('../server/utils/redis-adapter')

let redis: Redis

const redisAvailable = await new Redis(REDIS_URL)
  .ping()
  .then(() => true)
  .catch(() => false)

if (!redisAvailable) {
  console.warn(
    '\n⚠  Skipping Redis adapter tests — Redis is not running.\n' +
      '   Start it with: docker compose up redis\n',
  )
}

describe.skipIf(!redisAvailable)('RedisAdapter', () => {
  beforeAll(() => {
    redis = new Redis(REDIS_URL)
  })

  afterAll(async () => {
    await redis.quit()
  })

  beforeEach(async () => {
    // Clean all oidc: keys between tests
    const keys = await redis.keys('oidc:*')
    if (keys.length) await redis.del(...keys)
  })

  describe('upsert & find', () => {
    it('stores and retrieves a payload', async () => {
      const adapter = new RedisAdapter('TestModel')
      const payload = { accountId: 'test-account', kind: 'TestModel' }

      await adapter.upsert('id1', payload, 60)
      const found = await adapter.find('id1')

      expect(found).toEqual(payload)
    })

    it('returns undefined for missing id', async () => {
      const adapter = new RedisAdapter('TestModel')
      const found = await adapter.find('nonexistent')
      expect(found).toBeUndefined()
    })

    it('stores without expiry when expiresIn is 0', async () => {
      const adapter = new RedisAdapter('TestModel')
      await adapter.upsert('no-ttl', { kind: 'TestModel' }, 0)

      const ttl = await redis.ttl('oidc:TestModel:no-ttl')
      expect(ttl).toBe(-1) // no expiry
    })

    it('sets TTL when expiresIn > 0', async () => {
      const adapter = new RedisAdapter('TestModel')
      await adapter.upsert('with-ttl', { kind: 'TestModel' }, 120)

      const ttl = await redis.ttl('oidc:TestModel:with-ttl')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(120)
    })
  })

  describe('findByUid', () => {
    it('finds payload by uid', async () => {
      const adapter = new RedisAdapter('Interaction')
      const payload = { uid: 'uid-123', kind: 'Interaction' }

      await adapter.upsert('int-id', payload, 60)
      const found = await adapter.findByUid('uid-123')

      expect(found).toEqual(payload)
    })

    it('returns undefined for unknown uid', async () => {
      const adapter = new RedisAdapter('Interaction')
      const found = await adapter.findByUid('unknown-uid')
      expect(found).toBeUndefined()
    })
  })

  describe('findByUserCode', () => {
    it('finds payload by userCode', async () => {
      const adapter = new RedisAdapter('DeviceCode')
      const payload = { userCode: 'ABCD-1234', kind: 'DeviceCode' }

      await adapter.upsert('dc-id', payload, 60)
      const found = await adapter.findByUserCode('ABCD-1234')

      expect(found).toEqual(payload)
    })

    it('returns undefined for unknown userCode', async () => {
      const adapter = new RedisAdapter('DeviceCode')
      const found = await adapter.findByUserCode('UNKNOWN')
      expect(found).toBeUndefined()
    })
  })

  describe('consume', () => {
    it('marks payload as consumed with timestamp', async () => {
      const adapter = new RedisAdapter('AuthorizationCode')
      await adapter.upsert('code1', { kind: 'AuthorizationCode' }, 60)

      const before = Math.floor(Date.now() / 1000)
      await adapter.consume('code1')
      const after = Math.floor(Date.now() / 1000)

      const found = await adapter.find('code1')
      expect(found?.consumed).toBeGreaterThanOrEqual(before)
      expect(found?.consumed).toBeLessThanOrEqual(after)
    })

    it('preserves existing TTL after consume', async () => {
      const adapter = new RedisAdapter('AuthorizationCode')
      await adapter.upsert('code2', { kind: 'AuthorizationCode' }, 120)

      await adapter.consume('code2')

      const ttl = await redis.ttl('oidc:AuthorizationCode:code2')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(120)
    })

    it('is a no-op for missing id', async () => {
      const adapter = new RedisAdapter('AuthorizationCode')
      // Should not throw
      await adapter.consume('nonexistent')
    })
  })

  describe('destroy', () => {
    it('removes a stored payload', async () => {
      const adapter = new RedisAdapter('Session')
      await adapter.upsert('sess1', { kind: 'Session' }, 60)

      await adapter.destroy('sess1')
      const found = await adapter.find('sess1')

      expect(found).toBeUndefined()
    })

    it('is a no-op for missing id', async () => {
      const adapter = new RedisAdapter('Session')
      await adapter.destroy('nonexistent')
    })
  })

  describe('revokeByGrantId', () => {
    it('removes all tokens associated with a grant', async () => {
      const adapter = new RedisAdapter('AccessToken')
      const grantId = 'grant-abc'

      await adapter.upsert('at1', { grantId, kind: 'AccessToken' }, 60)
      await adapter.upsert('at2', { grantId, kind: 'AccessToken' }, 60)

      await adapter.revokeByGrantId(grantId)

      expect(await adapter.find('at1')).toBeUndefined()
      expect(await adapter.find('at2')).toBeUndefined()

      // Grant set itself should be removed
      const members = await redis.smembers(`oidc:grant:${grantId}`)
      expect(members).toHaveLength(0)
    })

    it('is a no-op for unknown grantId', async () => {
      const adapter = new RedisAdapter('AccessToken')
      await adapter.revokeByGrantId('unknown-grant')
    })
  })

  describe('overwrite', () => {
    it('overwrites existing payload on re-upsert', async () => {
      const adapter = new RedisAdapter('Client')
      await adapter.upsert('c1', { client_id: 'c1', scope: 'openid' }, 0)
      await adapter.upsert('c1', { client_id: 'c1', scope: 'openid profile' }, 0)

      const found = await adapter.find('c1')
      expect(found?.scope).toBe('openid profile')
    })
  })
})
