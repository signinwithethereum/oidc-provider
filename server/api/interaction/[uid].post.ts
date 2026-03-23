import { getProvider } from '../../utils/provider'
import { getAddress, isAddress } from 'viem'
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

  // We parse SIWE fields manually instead of using viem's parseSiweMessage
  // because oidc-provider generates interaction UIDs with dashes and
  // underscores. EIP-4361 defines nonce as alpha-numeric only, so viem's
  // parser rejects these UIDs. The signature itself is still verified via
  // viem's verifySiweMessage which doesn't enforce the nonce charset.
  const nonce = siweField(message, 'Nonce')
  const address = siweAddress(message)
  const chainIdStr = siweField(message, 'Chain ID')

  if (!address) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SIWE message missing address',
    })
  }

  if (!isAddress(address)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SIWE message contains invalid Ethereum address',
    })
  }

  // Validate nonce matches the interaction uid
  if (nonce !== details.uid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nonce mismatch',
    })
  }

  // Validate the first Resources entry matches the OIDC redirect_uri
  const redirectUri = details.params.redirect_uri as string | undefined
  const resourcesMatch = message.match(/^Resources:\n- (.+)$/m)
  const firstResource = resourcesMatch?.[1]
  if (!firstResource) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing resource in SIWE message',
    })
  }
  if (firstResource !== redirectUri) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SIWE resource does not match redirect_uri',
    })
  }

  // Verify the SIWE signature + domain binding against the provider's issuer
  const { oidc } = useRuntimeConfig()
  const client = createPublicClient({
    chain: mainnet,
    transport: http(oidc.ethProvider || undefined),
  })

  const valid = await client.verifySiweMessage({
    message,
    signature,
    domain: new URL(oidc.baseUrl).host,
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

  // Complete the interaction — return redirect URL for the client to navigate to
  const redirectTo = await provider.interactionResult(req, res, {
    login: { accountId },
  })

  return { redirectTo }
})
