import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

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
  try {
    const client = getPublicClient(ethProviderUrl)
    return await client.getEnsName({ address })
  } catch (e) {
    console.error('Failed to resolve ENS name:', e)
    return null
  }
}

export async function resolveEnsAvatar(
  ensName: string,
  ethProviderUrl?: string,
): Promise<string | null> {
  try {
    const client = getPublicClient(ethProviderUrl)
    return await client.getEnsAvatar({ name: normalize(ensName) })
  } catch (e) {
    console.error('Failed to resolve ENS avatar:', e)
    return null
  }
}
