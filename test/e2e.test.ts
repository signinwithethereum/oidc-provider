import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { importJWK, jwtVerify } from 'jose'

// Test wallet — Hardhat/Anvil account #0
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(TEST_PRIVATE_KEY)

// Expects a running server + Redis: `npm run dev`
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'

const serverAvailable = await fetch(BASE, {
  signal: AbortSignal.timeout(2000),
})
  .then(() => true)
  .catch(() => false)

if (!serverAvailable) {
  console.warn(
    '\n⚠  Skipping e2e tests — local server is not running.\n' +
      '   Start it with: pnpm dev\n',
  )
}

function apiUrl(path: string): string {
  return path.startsWith('http') ? path : `${BASE}${path}`
}

function createSiweMessage(params: {
  domain: string
  address: string
  uri: string
  chainId: number
  nonce: string
  statement?: string
}): string {
  const lines = [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
  ]
  if (params.statement) lines.push(params.statement, '')
  lines.push(
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  )
  return lines.join('\n')
}

/** Collect Set-Cookie headers as a semicolon-joined string. */
function extractCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

/** Merge multiple cookie strings, deduplicating by name (last wins). */
function mergeCookies(...parts: string[]): string {
  const map = new Map<string, string>()
  for (const part of parts) {
    for (const kv of part.split('; ').filter(Boolean)) {
      const name = kv.split('=')[0]!
      map.set(name, kv)
    }
  }
  return [...map.values()].join('; ')
}

