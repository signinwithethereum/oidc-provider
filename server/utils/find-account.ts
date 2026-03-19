import type { Account, FindAccount } from 'oidc-provider'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import { resolveEnsName, resolveEnsAvatar } from './ens'

/**
 * Account ID format: eip155:{chainId}:{checksumAddress}
 */
export function parseAccountId(accountId: string): {
  chainId: number
  address: Address
} {
  const parts = accountId.split(':')
  return {
    chainId: parseInt(parts[1]!, 10),
    address: getAddress(parts[2]!),
  }
}

export const findAccount: FindAccount = async (_ctx, id): Promise<Account> => {
  const { address } = parseAccountId(id)
  const { oidc } = useRuntimeConfig()
  const ethProvider = oidc.ethProvider || undefined

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
      }
    },
  }
}
