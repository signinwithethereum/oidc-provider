# Security Audit Report

**Repository:** signinwithethereum/oidc-provider  
**Date:** 2026-03-31  
**Scope:** Full codebase review (server, configuration, infrastructure, dependencies)

---

## Executive Summary

This OIDC provider integrates Sign-In with Ethereum (SIWE) for authentication via the `oidc-provider` library, backed by Redis for session/token storage. The audit identified **21 findings** across authentication logic, session management, infrastructure, and operational security.

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High     | 5 |
| Medium   | 9 |
| Low      | 4 |

---

## Critical Findings

### C1. Redis Exposed Without Authentication

**Files:** `docker-compose.yml:20-28`, `.env.example:5`

Redis is exposed on port 6379 with no password, and the default connection URL (`redis://localhost:6379`) has no credentials. All OIDC tokens, sessions, authorization codes, grants, and SIWE proofs are stored in Redis.

**Impact:** Any host with network access to port 6379 can read/modify/delete all authentication state — steal tokens, hijack sessions, or forge grants.

**Recommendation:**
- Configure `requirepass` on Redis and use `rediss://` or credentialed URLs.
- Remove `ports: - '6379:6379'` from docker-compose; use internal Docker networking only.
- In production, use Redis ACLs or a managed Redis with TLS.

---

### C2. No Rate Limiting on Any Endpoint

**Files:** `nuxt.config.ts:16-25`, `server/middleware/0.oidc.ts`, `server/api/interaction/[uid].post.ts`

No rate limiting exists on any endpoint: `/token`, `/auth`, `/reg`, `/api/interaction/[uid]`, or SIWE signature verification.

**Impact:**
- Brute-force attacks on token endpoint (authorization code guessing).
- Denial of service via flooding SIWE verification (each verify() call hits an Ethereum RPC).
- Unlimited dynamic client registration (spam `/reg`).
- Resource exhaustion of Redis and ENS/RPC infrastructure.

**Recommendation:**
- Add rate limiting middleware (e.g., `unjs/h3-rate-limit` or nginx-level):
  - `/token`: 30/min per client_id
  - `/reg`: 5/hour per IP
  - `/api/interaction/[uid]` POST: 10/min per session
  - SIWE verification: 5/min per IP

---

### C3. Container Runs as Root

**File:** `Dockerfile:9-15`

The production stage has no `USER` directive. The Node.js process runs as root inside the container.

**Impact:** If an attacker achieves code execution (e.g., via a dependency vulnerability), they gain root access within the container, facilitating container escape or lateral movement.

**Recommendation:**
```dockerfile
FROM node:24-alpine
RUN addgroup -g 1001 app && adduser -D -u 1001 -G app app
WORKDIR /app
COPY --from=builder --chown=app:app /app/.output .output
USER app
```

---

## High Findings

### H1. SIWE Resource List Not Fully Validated

**File:** `server/api/interaction/[uid].post.ts:62-76`

Only the first entry of `siweMessage.resources` is validated against `redirect_uri`. A SIWE message with `resources: [redirect_uri, "https://evil.com"]` passes validation. The user signs a message that lists additional resources they didn't intend to authorize.

**Impact:** An attacker could include additional resource URIs in the SIWE message that the user unknowingly approves, weakening the binding between signature intent and relying party.

**Recommendation:**
```typescript
if (!siweMessage.resources || siweMessage.resources.length !== 1 || siweMessage.resources[0] !== redirectUri) {
  throw createError({ statusCode: 400, statusMessage: 'SIWE resources must contain exactly the redirect_uri' })
}
```

---

### H2. Missing Security Headers

**File:** `nuxt.config.ts`

No security headers are configured: no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, or `Referrer-Policy`.

**Impact:**
- Clickjacking attacks on the SIWE signing page.
- MIME-type sniffing.
- No HSTS enforcement — downgrade attacks.

**Recommendation:** Add a server middleware:
```typescript
export default defineEventHandler((event) => {
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Frame-Options', 'DENY')
  setHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setHeader(event, 'Content-Security-Policy', "frame-ancestors 'none'")
})
```

---

