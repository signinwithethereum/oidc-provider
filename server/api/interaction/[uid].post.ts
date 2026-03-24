import { getProvider } from '../../utils/provider'
import {
  SiweMessage,
  SiweError,
  createViemConfig,
} from '@signinwithethereum/siwe'
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
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid SIWE message',
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
  // wallets like Safe), and EIP-6492 (pre-deployed ERC-4337 accounts).
  // verify() throws SiweError directly (4.1.0+) on failure.
  const { oidc } = useRuntimeConfig()
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(oidc.ethProvider || undefined),
  })
  const config = await createViemConfig({ publicClient })

  let accountId: string
  try {
    const { data } = await siweMessage.verify(
      {
        signature,
        domain: new URL(oidc.baseUrl).host,
        nonce: siweMessage.nonce,
      },
      { config },
    )
    accountId = `eip155:${data.chainId}:${config.getAddress(data.address)}`
  } catch (e) {
    if (e instanceof SiweError) {
      throw createError({ statusCode: 400, statusMessage: e.message })
    }
    throw e
  }

  // Complete the interaction — provider stores the result and returns the
  // redirect URL as JSON so the client can navigate via full page load,
  // avoiding cross-origin fetch redirect CORS issues.
  const redirectTo = await provider.interactionResult(req, res, {
    login: { accountId },
  })

  return { redirectTo }
})
