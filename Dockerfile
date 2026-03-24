FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/.output .output
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
LABEL org.opencontainers.image.source="https://github.com/signinwithethereum/siwe-oidc"
LABEL org.opencontainers.image.description="OpenID Connect Identity Provider for Sign-In with Ethereum"
LABEL org.opencontainers.image.licenses="MIT OR Apache-2.0"
