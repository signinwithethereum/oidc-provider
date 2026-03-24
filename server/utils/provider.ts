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

  // Auto-generate RSA key, shared across workers via Redis.
  // Uses SET NX to avoid a race where concurrent workers each
  // generate a key and the last write silently wins.
  const redis = new Redis(redisUrl)
  try {
    const existing = await redis.get(JWKS_REDIS_KEY)
    if (existing) {
      const jwk = JSON.parse(existing)
      await importJWK(jwk, 'RS256')
      return { keys: [jwk] }
    }

    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(privateKey)
    decorateJWK(jwk)

    // Atomically set only if no key exists yet — loses the race gracefully.
    const written = await redis.set(JWKS_REDIS_KEY, JSON.stringify(jwk), 'NX')
    if (written) {
      return { keys: [jwk] }
    }

    // Another worker won — use their key.
    const winner = await redis.get(JWKS_REDIS_KEY)
    const winnerJwk = JSON.parse(winner!)
    await importJWK(winnerJwk, 'RS256')
    return { keys: [winnerJwk] }
  } finally {
    redis.disconnect()
  }
}

function parseCookieKeys(keys: string): string[] {
  const parsed = keys
    ? keys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : []

  if (!parsed.length) {
    throw new Error(
      'NUXT_OIDC_COOKIE_KEYS is not set. Provide at least one signing key via the NUXT_OIDC_COOKIE_KEYS environment variable.',
    )
  }

  return parsed
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

    // Auto-approve grants — SIWE signature IS the user's consent.
    // Only grant scopes we actually support (openid, profile).
    async loadExistingGrant(ctx) {
      const SUPPORTED_SCOPES = new Set(['openid', 'profile'])
      const requested = (ctx.oidc.params!.scope as string || '').split(' ').filter(Boolean)
      const granted = requested.filter((s) => SUPPORTED_SCOPES.has(s)).join(' ')

      const grant = new ctx.oidc.provider.Grant({
        clientId: ctx.oidc.client!.clientId,
        accountId: ctx.oidc.session!.accountId,
      })
      grant.addOIDCScope(granted)
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
      rpInitiatedLogout: {
        enabled: true,
        logoutSource(ctx, form) {
          // Extract xsrf and action from the form HTML
          const xsrf = form.match(/name="xsrf" value="([^"]+)"/)?.[1] || ''
          const action = form.match(/action="([^"]+)"/)?.[1] || ''
          const params = new URLSearchParams({ xsrf, action })
          ctx.redirect(`/logout?${params}`)
        },
        postLogoutSuccessSource(ctx) {
          ctx.redirect('/logout/success')
        },
      },
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

interface DefaultClientConfig {
  redirect_uri: string
  client_name?: string
  logo_uri?: string
  client_uri?: string
  policy_uri?: string
  tos_uri?: string
}

export async function seedDefaultClients(): Promise<void> {
  const { oidc } = useRuntimeConfig()
  let clients: Record<string, string | DefaultClientConfig>
  const raw = oidc.defaultClients
  if (!raw) return
  if (typeof raw === 'object') {
    clients = raw as Record<string, string | DefaultClientConfig>
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

  for (const [clientId, value] of Object.entries(clients)) {
    try {
      // Support both simple string (redirect_uri) and rich object
      const config: DefaultClientConfig =
        typeof value === 'string' ? { redirect_uri: value } : value

      // Preserve existing client_secret if client already exists
      const existing = await p.Client.find(clientId)
      const clientSecret = existing?.metadata().client_secret || crypto.randomUUID()

      // Upsert via the adapter (always update to pick up metadata changes)
      const adapter = new RedisAdapter('Client')
      await adapter.upsert(
        clientId,
        {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uris: [config.redirect_uri],
          post_logout_redirect_uris: [new URL('/', config.redirect_uri).toString()],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: oidc.requireSecret
            ? 'client_secret_basic'
            : 'none',
          ...(config.client_name && { client_name: config.client_name }),
          ...(config.logo_uri && { logo_uri: config.logo_uri }),
          ...(config.client_uri && { client_uri: config.client_uri }),
          ...(config.policy_uri && { policy_uri: config.policy_uri }),
          ...(config.tos_uri && { tos_uri: config.tos_uri }),
        },
        0,
      )

      console.log(`Seeded default client: ${clientId}`)
    } catch (e) {
      console.error(`Failed to seed client ${clientId}:`, e)
    }
  }
}
