import { getProvider } from '../../utils/provider'
import { getAddress } from 'viem'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

/** Extract a field value from a raw EIP-4361 SIWE message string. */
function siweField(message: string, field: string): string | undefined {
  const match = message.match(new RegExp(`${field}: (.+)`))
  return match?.[1]
}

/** Extract the address (line 2) from a SIWE message. */
function siweAddress(message: string): string | undefined {
  return message.split('\n')[1]
}

export default defineEventHandler(async (event) => {
  const provider = await getProvider()
  const {
    node: { req, res },
  } = event

  // Get interaction details — validates the session cookie
  let details
  try {
    details = await provider.interactionDetails(req, res)
  } catch (e) {
    console.error('interactionDetails failed:', e)
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid interaction session',
    })
  }

  const body = await readBody(event)
  const { message, signature } = body
  if (!message || !signature) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing message or signature',
    })
  }

  // Extract fields from the raw SIWE message
  // We parse manually because oidc-provider interaction uids contain
  // non-alphanumeric chars (-, _) which viem's parseSiweMessage rejects
  // per strict EIP-4361 nonce validation.
  const nonce = siweField(message, 'Nonce')
  const address = siweAddress(message)
  const chainIdStr = siweField(message, 'Chain ID')

  if (!address) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SIWE message missing address',
    })
  }

  // Validate nonce matches the interaction uid
  if (nonce !== details.uid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nonce mismatch',
    })
  }

  // Verify the SIWE signature (supports EOA + EIP-1271 smart wallets)
  const { oidc } = useRuntimeConfig()
  const client = createPublicClient({
    chain: mainnet,
    transport: http(oidc.ethProvider || undefined),
  })

  const valid = await client.verifySiweMessage({
    message,
    signature,
  })

  if (!valid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid SIWE signature',
    })
  }

  // Build account ID: eip155:{chainId}:{checksumAddress}
  const checksumAddress = getAddress(address)
  const chainId = chainIdStr ? parseInt(chainIdStr, 10) : 1
  const accountId = `eip155:${chainId}:${checksumAddress}`

  // Complete the interaction — provider writes the 302 response directly
  await provider.interactionFinished(req, res, {
    login: { accountId },
  })
})
