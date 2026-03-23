import { getProvider } from '../../utils/provider'
import { getAddress, isAddress, createPublicClient, http } from 'viem'
import { parseSiweMessage } from 'viem/siwe'
import { mainnet } from 'viem/chains'

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

  // Parse the SIWE message with viem. The nonce is the hex-encoded
  // interaction UID — oidc-provider UIDs contain dashes/underscores which
  // violate EIP-4361's alphanumeric-only nonce rule, so we hex-encode to
  // stay spec-compliant.
  const parsed = parseSiweMessage(message)

  if (!parsed.address) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SIWE message missing address',
    })
  }

  if (!isAddress(parsed.address)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SIWE message contains invalid Ethereum address',
    })
  }

  // Decode the hex nonce back to the interaction UID and compare
  const decodedNonce = Buffer.from(parsed.nonce ?? '', 'hex').toString()
  if (decodedNonce !== details.uid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nonce mismatch',
    })
  }

  // Validate the first Resources entry matches the OIDC redirect_uri
  const redirectUri = details.params.redirect_uri as string | undefined
  const firstResource = parsed.resources?.[0]
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
  const checksumAddress = getAddress(parsed.address)
  const chainId = parsed.chainId ?? 1
  const accountId = `eip155:${chainId}:${checksumAddress}`

  // Complete the interaction — return redirect URL for the client to navigate to
  const redirectTo = await provider.interactionResult(req, res, {
    login: { accountId },
  })

  return { redirectTo }
})
