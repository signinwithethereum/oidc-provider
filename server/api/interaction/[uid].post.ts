import { getProvider } from '../../utils/provider'
import { getAddress } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

export default defineEventHandler(async (event) => {
  const provider = await getProvider()
  const { node: { req, res } } = event
  const body = await readBody(event)

  const { message, signature } = body
  if (!message || !signature) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing message or signature',
    })
  }

  // Get interaction details to validate nonce
  let details
  try {
    details = await provider.interactionDetails(req, res)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid interaction session',
    })
  }

  // Parse the SIWE message
  const siweMessage = parseSiweMessage(message)

  // Validate nonce matches the interaction uid
  if (siweMessage.nonce !== details.uid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nonce mismatch',
    })
  }

  // Verify the SIWE signature (supports EOA + EIP-1271 smart wallets)
  const client = createPublicClient({
    chain: mainnet,
    transport: http(),
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

  // Validate SIWE message fields
  const isValid = validateSiweMessage({
    message: siweMessage,
  })

  if (!isValid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid SIWE message',
    })
  }

  // Build account ID: eip155:{chainId}:{checksumAddress}
  const checksumAddress = getAddress(siweMessage.address!)
  const chainId = siweMessage.chainId || 1
  const accountId = `eip155:${chainId}:${checksumAddress}`

  // Complete the interaction — provider writes the 302 response directly
  await provider.interactionFinished(req, res, {
    login: { accountId },
  })

  // Do not return anything — the provider has already written the response
})
