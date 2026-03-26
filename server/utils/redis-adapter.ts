import Redis from 'ioredis'
import type { Adapter, AdapterPayload } from 'oidc-provider'

const PREFIX = 'oidc:'

let client: Redis | undefined

export function getClient(): Redis {
  if (!client) {
    const { oidc } = useRuntimeConfig()
    client = new Redis(oidc.redisUrl)
  }
  return client
}

function key(model: string, id: string): string {
  return `${PREFIX}${model}:${id}`
}

function grantKey(id: string): string {
  return `${PREFIX}grant:${id}`
}

function userCodeKey(userCode: string): string {
  return `${PREFIX}userCode:${userCode}`
}

function uidKey(uid: string): string {
  return `${PREFIX}uid:${uid}`
}

export class RedisAdapter implements Adapter {
  model: string

  constructor(model: string) {
    this.model = model
  }

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void> {
    const redis = getClient()
    const k = key(this.model, id)
    const data = JSON.stringify(payload)

    const multi = redis.multi()

    if (expiresIn) {
      multi.setex(k, expiresIn, data)
    } else {
      multi.set(k, data)
    }

    if (payload.grantId) {
      const gk = grantKey(payload.grantId)
      multi.sadd(gk, k)
      if (expiresIn) {
        multi.expire(gk, expiresIn)
      }
    }

    if (payload.userCode) {
      const uck = userCodeKey(payload.userCode)
      multi.set(uck, id)
      if (expiresIn) {
        multi.expire(uck, expiresIn)
      }
    }

    if (payload.uid) {
      const uk = uidKey(payload.uid)
      multi.set(uk, id)
      if (expiresIn) {
        multi.expire(uk, expiresIn)
      }
    }

    await multi.exec()
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const redis = getClient()
    const data = await redis.get(key(this.model, id))
    if (!data) return undefined
    return JSON.parse(data) as AdapterPayload
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const redis = getClient()
    const id = await redis.get(uidKey(uid))
    if (!id) return undefined
    return this.find(id)
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const redis = getClient()
    const id = await redis.get(userCodeKey(userCode))
    if (!id) return undefined
    return this.find(id)
  }

  async consume(id: string): Promise<void> {
    const redis = getClient()
    const k = key(this.model, id)
    const data = await redis.get(k)
    if (!data) return

    const payload = JSON.parse(data) as AdapterPayload
    payload.consumed = Math.floor(Date.now() / 1000)

    const ttl = await redis.ttl(k)
    if (ttl > 0) {
      await redis.setex(k, ttl, JSON.stringify(payload))
    } else {
      await redis.set(k, JSON.stringify(payload))
    }
  }

  async destroy(id: string): Promise<void> {
    const redis = getClient()
    await redis.del(key(this.model, id))
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    const redis = getClient()
    const gk = grantKey(grantId)
    const members = await redis.smembers(gk)
    if (members.length) {
      await redis.del(...members, gk)
    }
  }
}
