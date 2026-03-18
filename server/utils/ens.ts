import { createPublicClient, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

function getPublicClient(ethProviderUrl?: string) {
  return createPublicClient({
    chain: mainnet,
    transport: http(ethProviderUrl || undefined),
  })
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
