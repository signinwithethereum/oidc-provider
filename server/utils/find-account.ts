import type { Account, FindAccount } from 'oidc-provider'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import { resolveEnsName, resolveEnsAvatar } from './ens'
import { loadSiweProof } from './siwe-store'

/**
 * Account ID format: eip155:{chainId}:{checksumAddress}
 */
export function parseAccountId(accountId: string): {
  chainId: number
  address: Address
} {
  const parts = accountId.split(':')
  if (parts.length < 3) throw new Error('Invalid account ID: expected eip155:{chainId}:{address}')
  if (parts[0] !== 'eip155') throw new Error('Invalid account ID: expected eip155 prefix')
  const chainId = parseInt(parts[1]!, 10)
  if (Number.isNaN(chainId)) throw new Error('Invalid account ID: chain ID must be numeric')
  return {
    chainId,
    address: getAddress(parts[2]!),
  }
}

export const findAccount: FindAccount = async (_ctx, id, token): Promise<Account> => {
  const { address } = parseAccountId(id)
  const { oidc } = useRuntimeConfig()
  const ethProvider = oidc.ethProvider || undefined

  // Load SIWE proof from Redis if a token with grantId is available
  const grantId = token && 'grantId' in token ? (token as { grantId?: string }).grantId : undefined
  const siweProof = grantId ? await loadSiweProof(grantId) : null

  return {
    accountId: id,
    async claims() {
      const ensName = await resolveEnsName(address, ethProvider)
      const avatar = ensName
        ? await resolveEnsAvatar(ensName, ethProvider)
        : null

      return {
        sub: id,
        preferred_username: ensName || address,
        picture: avatar || undefined,
        ...(siweProof && {
          siwe_message: siweProof.message,
          siwe_signature: siweProof.signature,
        }),
      }
    },
  }
}