### H3. Wildcard CORS on Sensitive Endpoints

**File:** `nuxt.config.ts:16-25`

All OIDC endpoints have `cors: true` which allows requests from any origin. This includes `/token`, `/reg`, `/token/introspection`, and `/token/revocation`.

**Impact:**
- Any website can make cross-origin requests to the token endpoint.
- While the token endpoint requires `client_secret` (when `requireSecret` is true), with `token_endpoint_auth_method: 'none'` any origin can exchange authorization codes.
- The `/reg` endpoint allows any website to register clients.

**Recommendation:**
- `/token`, `/reg`, `/token/introspection`, `/token/revocation`: Remove CORS or restrict to specific origins.
- `/.well-known/**`, `/jwks`: CORS is acceptable (public metadata).
- `/auth`: CORS may be needed for redirect flows but should be restrictive.

---

### H4. Open Dynamic Client Registration Without Controls

**File:** `server/utils/provider.ts:133-137`

Dynamic client registration is enabled with no authentication, no approval workflow, and no limits:
```typescript
registration: {
  enabled: true,
  idFactory: () => crypto.randomUUID(),
  secretFactory: () => crypto.randomUUID(),
},
```

**Impact:** Attackers can register unlimited clients, potentially:
- Exhausting Redis storage.
- Creating clients with deceptive `client_name`/`logo_uri` for phishing.
- Using registered clients for authorization code interception attacks.

**Recommendation:**
- Add rate limiting on `/reg`.
- Consider requiring an initial access token for registration.
- Validate `logo_uri`, `client_uri`, etc., are valid HTTPS URLs.
- Set a maximum number of registered clients.

---

### H5. Cookie Security Configuration Incomplete

**File:** `server/utils/provider.ts:94-97`

```typescript
cookies: {
  keys: cookieKeys,
  short: { path: '/' },
},
```

No explicit `secure`, `httpOnly`, or `sameSite` flags. The `oidc-provider` library has some defaults, but `secure` is notably NOT defaulted to `true` — it's only set when `provider.proxy = true` AND the request arrives via HTTPS.

**Impact:**
- Cookies may be sent over HTTP if the proxy terminates TLS and doesn't forward `X-Forwarded-Proto`.
- Without `SameSite`, CSRF attacks against the interaction endpoint are possible.

**Recommendation:**
```typescript
cookies: {
  keys: cookieKeys,
  short: { path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
  long: { path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
},
```

---

## Medium Findings

### M1. Redis Adapter `consume()` Race Condition

**File:** `server/utils/redis-adapter.ts:104-119`

The `consume()` method performs a non-atomic read-modify-write: `GET` → `TTL` → `SET/SETEX`. Between `GET` and `SET`, another request could read the unconsumed token.

**Impact:** In a multi-worker deployment, an authorization code could be used twice before the `consumed` flag is persisted. This violates the OIDC spec requirement that authorization codes are single-use.

**Recommendation:** Use a Lua script or `WATCH`/`MULTI`/`EXEC` for atomicity:
```typescript
const script = `
  local data = redis.call('GET', KEYS[1])
  if not data then return nil end
  local payload = cjson.decode(data)
  payload.consumed = ARGV[1]
  local ttl = redis.call('TTL', KEYS[1])
  if ttl > 0 then
    redis.call('SETEX', KEYS[1], ttl, cjson.encode(payload))
  else
    redis.call('SET', KEYS[1], cjson.encode(payload))
  end
  return 1
`
```

---

### M2. Null Assertion in JWKS Race Path

**File:** `server/utils/provider.ts:55-56`

```typescript
const winner = await redis.get(JWKS_REDIS_KEY)
const winnerJwk = JSON.parse(winner!)
```

If the winning key is deleted between `SET NX` returning null and `GET`, `winner` will be `null` and `JSON.parse(null!)` will throw an unhandled error crashing the server startup.

**Impact:** Server crash during initialization in edge cases (Redis key eviction, `FLUSHDB`).

**Recommendation:**
```typescript
const winner = await redis.get(JWKS_REDIS_KEY)
if (!winner) throw new Error('JWKS key was deleted between SET NX and GET — restart required')
```

