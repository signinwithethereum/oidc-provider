export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: true,

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
      ],
    },
  },

  extends: ['@1001-digital/layers.evm'],

  runtimeConfig: {
    oidc: {
      baseUrl: 'http://localhost:3000',
      redisUrl: 'redis://localhost:6379',
      rsaPem: '',
      requireSecret: false,
      ethProvider: '',
      defaultClients: '{}',
      cookieKeys: '',
    },
  },
})
