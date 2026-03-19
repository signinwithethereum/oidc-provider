import Provider from 'oidc-provider'
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

    routes: {
      authorization: '/authorize',
      jwks: '/jwk',
      registration: '/register',
    },

    cookies: {
      keys: cookieKeys,
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
      devInteractions: { enabled: false },
    },

    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },

    ttl: {
      AuthorizationCode: 30,
      Session: 300,
      Interaction: 300,
      Grant: 300,
      AccessToken: 30,
      IdToken: 60,
    },

    pkce: {
      required: () => false,
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
  try {
    clients = JSON.parse(oidc.defaultClients || '{}')
  } catch {
    console.warn('Failed to parse NUXT_OIDC_DEFAULT_CLIENTS')
    return
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