---

### M3. Static Key ID Without Rotation

**File:** `server/utils/provider.ts:18-22`

```typescript
function decorateJWK(jwk: JWKParameters) {
  jwk.kid = 'key1'
  jwk.use = 'sig'
  jwk.alg = 'RS256'
}
```

The key ID is always `key1`. There is no key rotation mechanism — no way to introduce a new key and deprecate the old one without downtime.

**Impact:**
- If the signing key is compromised, all tokens signed with `key1` become suspect with no way to distinguish old vs. new keys.
- Relying parties caching `kid: "key1"` will silently accept tokens from a compromised key.

**Recommendation:**
- Derive `kid` from the key's thumbprint: `kid = await calculateJwkThumbprint(jwk)`
- Implement key rotation by supporting multiple keys in the JWKS.

---

### M4. No Request Host Validation Against `baseUrl`

**File:** `server/api/interaction/[uid].post.ts:92`

The SIWE domain is validated against `new URL(oidc.baseUrl).host`, which comes from config, not from the actual incoming request's `Host` header.

**Impact:** If the server is accessible under multiple hostnames (e.g., internal IP, load balancer DNS), a SIWE message signed for `oidc.baseUrl`'s domain is accepted regardless of which hostname the request arrives on. In misconfigured proxy setups, this could allow requests from unintended origins.

**Recommendation:** Additionally validate that the request's `Host` header matches the expected domain, or ensure at the proxy layer that only the canonical hostname routes to this service.

---

### M5. ENS Cache Unbounded Growth

**File:** `server/utils/ens.ts:12-13`

```typescript
const ensNameCache = new Map<string, CacheEntry<string | null>>()
const ensAvatarCache = new Map<string, CacheEntry<string | null>>()
```

In-memory Maps grow without bound. Expired entries are only evicted on access (lazy deletion).

**Impact:** Over time in a long-running process, the cache accumulates entries for every unique address/ENS name ever queried. In high-traffic scenarios this causes memory exhaustion.

**Recommendation:**
- Use an LRU cache (e.g., `lru-cache` package) with a max size.
- Or move ENS caching to Redis with TTL.

---

### M6. `parseAccountId` Accepts Extra Segments

**File:** `server/utils/find-account.ts:14-22`

```typescript
const parts = accountId.split(':')
if (parts.length < 3) throw ...
```

An account ID like `eip155:1:0xABC:extra:data` passes validation. Only `parts[0]`, `parts[1]`, `parts[2]` are used; the rest is silently ignored.

**Impact:** Low direct impact, but violates the principle of strict parsing. Extra data could mask injection or confusion if account IDs are later used in string interpolation.

**Recommendation:** Change to `parts.length !== 3` for strict validation.

---

### M7. Client Metadata Returned Without URI Validation

**File:** `server/api/interaction/[uid].get.ts:24-30`

Client metadata fields (`logo_uri`, `client_uri`, `policy_uri`, `tos_uri`) from dynamically registered clients are returned to the frontend verbatim. The registration validator (`provider.ts:156-169`) only checks `redirect_uris`, not these metadata URIs.

**Impact:** A malicious client could register with `logo_uri: "javascript:alert(1)"` or a data URI. While Vue/Nuxt auto-escapes in templates, if any of these URIs are used in `<img src>`, `<a href>`, or rendered as HTML, XSS is possible.

**Recommendation:**
- Validate all URI metadata fields in the `extraClientMetadata.validator` to ensure they are valid HTTPS URLs.
- Sanitize/escape on the frontend as defense-in-depth.

---

### M8. Console Logging Leaks Internal Details

**Files:**
- `server/api/interaction/[uid].post.ts:19`
- `server/api/interaction/[uid].get.ts:33`
- `server/utils/ens.ts:62,80`
- `server/utils/provider.ts:227,269,271`

`console.error` statements log full error objects which may include stack traces, Redis connection strings, or internal state.

**Impact:** In containerized deployments, logs are often shipped to centralized systems. Internal details in logs increase the blast radius of a log aggregation breach.

**Recommendation:** Use structured logging with explicit fields. Never log raw error objects in production.

