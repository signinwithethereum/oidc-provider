import { getClient } from './redis-adapter'

// Atomic increment-and-expire: sets TTL only on first request in the window.
const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  reset: number
}

export async function checkRateLimit(
  identity: string,
  endpoint: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getClient()
  const redisKey = `rl:${identity}:${endpoint}`

  try {
    const current = (await redis.eval(
      INCREMENT_SCRIPT,
      1,
      redisKey,
      windowSeconds,
    )) as number
    const ttl = await redis.ttl(redisKey)

    return {
      allowed: current <= limit,
      limit,
      remaining: Math.max(0, limit - current),
      reset: ttl > 0 ? ttl : windowSeconds,
    }
  } catch {
    // Fail open — allow the request if Redis is unavailable
    return { allowed: true, limit, remaining: limit, reset: windowSeconds }
  }
}
