import { getProvider } from '../../utils/provider'
import { SiweMessage, createViemConfig } from '@signinwithethereum/siwe'
import { createPublicClient, http } from 'viem'
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

  // ABNF-strict parse — the nonce is the hex-encoded interaction UID.
  // oidc-provider UIDs contain dashes/underscores which violate EIP-4361's
  // alphanumeric-only nonce rule, so we hex-encode to stay spec-compliant.
  let siweMessage: SiweMessage
  try {
    siweMessage = new SiweMessage(message)
  } catch {
    // Distinguish missing vs malformed address by inspecting the raw line
    const rawAddress = message.split('\n')[1]?.trim()
    if (!rawAddress) {
      throw createError({
        statusCode: 400,
        statusMessage: 'SIWE message missing address',
      })
    }
    throw createError({
      statusCode: 400,
      statusMessage: 'SIWE message contains invalid Ethereum address',
    })
  }

  // Decode the hex nonce back to the interaction UID and compare
  const decodedNonce = Buffer.from(siweMessage.nonce, 'hex').toString()
  if (decodedNonce !== details.uid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nonce mismatch',
    })
  }

  // Validate the first Resources entry matches the OIDC redirect_uri
  const redirectUri = details.params.redirect_uri as string | undefined
  const firstResource = siweMessage.resources?.[0]
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

  // Verify signature + domain binding — supports EOA, EIP-1271 (contract
  // wallets like Safe), and EIP-6492 (pre-deployed ERC-4337 accounts)
  const { oidc } = useRuntimeConfig()
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(oidc.ethProvider || undefined),
  })
  const config = await createViemConfig({ publicClient })

  const { success, data, error } = await siweMessage.verify(
    {
      signature,
      domain: new URL(oidc.baseUrl).host,
      nonce: siweMessage.nonce,
    },
    { config, suppressExceptions: true },
  )

  if (!success) {
    const statusMessage =
      error instanceof Error ? error.message : (error?.type ?? 'Invalid SIWE signature')
    throw createError({ statusCode: 400, statusMessage })
  }

  // Build account ID: eip155:{chainId}:{checksumAddress}
  const accountId = `eip155:${data.chainId}:${config.getAddress(data.address)}`

  // Complete the interaction — provider stores the result and returns the
  // redirect URL. We redirect via h3 because interactionResult doesn't
  // write the redirect when the response is wrapped by Nitro/h3.
  const redirectTo = await provider.interactionResult(req, res, {
    login: { accountId },
  })

  return sendRedirect(event, redirectTo, 303)
})
