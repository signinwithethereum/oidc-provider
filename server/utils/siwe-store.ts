import { getClient } from './redis-adapter'

const SIWE_KEY_PREFIX = 'oidc:siwe:'
const SIWE_TTL = 3600

interface SiweProof {
  message: string
  signature: string
}

export async function storeSiweProof(grantId: string, data: SiweProof): Promise<void> {
  const redis = getClient()
  await redis.setex(`${SIWE_KEY_PREFIX}${grantId}`, SIWE_TTL, JSON.stringify(data))
}

export async function loadSiweProof(grantId: string): Promise<SiweProof | null> {
  const redis = getClient()
  const raw = await redis.get(`${SIWE_KEY_PREFIX}${grantId}`)
  return raw ? JSON.parse(raw) : null
}