---

### M9. CORS on `/token/introspection` and `/token/revocation`

**File:** `nuxt.config.ts:22-23`

These endpoints accept bearer tokens. With wildcard CORS, any website can call introspection to check if a token is valid, or call revocation to revoke a user's tokens.

**Impact:**
- Token validity oracle: any site can probe whether a token is active.
- Denial of service: any site can revoke a user's tokens.

**Recommendation:** Remove CORS from these endpoints or restrict to registered client origins.

---

## Low Findings

### L1. Nonce Deterministically Derived from UID

**File:** `server/api/interaction/[uid].get.ts:17`

```typescript
nonce: Buffer.from(details.uid).toString('hex'),
```

The nonce is a hex encoding of the interaction UID, not a separate random value. While the UID itself is random (generated by `oidc-provider`), this means the nonce is predictable if the UID is known, and it's sent to the frontend.

**Impact:** Low — the UID is already exposed to the client and bound to the session cookie. However, best practice for nonces is independent randomness.

---

### L2. No RSA Key Strength Validation

**File:** `server/utils/provider.ts:25-29`

When importing a user-provided RSA PEM, there is no check on key size. A 1024-bit key would be accepted.

**Impact:** Weak signing keys compromise all issued tokens.

**Recommendation:** After import, verify the key is at least 2048 bits.

---

### L3. HTTP Default for `baseUrl`

**File:** `nuxt.config.ts:29`, `.env.example:2`

The default `baseUrl` is `http://localhost:3000`. This is the OIDC issuer URL. If deployed without changing this, tokens are issued with an HTTP issuer.

**Impact:** Relying parties may reject the issuer, or tokens may be transmitted insecurely.

**Recommendation:** Add a startup check that `baseUrl` uses HTTPS in non-development environments.

---

### L4. No Health Check in Dockerfile

**File:** `Dockerfile`

No `HEALTHCHECK` directive. The docker-compose file only has a health check for Redis.

**Impact:** Orchestrators and load balancers cannot detect unhealthy application instances.

**Recommendation:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/.well-known/openid-configuration || exit 1
```

---

## Dependency Assessment

| Package | Version | Status |
|---------|---------|--------|
| oidc-provider | 9.7.1 | Current 9.x — no known CVEs |
| jose | 6.2.1 | Current 6.x — no known CVEs |
| @signinwithethereum/siwe | 4.1.0 | Exact pin, current |
| viem | 2.47.5 | Current — no known CVEs |
| ioredis | 5.10.0 | Current — no known CVEs |

No critical dependency vulnerabilities identified at time of review. The exact pin on `siwe` (`4.1.0` without `^`) is good for reproducibility but requires manual updates for patches.

---

## Remediation Priority

### Immediate (before production deployment)
1. **C1** — Secure Redis with authentication and remove port exposure
2. **C2** — Add rate limiting on all public endpoints
3. **C3** — Run container as non-root user
4. **H2** — Add security headers
5. **H5** — Set cookie `secure`, `httpOnly`, `sameSite` flags

### Short-term (next sprint)
6. **H1** — Strictly validate SIWE resources list
7. **H3** — Restrict CORS to specific origins or remove from sensitive endpoints
8. **H4** — Add controls to dynamic client registration
9. **M1** — Fix `consume()` atomicity
10. **M7** — Validate client metadata URIs

### Medium-term
11. **M2** — Add null check in JWKS race path
12. **M3** — Implement key rotation with thumbprint-based `kid`
13. **M5** — Bound the ENS cache
14. **M8** — Structured logging

---

## Positive Observations

- SIWE signature verification is thorough, supporting EOA, EIP-1271, and EIP-6492.
- Nonce validation correctly handles hex encoding edge cases (odd-length, non-hex chars).
- HTTPS enforcement on `redirect_uris` for non-localhost clients.
- `strict: true` mode used in SIWE verification.
- JWKS generation uses `SET NX` for safe multi-worker coordination.
- Authorization code TTL is appropriately short (60s).
- `loadExistingGrant` correctly filters scopes against a supported set.
- Cookie signing keys are required at startup (fail-fast).