describe.skipIf(!serverAvailable)('siwe-oidc', () => {
  describe('discovery', () => {
    it('serves OpenID configuration', async () => {
      const res = await fetch(apiUrl('/.well-known/openid-configuration'))
      expect(res.status).toBe(200)
      const config = await res.json()
      expect(config).toHaveProperty('issuer')
      expect(config).toHaveProperty('authorization_endpoint')
      expect(config).toHaveProperty('token_endpoint')
      expect(config).toHaveProperty('jwks_uri')
      expect(config).toHaveProperty('registration_endpoint')
      expect(config).toHaveProperty('userinfo_endpoint')
      expect(config.scopes_supported).toContain('openid')
      expect(config.response_types_supported).toContain('code')
    })

    it('serves JWKS', async () => {
      const res = await fetch(apiUrl('/jwk'))
      expect(res.status).toBe(200)
      const jwks = await res.json()
      expect(jwks).toHaveProperty('keys')
      expect(jwks.keys.length).toBeGreaterThan(0)
      expect(jwks.keys[0]).toHaveProperty('kty', 'RSA')
      expect(jwks.keys[0]).toHaveProperty('kid', 'key1')
    })
  })

  describe('client registration', () => {
    it('registers a new client', async () => {
      const res = await fetch(apiUrl('/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['https://example.com/callback'],
          application_type: 'web',
        }),
      })
      expect(res.status).toBe(201)
      const client = await res.json()
      expect(client).toHaveProperty('client_id')
      expect(client).toHaveProperty('client_secret')
      expect(client.redirect_uris).toContain('https://example.com/callback')
    })
  })

  describe('full auth flow', () => {
    it('completes SIWE login and issues tokens', async () => {
      // 1. Register client
      const client = await fetch(apiUrl('/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['https://example.com/callback'],
          token_endpoint_auth_method: 'none',
        }),
      }).then((r) => r.json())

      // 2. Start auth flow — provider 303s to /interaction/{uid}
      const authUrl = new URL('/authorize', BASE)
      authUrl.searchParams.set('client_id', client.client_id)
      authUrl.searchParams.set('redirect_uri', 'https://example.com/callback')
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid profile')
      authUrl.searchParams.set('state', 'teststate')

      const authRes = await fetch(authUrl, { redirect: 'manual' })
      expect(authRes.status).toBe(303)
      const interactionUrl = authRes.headers.get('location')!
      expect(interactionUrl).toMatch(/\/interaction\//)

      let cookies = extractCookies(authRes)
      const uid = interactionUrl.split('/interaction/')[1]!.split('?')[0]!

      // 3. Fetch interaction details (also updates cookies)
      const detailsRes = await fetch(apiUrl(`/api/interaction/${uid}`), {
        headers: { cookie: cookies },
      })
      expect(detailsRes.status).toBe(200)
      cookies = mergeCookies(cookies, extractCookies(detailsRes))
      const details = await detailsRes.json()
      expect(details.uid).toBe(uid)
      expect(details.params.client_id).toBe(client.client_id)
      expect(details.params.scope).toBe('openid profile')

      // 4. Create and sign SIWE message
      const message = createSiweMessage({
        domain: new URL(BASE).host,
        address: account.address,
        uri: BASE,
        chainId: 1,
        nonce: uid,
        statement: 'Sign-In with Ethereum',
      })
      const signature = await account.signMessage({ message })

      // 5. POST verification — provider writes 303 directly
      const verifyRes = await fetch(apiUrl(`/api/interaction/${uid}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: cookies,
        },
        body: JSON.stringify({ message, signature }),
        redirect: 'manual',
      })

      expect(
        verifyRes.status,
        `verify failed: ${await verifyRes.clone().text()}`,
      ).toSatisfy((s: number) => [302, 303].includes(s))

      // 6. Follow redirect chain until we reach the client callback
      cookies = mergeCookies(cookies, extractCookies(verifyRes))
      let location = verifyRes.headers.get('location')!

      for (let i = 0; i < 5; i++) {
        if (location.startsWith('https://example.com')) break
        const res = await fetch(apiUrl(location), {
          headers: { cookie: cookies },
          redirect: 'manual',
        })
        cookies = mergeCookies(cookies, extractCookies(res))
        const next = res.headers.get('location')
        if (!next)
          throw new Error(
            `Redirect chain broke at hop ${i}: status=${res.status}`,
          )
        location = next
      }

      const callbackUrl = new URL(location)
      const code = callbackUrl.searchParams.get('code')
      expect(code).toBeTruthy()
      expect(callbackUrl.searchParams.get('state')).toBe('teststate')

      // 7. Exchange code for tokens
      const tokenRes = await fetch(apiUrl('/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: 'https://example.com/callback',
          client_id: client.client_id,
        }),
      })
      expect(tokenRes.status).toBe(200)
      const tokens = await tokenRes.json()
      expect(tokens).toHaveProperty('access_token')
      expect(tokens).toHaveProperty('id_token')
      expect(tokens.token_type).toBe('Bearer')

      // 8. Verify id_token signature against the JWKS and check claims
      const jwksData = await fetch(apiUrl('/jwk')).then((r) => r.json())
      const pubKey = await importJWK(jwksData.keys[0], 'RS256')
      const { payload: claims } = await jwtVerify(tokens.id_token, pubKey, {
        issuer: BASE,
        audience: client.client_id,
      })
      expect(claims.sub).toMatch(/^eip155:1:0x/)
      expect(claims.sub).toContain(account.address)
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
      expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))

      // 9. Verify userinfo endpoint
      const userinfoRes = await fetch(apiUrl('/me'), {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      expect(userinfoRes.status).toBe(200)
      const userinfo = await userinfoRes.json()
      expect(userinfo.sub).toBe(claims.sub)
      expect(userinfo.preferred_username).toBe(account.address)
    })
  })

  describe('rejection cases', () => {
    /** Set up an interaction and return the uid + cookies. */
    async function startInteraction() {
      const client = await fetch(apiUrl('/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: ['https://example.com/callback'],
          token_endpoint_auth_method: 'none',
        }),
      }).then((r) => r.json())

      const authUrl = new URL('/authorize', BASE)
      authUrl.searchParams.set('client_id', client.client_id)
      authUrl.searchParams.set('redirect_uri', 'https://example.com/callback')
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid')

      const authRes = await fetch(authUrl, { redirect: 'manual' })
      const interactionUrl = authRes.headers.get('location')!
      let cookies = extractCookies(authRes)
      const uid = interactionUrl.split('/interaction/')[1]!.split('?')[0]!

      const detailsRes = await fetch(apiUrl(`/api/interaction/${uid}`), {
        headers: { cookie: cookies },
      })
      cookies = mergeCookies(cookies, extractCookies(detailsRes))
      return { uid, cookies }
    }

    it('rejects missing message or signature', async () => {
      const { uid, cookies } = await startInteraction()

      const res = await fetch(apiUrl(`/api/interaction/${uid}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookies },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.statusMessage).toMatch(/Missing message or signature/)
    })

    it('rejects wrong nonce', async () => {
      const { uid, cookies } = await startInteraction()

      const message = createSiweMessage({
        domain: new URL(BASE).host,
        address: account.address,
        uri: BASE,
        chainId: 1,
        nonce: 'totally-wrong-nonce',
      })
      const signature = await account.signMessage({ message })

      const res = await fetch(apiUrl(`/api/interaction/${uid}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookies },
        body: JSON.stringify({ message, signature }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.statusMessage).toMatch(/Nonce mismatch/)
    })

    it('rejects invalid signature', async () => {
      const { uid, cookies } = await startInteraction()

      const message = createSiweMessage({
        domain: new URL(BASE).host,
        address: account.address,
        uri: BASE,
        chainId: 1,
        nonce: uid,
      })
      const badSig = '0x' + 'ab'.repeat(65) // garbage 65-byte signature

      const res = await fetch(apiUrl(`/api/interaction/${uid}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookies },
        body: JSON.stringify({ message, signature: badSig }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.statusMessage).toMatch(/Invalid SIWE signature/)
    })

    it('rejects interaction without cookies', async () => {
      const { uid } = await startInteraction()

      const res = await fetch(apiUrl(`/api/interaction/${uid}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x', signature: '0x' }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.statusMessage).toMatch(/Invalid interaction session/)
    })
  })
})
