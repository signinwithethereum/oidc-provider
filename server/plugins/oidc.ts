import { getProvider, seedDefaultClients } from '../utils/provider'
import { fromNodeMiddleware } from 'h3'

export default defineNitroPlugin(async (nitro) => {
  const provider = await getProvider()
  await seedDefaultClients()

  // Mount oidc-provider as a catch-all middleware (after Nuxt routes)
  nitro.h3App.use(fromNodeMiddleware(provider.callback()))
})
