<template>
  <main class="home">
    <section class="hero">
      <div class="hero-content">
        <div class="hero-text">
          <h1>
            SIWE
            <span class="accent">OIDC Provider</span>
          </h1>
          <p class="muted">
            An OpenID Connect identity provider that authenticates users with
            their Ethereum wallets via
            <a
              href="https://siwe.xyz"
              target="_blank"
              rel="noopener"
              >Sign in with Ethereum</a
            >.
          </p>
          <p class="muted">
            Any application that supports OIDC can use this provider to let
            users log in with their Ethereum address. No passwords, no email, no
            custodial accounts.
          </p>
          <p class="muted">
            See it in action with the
            <a
              href="https://oidc-client.siwe.xyz/"
              target="_blank"
              rel="noopener"
              >example client</a
            >.
          </p>
          <div class="hero-actions">
            <a
              href="/.well-known/openid-configuration"
              class="button"
            >
              Discovery Document
            </a>
            <a
              href="https://github.com/signinwithethereum/oidc-provider"
              target="_blank"
              rel="noopener"
              class="button secondary"
            >
              Provider GitHub
            </a>
            <a
              href="https://github.com/signinwithethereum/oidc-client"
              target="_blank"
              rel="noopener"
              class="button secondary"
            >
              Example Client GitHub
            </a>
          </div>
        </div>
        <div class="hero-graphic">
          <img
            src="/siwe.svg"
            alt="Sign in with Ethereum"
          />
        </div>
      </div>
    </section>

    <hr />

    <section class="features">
      <Card>
        <h3>Standards-Based</h3>
        <p class="muted">
          Full OpenID Connect authorization code flow with PKCE. Use your
          existing OIDC libraries. No custom integration needed.
        </p>
      </Card>

      <Card>
        <h3>Self-Sovereign Identity</h3>
        <p class="muted">
          Your Ethereum wallet is your identity. The user's SIWE signature is
          their consent. No additional consent screen required.
        </p>
      </Card>

      <Card>
        <h3>Dynamic Registration</h3>
        <p class="muted">
          Clients register automatically via the
          <code>/reg</code> endpoint. Or pre-configure default clients via
          environment variable.
        </p>
      </Card>

      <Card>
        <h3>ENS Resolution</h3>
        <p class="muted">
          Resolves ENS names and avatars automatically, returned as
          <code>preferred_username</code> and <code>picture</code> claims.
        </p>
      </Card>

      <Card>
        <h3>Smart Wallet Support</h3>
        <p class="muted">
          Supports EOA, EIP-1271 contract wallets, and EIP-6492 counterfactual
          accounts out of the box.
        </p>
      </Card>

      <Card>
        <h3>Production Ready</h3>
        <p class="muted">
          Redis-backed sessions, auto-generated RSA signing keys shared across
          workers, Docker deployment, and token introspection/revocation.
        </p>
      </Card>
    </section>

    <hr />

    <section class="endpoints">
      <h2>Endpoints</h2>

      <div class="endpoint-list">
        <a
          href="/.well-known/openid-configuration"
          class="endpoint"
        >
          <code>/.well-known/openid-configuration</code>
          <span class="muted">Discovery</span>
        </a>
        <a
          href="/jwks"
          class="endpoint"
        >
          <code>/jwks</code>
          <span class="muted">JSON Web Key Set</span>
        </a>
        <div class="endpoint">
          <code>/auth</code>
          <span class="muted">Authorization</span>
        </div>
        <div class="endpoint">
          <code>/token</code>
          <span class="muted">Token Exchange</span>
        </div>
        <div class="endpoint">
          <code>/me</code>
          <span class="muted">UserInfo</span>
        </div>
        <div class="endpoint">
          <code>/reg</code>
          <span class="muted">Client Registration</span>
        </div>
      </div>
    </section>

    <footer class="home-footer muted">
      <a
        href="https://ethid.org"
        target="_blank"
        rel="noopener"
        >EthID.org</a
      >
      <span>&middot;</span>
      <a
        href="https://siwe.xyz"
        target="_blank"
        rel="noopener"
        >SIWE.xyz</a
      >
    </footer>
  </main>
</template>

<style scoped>
.home {
  max-inline-size: var(--content-width);
  margin-inline: auto;
  padding: var(--spacer-xl) var(--spacer);
}

.hero-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-xl);
}

@media (min-width: 768px) {
  .hero-content {
    flex-direction: row;
  }
}

.hero-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacer);
}

h1 {
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.accent {
  color: var(--gray-z-5);
}

.hero-text .muted a {
  color: var(--color);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.hero-actions {
  display: flex;
  gap: var(--spacer-sm);
  margin-block-start: var(--spacer-sm);
}

.button {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-sm);
  padding: var(--spacer-sm) var(--spacer);
  border: var(--border);
  border-radius: var(--border-radius);
  font-family: var(--ui-font-family);
  font-size: var(--ui-font-size);
  text-transform: var(--ui-text-transform);
  text-decoration: none;
  color: var(--color);
  background: var(--card-background);
  transition:
    background var(--speed),
    border-color var(--speed);

  &:hover {
    background: var(--card-background-highlight);
    border-color: var(--card-border-color-highlight);
  }
}

.button.secondary {
  background: transparent;
}

.hero-graphic {
  flex: 0 0 auto;

  img {
    width: 10rem;
    height: auto;
    opacity: 0.15;
  }
}

hr {
  border: none;
  border-block-start: var(--border);
  margin-block: var(--spacer-xl);
}

.features {
  display: grid;
  gap: var(--spacer);
  grid-template-columns: 1fr;
}

@media (min-width: 768px) {
  .features {
    grid-template-columns: repeat(3, 1fr);
  }
}

.features h3 {
  font-family: var(--ui-font-family);
  font-size: var(--ui-font-size);
  text-transform: var(--ui-text-transform);
  margin: 0;
}

.features p {
  font-size: 0.9em;
}

.features code {
  font-size: 0.85em;
  background: var(--gray-z-1);
  padding: 0.1em 0.35em;
  border-radius: var(--border-radius-sm);
}

.endpoints {
  text-align: center;
}

.endpoints h2 {
  font-family: var(--ui-font-family);
  font-size: var(--ui-font-size);
  text-transform: var(--ui-text-transform);
  margin-block-end: var(--spacer);
}

.endpoint-list {
  display: grid;
  gap: var(--spacer-sm);
  max-inline-size: var(--content-width-sm);
  margin-inline: auto;
}

.endpoint {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacer);
  padding: var(--spacer-sm) var(--spacer);
  border: var(--border);
  border-radius: var(--border-radius);
  text-decoration: none;
  color: inherit;
  transition:
    background var(--speed),
    border-color var(--speed);
}

a.endpoint:hover {
  background: var(--card-background-highlight);
  border-color: var(--card-border-color-highlight);
}

.endpoint code {
  font-size: 0.85em;
}

.endpoint .muted {
  font-size: 0.8em;
}

.home-footer {
  display: flex;
  justify-content: center;
  gap: var(--spacer-sm);
  margin-block-start: var(--spacer-xl);
  font-size: 0.85em;

  a {
    color: inherit;
  }
}
</style>
