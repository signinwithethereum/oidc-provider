import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

const ENS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const ensNameCache = new Map<string, CacheEntry<string | null>>()
const ensAvatarCache = new Map<string, CacheEntry<string | null>>()

export function clearEnsCache(): void {
  ensNameCache.clear()
  ensAvatarCache.clear()
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + ENS_CACHE_TTL })
}

let cachedClient: PublicClient | undefined
let cachedUrl: string | undefined

function getPublicClient(ethProviderUrl?: string): PublicClient {
  if (cachedClient && cachedUrl === ethProviderUrl) return cachedClient

  cachedClient = createPublicClient({
    chain: mainnet,
    transport: http(ethProviderUrl || undefined),
  })
  cachedUrl = ethProviderUrl

  return cachedClient
}

export async function resolveEnsName(
  address: Address,
  ethProviderUrl?: string,
): Promise<string | null> {
  const cached = getCached(ensNameCache, address)
  if (cached !== undefined) return cached

  try {
    const client = getPublicClient(ethProviderUrl)
    const name = await client.getEnsName({ address })
    setCached(ensNameCache, address, name)
    return name
  } catch (e) {
    console.error('Failed to resolve ENS name:', e)
    return null
  }
}

export async function resolveEnsAvatar(
  ensName: string,
  ethProviderUrl?: string,
): Promise<string | null> {
  const cached = getCached(ensAvatarCache, ensName)
  if (cached !== undefined) return cached

  try {
    const client = getPublicClient(ethProviderUrl)
    const avatar = await client.getEnsAvatar({ name: normalize(ensName) })
    setCached(ensAvatarCache, ensName, avatar)
    return avatar
  } catch (e) {
    console.error('Failed to resolve ENS avatar:', e)
    return null
  }
}
