import Provider, { errors } from 'oidc-provider'
import {
  exportJWK,
  importPKCS8,
  importJWK,
  generateKeyPair,
  type JWKParameters,
} from 'jose'
import Redis from 'ioredis'
import { RedisAdapter } from './redis-adapter'
import { findAccount } from './find-account'

let provider: Provider | undefined

const JWKS_REDIS_KEY = 'oidc:server:jwks'

function decorateJWK(jwk: JWKParameters) {
  jwk.kid = 'key1'
  jwk.use = 'sig'
  jwk.alg = 'RS256'
}

async function buildJWKS(rsaPem: string, redisUrl: string) {
  if (rsaPem) {
    const privateKey = await importPKCS8(rsaPem, 'RS256')
    const jwk = await exportJWK(privateKey)
    decorateJWK(jwk)
    return { keys: [jwk] }
  }

  // Auto-generate RSA key, shared across workers via Redis
  const redis = new Redis(redisUrl)
  try {
    const existing = await redis.get(JWKS_REDIS_KEY)
    if (existing) {
      const jwk = JSON.parse(existing)
      // Verify the stored key is still usable
      await importJWK(jwk, 'RS256')
      return { keys: [jwk] }
    }

    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(privateKey)
    decorateJWK(jwk)
    await redis.set(JWKS_REDIS_KEY, JSON.stringify(jwk))
    return { keys: [jwk] }
  } finally {
    redis.disconnect()
  }
}

function parseCookieKeys(keys: string): string[] {
  if (!keys) {
    console.warn(
      'NUXT_OIDC_COOKIE_KEYS not set — using insecure default. Set this in production.',
    )
    return ['default-insecure-key']
  }
  return keys
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

export async function getProvider(): Promise<Provider> {
  if (provider) return provider

  const { oidc } = useRuntimeConfig()

  const jwks = await buildJWKS(oidc.rsaPem, oidc.redisUrl)
  const cookieKeys = parseCookieKeys(oidc.cookieKeys)

  provider = new Provider(oidc.baseUrl, {
    adapter: RedisAdapter,
    findAccount,
    jwks,

    cookies: {
      keys: cookieKeys,
      short: { path: '/' },
    },

    // Auto-approve grants — SIWE signature IS the user's consent
    async loadExistingGrant(ctx) {
      const grant = new ctx.oidc.provider.Grant({
        clientId: ctx.oidc.client!.clientId,
        accountId: ctx.oidc.session!.accountId,
      })
      grant.addOIDCScope(ctx.oidc.params!.scope as string)
      await grant.save()
      return grant
    },

    claims: {
      openid: ['sub'],
      profile: ['preferred_username', 'picture'],
    },

    features: {
      registration: {
        enabled: true,
        idFactory: () => crypto.randomUUID(),
        secretFactory: () => crypto.randomUUID(),
      },
      introspection: { enabled: true },
      revocation: { enabled: true },
      devInteractions: { enabled: false },
    },

    extraClientMetadata: {
      properties: ['_redirect_uri_policy'],
      validator(_ctx, _key, _value, metadata) {
        if (metadata.redirect_uris) {
          for (const uri of metadata.redirect_uris as string[]) {
            const parsed = new URL(uri)
            if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
              throw new errors.InvalidClientMetadata(
                'redirect_uris must use the https scheme',
              )
            }
          }
        }
      },
    },

    renderError(ctx, out, _error) {
      const params = new URLSearchParams({
        error: String(out.error || 'server_error'),
        error_description: String(out.error_description || 'An unexpected error occurred'),
      })
      ctx.redirect(`/error?${params}`)
    },

    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },

    ttl: {
      AuthorizationCode: 60,
      Session: 86_400,
      Interaction: 600,
      Grant: 86_400,
      AccessToken: 3600,
      IdToken: 3600,
    },

    clientDefaults: {
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: oidc.requireSecret
        ? 'client_secret_basic'
        : 'none',
    },
  })

  return provider
}

export async function seedDefaultClients(): Promise<void> {
  const { oidc } = useRuntimeConfig()
  let clients: Record<string, string>
  const raw = oidc.defaultClients
  if (!raw) return
  if (typeof raw === 'object') {
    clients = raw as Record<string, string>
  } else {
    try {
      clients = JSON.parse(raw)
    } catch {
      console.warn('Failed to parse NUXT_OIDC_DEFAULT_CLIENTS')
      return
    }
  }

  if (!Object.keys(clients).length) return

  const p = await getProvider()

  for (const [clientId, redirectUri] of Object.entries(clients)) {
    try {
      // Check if client already exists
      const existing = await p.Client.find(clientId)
      if (existing) continue

      // Seed via the adapter directly
      const adapter = new RedisAdapter('Client')
      await adapter.upsert(
        clientId,
        {
          client_id: clientId,
          client_secret: crypto.randomUUID(),
          redirect_uris: [redirectUri],
          post_logout_redirect_uris: [new URL('/', redirectUri).toString()],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: oidc.requireSecret
            ? 'client_secret_basic'
            : 'none',
        },
        0,
      )

      console.log(`Seeded default client: ${clientId}`)
    } catch (e) {
      console.error(`Failed to seed client ${clientId}:`, e)
    }
  }
}
