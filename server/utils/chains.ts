import { type Chain, createPublicClient, http } from 'viem'
import * as viemChains from 'viem/chains'

const chainById = new Map<number, Chain>(
  Object.values(viemChains).map((c) => [c.id, c]),
)

/** Resolve a viem Chain by EIP-155 chain ID. */
export function getChain(chainId: number): Chain {
  const chain = chainById.get(chainId)
  if (!chain) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown chain ID: ${chainId}`,
    })
  }
  return chain
}

/**
 * Resolve an RPC URL for a given chain ID from the ethProvider config.
 *
 * Accepts either a plain URL (used for mainnet only, for backward compat)
 * or a JSON object mapping chain IDs to URLs, e.g.:
 *   {"1":"https://mainnet.infura.io/…","42161":"https://arb1.arbitrum.io/rpc"}
 */
export function resolveRpcUrl(
  ethProvider: string,
  chainId: number,
): string | undefined {
  if (!ethProvider) return undefined
  try {
    const map = JSON.parse(ethProvider) as Record<string, string>
    return map[chainId] || map[String(chainId)] || undefined
  } catch {
    // Plain URL string — backward compat, use for mainnet only
    return chainId === 1 ? ethProvider : undefined
  }
}

/** Create a viem PublicClient for the given chain ID. */
export function createChainClient(ethProvider: string, chainId: number) {
  const chain = getChain(chainId)
  const rpcUrl = resolveRpcUrl(ethProvider, chainId)
  return createPublicClient({ chain, transport: http(rpcUrl) })
}
