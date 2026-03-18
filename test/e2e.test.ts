import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from '@1001-digital/components.evm'

// Test wallet — deterministic key for reproducible tests
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(TEST_PRIVATE_KEY)

describe('siwe-oidc', async () => {
  await setup({ host: 'http://localhost:3000' })

  describe('discovery', () => {
    it('serves OpenID configuration', async () => {
      const config = await $fetch('/.well-known/openid-configuration')
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
      const jwks = await $fetch('/jwks')
      expect(jwks).toHaveProperty('keys')
      expect(jwks.keys.length).toBeGreaterThan(0)
      expect(jwks.keys[0]).toHaveProperty('kty', 'RSA')
      expect(jwks.keys[0]).toHaveProperty('kid', 'key1')
    })
  })

  describe('client registration', () => {
    it('registers a new client', async () => {
      const res = await $fetch('/reg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          redirect_uris: ['https://example.com/callback'],
          application_type: 'web',
        },
      })
      expect(res).toHaveProperty('client_id')
      expect(res).toHaveProperty('client_secret')
      expect(res.redirect_uris).toContain('https://example.com/callback')
    })
  })

  describe('full auth flow', () => {
    it('completes SIWE login and issues tokens', async () => {
      // 1. Register a client
      const client = await $fetch('/reg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          redirect_uris: ['https://example.com/callback'],
          token_endpoint_auth_method: 'none',
        },
      })

      // 2. Start authorization — follow redirects to get interaction uid
      //    oidc-provider redirects: /auth → /interaction/{uid}
      const authUrl = new URL('/auth', 'http://localhost:3000')
      authUrl.searchParams.set('client_id', client.client_id)
      authUrl.searchParams.set('redirect_uri', 'https://example.com/callback')
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid profile')
      authUrl.searchParams.set('state', 'teststate')

      const authRes = await fetch(authUrl.toString(), { redirect: 'manual' })
      expect(authRes.status).toBe(303)
      const interactionUrl = authRes.headers.get('location')!
      expect(interactionUrl).toMatch(/\/interaction\//)

      // Extract cookies from auth response for subsequent requests
      const cookies = authRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')

      // Extract uid from interaction URL
      const uid = interactionUrl.split('/interaction/')[1]!.split('?')[0]

      // 3. Fetch interaction details
      const details = await fetch(`http://localhost:3000/api/interaction/${uid}`, {
        headers: { cookie: cookies },
      }).then(r => r.json())

      expect(details.uid).toBe(uid)
      expect(details.params.client_id).toBe(client.client_id)

      // 4. Create and sign SIWE message
      const message = createSiweMessage({
        domain: 'localhost:3000',
        address: account.address,
        uri: 'http://localhost:3000',
        chainId: 1,
        nonce: uid,
        statement: 'Sign-In with Ethereum',
      })

      const signature = await account.signMessage({ message })

      // 5. POST SIWE verification — provider responds with 302
      const verifyRes = await fetch(`http://localhost:3000/api/interaction/${uid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: cookies,
        },
        body: JSON.stringify({ message, signature }),
        redirect: 'manual',
      })

      // interactionFinished produces a 303 redirect
      expect([302, 303]).toContain(verifyRes.status)
      const callbackUrl = new URL(verifyRes.headers.get('location')!)

      // Should redirect back to /auth which then redirects to callback with code
      // Follow the chain until we get the code
      const authCookies = [
        cookies,
        ...verifyRes.headers.getSetCookie().map(c => c.split(';')[0]),
      ].join('; ')

      const resumeRes = await fetch(callbackUrl.toString(), {
        headers: { cookie: authCookies },
        redirect: 'manual',
      })

      expect([302, 303]).toContain(resumeRes.status)
      const finalUrl = new URL(resumeRes.headers.get('location')!)
      const code = finalUrl.searchParams.get('code')
      const state = finalUrl.searchParams.get('state')

      expect(code).toBeTruthy()
      expect(state).toBe('teststate')

      // 6. Exchange code for tokens
      const tokenRes = await fetch('http://localhost:3000/token', {
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

      // 7. Decode id_token and verify claims
      const [, payloadB64] = tokens.id_token.split('.')
      const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
      expect(claims.sub).toMatch(/^eip155:1:0x/)
      expect(claims.sub).toContain(account.address)

      // 8. Call userinfo
      const userinfo = await fetch('http://localhost:3000/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then(r => r.json())

      expect(userinfo.sub).toBe(claims.sub)
    })
  })
})
